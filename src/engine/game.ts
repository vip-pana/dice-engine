// Match state machine: a reducer over GameState, driven by Action.
//
// Design: pure and deterministic. All randomness comes from an injected Rng, threaded
// through the reducer's third argument. The reducer NEVER mutates its input; it returns
// a fresh GameState. Invalid actions for the current phase throw (the UI/bot only ever
// send legal actions; tests assert the guards).

import { evaluateHand, compareHands } from './hand'
import { rollOwnDice, rollCommonDice, MAX_REROLL, type OwnDice } from './strategy'
import type { Rng } from './rng'
import type { Hand } from './types'
import type { Action } from './actions'
import {
  DEFAULT_BET_CONFIG,
  DEFAULT_STARTING_BANKROLL,
  WINS_TO_TAKE_MATCH,
  otherPlayer,
  type BetConfig,
  type GameState,
  type HandOutcome,
  type PlayerHandState,
  type PlayerId,
  type ShowdownInfo,
} from './gameTypes'

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function emptyHandState(): PlayerHandState {
  return { own: null, stolen: null, committed: 0, rerollSelection: null }
}

export interface NewGameOptions {
  readonly config?: BetConfig
  readonly startingBankroll?: number
  /** Seat that opens as primary in hand 1. Defaults to 'human'. */
  readonly firstPrimary?: PlayerId
}

/** Creates the initial match state at the start of hand 1 (INITIAL_BET phase). */
export function createInitialState(options: NewGameOptions = {}): GameState {
  const config = options.config ?? DEFAULT_BET_CONFIG
  const bankroll = options.startingBankroll ?? DEFAULT_STARTING_BANKROLL
  const primary = options.firstPrimary ?? 'human'

  return {
    config,
    phase: 'INITIAL_BET',
    primary,
    handNumber: 1,
    score: { human: 0, bot: 0 },
    bankroll: { human: bankroll, bot: bankroll },
    pot: 0,
    hands: { human: emptyHandState(), bot: emptyHandState() },
    common: null,
    stolenCommonIndices: [],
    currentBet: 0,
    raisesThisWindow: 0,
    aggressor: null,
    checksThisWindow: 0,
    toAct: primary, // primary opens the initial bet
    firstBetAmount: 0,
    lastShowdown: null,
    log: [`Mano 1 — apre ${labelOf(primary)}.`],
    matchWinner: null,
  }
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function labelOf(p: PlayerId): string {
  return p === 'human' ? 'Tu' : 'Bot'
}

function withLog(state: GameState, message: string): GameState {
  return { ...state, log: [...state.log, message] }
}

/** Moves `amount` from a player's bankroll into the pot, tracking their commitment. */
function commit(state: GameState, player: PlayerId, amount: number): GameState {
  const hand = state.hands[player]
  return {
    ...state,
    bankroll: { ...state.bankroll, [player]: state.bankroll[player] - amount },
    pot: state.pot + amount,
    hands: {
      ...state.hands,
      [player]: { ...hand, committed: hand.committed + amount },
    },
  }
}

function setHand(
  state: GameState,
  player: PlayerId,
  patch: Partial<PlayerHandState>,
): GameState {
  return {
    ...state,
    hands: { ...state.hands, [player]: { ...state.hands[player], ...patch } },
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[game] ${message}`)
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Applies an action to the state, returning the next state.
 * `rng` supplies all randomness (dice rolls) triggered by the transition.
 */
export function reducer(state: GameState, action: Action, rng: Rng): GameState {
  switch (action.type) {
    case 'OPEN':
      return handleOpen(state, action.player)
    case 'CALL':
      return handleCall(state, action.player, rng)
    case 'RAISE':
      return handleRaise(state, action.player)
    case 'FOLD':
      return handleFold(state, action.player)
    case 'STEAL':
      return handleSteal(state, action.player, action.commonIndex)
    case 'REROLL':
      return handleReroll(state, action.player, action.ownIndices)
    case 'NEXT_HAND':
      return handleNextHand(state)
  }
}

// --- Betting: INITIAL_BET and SECOND_BET ---

function inBettingPhase(state: GameState): boolean {
  return state.phase === 'INITIAL_BET' || state.phase === 'SECOND_BET'
}

function handleOpen(state: GameState, player: PlayerId): GameState {
  assert(state.phase === 'INITIAL_BET', 'OPEN only allowed in INITIAL_BET')
  assert(state.toAct === player, 'not this player to act')
  assert(player === state.primary, 'only the primary opens the initial bet')
  assert(state.currentBet === 0, 'bet already opened')

  const ante = state.config.ante
  let next = commit(state, player, ante)
  // Opening posts a bet above 0, so the opener is the current aggressor.
  next = { ...next, currentBet: ante, aggressor: player, toAct: otherPlayer(player) }
  return withLog(next, `${labelOf(player)} apre con ${ante}.`)
}

function handleCall(state: GameState, player: PlayerId, rng: Rng): GameState {
  assert(inBettingPhase(state), 'CALL only allowed in a betting phase')
  assert(state.toAct === player, 'not this player to act')

  const hand = state.hands[player]
  const toMatch = state.currentBet - hand.committed
  assert(toMatch >= 0, 'nothing to call implies negative match')

  const isCheck = toMatch === 0 && state.aggressor === null

  let next = toMatch > 0 ? commit(state, player, toMatch) : state
  next = withLog(
    next,
    isCheck ? `${labelOf(player)} passa.` : `${labelOf(player)} vede (${toMatch}).`,
  )

  if (isCheck) {
    // A check: increment the check counter. Two consecutive checks close the window.
    const checks = state.checksThisWindow + 1
    next = { ...next, checksThisWindow: checks }
    if (checks >= 2) {
      return settleWindow(next, rng)
    }
    return { ...next, toAct: otherPlayer(player) }
  }

  // A call that matches the aggressor's bet closes the window.
  return settleWindow(next, rng)
}

function handleRaise(state: GameState, player: PlayerId): GameState {
  assert(inBettingPhase(state), 'RAISE only allowed in a betting phase')
  assert(state.toAct === player, 'not this player to act')
  assert(
    state.raisesThisWindow < state.config.maxRaisesPerWindow,
    'raise cap reached for this betting round',
  )

  const hand = state.hands[player]
  const newBet = state.currentBet + state.config.raiseStep
  const toPut = newBet - hand.committed
  let next = commit(state, player, toPut)
  next = {
    ...next,
    currentBet: newBet,
    raisesThisWindow: next.raisesThisWindow + 1,
    aggressor: player, // the raiser is now the aggressor; opponent must respond
    checksThisWindow: 0, // a bet cancels any prior checks
    toAct: otherPlayer(player),
  }
  return withLog(next, `${labelOf(player)} rilancia a ${newBet}.`)
}

function handleFold(state: GameState, player: PlayerId): GameState {
  assert(state.phase === 'SECOND_BET', 'FOLD only allowed in SECOND_BET')
  assert(state.toAct === player, 'not this player to act')

  const winner = otherPlayer(player)
  const logged = withLog(state, `${labelOf(player)} lascia. ${labelOf(winner)} vince la mano.`)
  return resolveHand(logged, { kind: 'win', winner, byFold: true })
}

/**
 * The betting window has closed (a call matched a bet, or both players checked).
 * Advances to the next phase. Both players are guaranteed matched at this point.
 */
function settleWindow(state: GameState, rng: Rng): GameState {
  if (state.phase === 'INITIAL_BET') {
    return startHandAfterInitialBet(state, rng)
  }
  // SECOND_BET settled -> apply rerolls and go to showdown.
  return goToShowdown(state, rng)
}

// --- Transition: initial bet settled -> roll dice, go to STEAL ---

function startHandAfterInitialBet(state: GameState, rng: Rng): GameState {
  const humanOwn = rollOwnDice(rng)
  const botOwn = rollOwnDice(rng)
  const common = rollCommonDice(rng)

  const nonPrimary = otherPlayer(state.primary)

  let next: GameState = {
    ...state,
    phase: 'STEAL',
    common,
    firstBetAmount: state.currentBet,
    // Non-primary steals first.
    toAct: nonPrimary,
  }
  next = setHand(next, 'human', { own: humanOwn })
  next = setHand(next, 'bot', { own: botOwn })

  const c = common.map((d) => d.value).join(', ')
  next = withLog(next, `Dadi comuni: ${c}. Ruba per primo ${labelOf(nonPrimary)}.`)
  return next
}

// --- STEAL ---

function handleSteal(state: GameState, player: PlayerId, commonIndex: number): GameState {
  assert(state.phase === 'STEAL', 'STEAL only allowed in STEAL phase')
  assert(state.toAct === player, 'not this player to steal')
  assert(state.common !== null, 'no common dice to steal from')
  assert(commonIndex >= 0 && commonIndex < state.common.length, 'invalid common index')
  assert(!state.stolenCommonIndices.includes(commonIndex), 'that common die is already taken')

  const stolen = state.common[commonIndex]!
  let next = setHand(state, player, { stolen })
  next = {
    ...next,
    stolenCommonIndices: [...next.stolenCommonIndices, commonIndex],
  }
  next = withLog(next, `${labelOf(player)} ruba il dado ${stolen.value}.`)

  const nonPrimary = otherPlayer(state.primary)
  if (player === nonPrimary) {
    // Non-primary stole first; primary steals next.
    return { ...next, toAct: state.primary }
  }
  // Primary just stole (second). Both have stolen -> reroll selection phase.
  return enterRerollSelect(next)
}

function enterRerollSelect(state: GameState): GameState {
  // Non-primary selects reroll first, then primary (order mirrors steal for consistency).
  const nonPrimary = otherPlayer(state.primary)
  return withLog(
    { ...state, phase: 'REROLL_SELECT', toAct: nonPrimary },
    'Scelta dei dadi da rilanciare (max 3).',
  )
}

// --- REROLL_SELECT ---

function handleReroll(
  state: GameState,
  player: PlayerId,
  ownIndices: readonly number[],
): GameState {
  assert(state.phase === 'REROLL_SELECT', 'REROLL only allowed in REROLL_SELECT')
  assert(state.toAct === player, 'not this player to choose reroll')
  assert(state.hands[player].rerollSelection === null, 'reroll already chosen')

  const unique = [...new Set(ownIndices)]
  assert(unique.length === ownIndices.length, 'duplicate reroll indices')
  assert(
    unique.every((i) => i >= 0 && i < 4),
    'reroll indices must be own-dice indices 0..3',
  )
  assert(unique.length <= MAX_REROLL, `at most ${MAX_REROLL} own dice may be rerolled`)
  // "at least 1 own die stays" is implied by <= MAX_REROLL (=3) with 4 own dice.

  let next = setHand(state, player, { rerollSelection: unique })
  next = withLog(
    next,
    unique.length > 0
      ? `${labelOf(player)} rilancerà ${unique.length} dad${unique.length === 1 ? 'o' : 'i'}.`
      : `${labelOf(player)} tiene tutti i dadi.`,
  )

  const nonPrimary = otherPlayer(state.primary)
  if (player === nonPrimary) {
    return { ...next, toAct: state.primary }
  }
  // Both selections in -> SECOND_BET. Primary acts first (check or bet).
  return enterSecondBet(next)
}

function enterSecondBet(state: GameState): GameState {
  // Reset the betting window for the second bet. currentBet carries over the settled
  // first bet amount as the floor (second bet must be >= first). committed values from
  // the first window stay (they are already in the pot); the second window measures
  // ADDITIONAL commitment on top, but we keep the model simple: currentBet resets to the
  // first bet amount and committed already equals it, so a CALL with 0 to match = check.
  return withLog(
    {
      ...state,
      phase: 'SECOND_BET',
      currentBet: state.firstBetAmount,
      raisesThisWindow: 0,
      aggressor: null, // fresh window: both players may check
      checksThisWindow: 0,
      toAct: state.primary,
    },
    `Seconda scommessa — apre ${labelOf(state.primary)} (minimo ${state.firstBetAmount}).`,
  )
}

// --- SHOWDOWN ---

function applyReroll(own: OwnDice, selection: readonly number[], rng: Rng): OwnDice {
  const set = new Set(selection)
  const after = own.map((die, i) => (set.has(i) ? { value: rng.rollDie() } : die))
  return [after[0]!, after[1]!, after[2]!, after[3]!]
}

function finalHandOf(hand: PlayerHandState, rng: Rng): Hand {
  assert(hand.own !== null && hand.stolen !== null, 'incomplete hand at showdown')
  const selection = hand.rerollSelection ?? []
  const own = applyReroll(hand.own, selection, rng)
  return [own[0], own[1], own[2], own[3], hand.stolen]
}

function goToShowdown(state: GameState, rng: Rng): GameState {
  const humanHand = finalHandOf(state.hands.human, rng)
  const botHand = finalHandOf(state.hands.bot, rng)

  // Persist the rerolled own dice back into hand state so the UI can show final dice.
  const humanOwn: OwnDice = [humanHand[0], humanHand[1], humanHand[2], humanHand[3]]
  const botOwn: OwnDice = [botHand[0], botHand[1], botHand[2], botHand[3]]

  const humanEval = evaluateHand(humanHand)
  const botEval = evaluateHand(botHand)
  const cmp = compareHands(humanEval, botEval)

  const outcome: HandOutcome =
    cmp === 0
      ? { kind: 'tie' }
      : { kind: 'win', winner: cmp > 0 ? 'human' : 'bot', byFold: false }

  const showdown: ShowdownInfo = { human: humanEval, bot: botEval, outcome }

  let next: GameState = {
    ...state,
    phase: 'SHOWDOWN',
    lastShowdown: showdown,
  }
  next = setHand(next, 'human', { own: humanOwn })
  next = setHand(next, 'bot', { own: botOwn })
  next = withLog(next, describeShowdown(humanEval, botEval, outcome))

  return resolveHand(next, outcome)
}

function describeShowdown(
  human: ShowdownInfo['human'],
  bot: ShowdownInfo['bot'],
  outcome: HandOutcome,
): string {
  const h = human.values.join('')
  const b = bot.values.join('')
  if (outcome.kind === 'tie') {
    return `Showdown: Tu [${h}] vs Bot [${b}] — pareggio, si rigioca.`
  }
  return `Showdown: Tu [${h}] vs Bot [${b}] — vince ${labelOf(outcome.winner)}.`
}

// --- Hand resolution & match progression ---

/**
 * Awards the pot per the outcome, updates score, and moves to HAND_COMPLETE (or
 * MATCH_OVER). On a total tie the pot is split back to each player's committed amount
 * and no score changes (the hand is replayed).
 */
function resolveHand(state: GameState, outcome: HandOutcome): GameState {
  let next = state

  if (outcome.kind === 'tie') {
    // Refund each player's committed chips; pot goes to 0. No score change.
    next = {
      ...next,
      bankroll: {
        human: next.bankroll.human + next.hands.human.committed,
        bot: next.bankroll.bot + next.hands.bot.committed,
      },
      pot: 0,
    }
  } else {
    const winner = outcome.winner
    next = {
      ...next,
      bankroll: { ...next.bankroll, [winner]: next.bankroll[winner] + next.pot },
      pot: 0,
      score: { ...next.score, [winner]: next.score[winner] + 1 },
    }
  }

  // Match decided?
  if (outcome.kind === 'win' && next.score[outcome.winner] >= WINS_TO_TAKE_MATCH) {
    return withLog(
      { ...next, phase: 'MATCH_OVER', matchWinner: outcome.winner },
      `${labelOf(outcome.winner)} vince il match ${next.score.human}-${next.score.bot}!`,
    )
  }

  return { ...next, phase: 'HAND_COMPLETE' }
}

/** Starts the next hand: alternates primary, resets per-hand state, re-opens INITIAL_BET. */
function handleNextHand(state: GameState): GameState {
  assert(state.phase === 'HAND_COMPLETE', 'NEXT_HAND only allowed after a hand completes')

  const wasTie = state.lastShowdown?.outcome.kind === 'tie'
  // A tie is replayed WITHOUT alternating the primary role (the hand "did not count").
  const nextPrimary = wasTie ? state.primary : otherPlayer(state.primary)
  const nextHandNumber = state.handNumber + 1

  return {
    ...state,
    phase: 'INITIAL_BET',
    primary: nextPrimary,
    handNumber: nextHandNumber,
    pot: 0,
    hands: { human: emptyHandState(), bot: emptyHandState() },
    common: null,
    stolenCommonIndices: [],
    currentBet: 0,
    raisesThisWindow: 0,
    aggressor: null,
    checksThisWindow: 0,
    toAct: nextPrimary,
    firstBetAmount: 0,
    lastShowdown: null,
    log: [
      ...state.log,
      `Mano ${nextHandNumber} — apre ${labelOf(nextPrimary)}.`,
    ],
    matchWinner: null,
  }
}
