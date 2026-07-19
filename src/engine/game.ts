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
  /**
   * Provisional primary before the first roll-off (only affects `toAct` display during
   * ROLL_OFF, which is a system roll). Defaults to 'human'. The actual primary of every
   * hand is decided by the ROLL_OFF.
   */
  readonly firstPrimary?: PlayerId
}

/** Creates the initial match state at the start of hand 1 (ROLL_OFF phase). */
export function createInitialState(options: NewGameOptions = {}): GameState {
  const config = options.config ?? DEFAULT_BET_CONFIG
  const bankroll = options.startingBankroll ?? DEFAULT_STARTING_BANKROLL
  const primary = options.firstPrimary ?? 'human'

  return {
    config,
    phase: 'ROLL_OFF',
    primary,
    rollOff: null,
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
    toAct: primary,
    firstBetAmount: 0,
    lastShowdown: null,
    log: ['Mano 1 — tira il dado per decidere chi inizia.'],
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
    case 'ROLL_OFF':
      return handleRollOff(state, rng)
    case 'OPEN':
      return handleOpen(state, action.player, action.amount)
    case 'CALL':
      return handleCall(state, action.player, rng)
    case 'RAISE':
      return handleRaise(state, action.player, action.amount)
    case 'STEAL':
      return handleSteal(state, action.player, action.commonIndex)
    case 'REROLL':
      return handleReroll(state, action.player, action.ownIndices)
    case 'NEXT_HAND':
      return handleNextHand(state)
  }
}

// --- ROLL_OFF: highest die decides the primary ---

function handleRollOff(state: GameState, rng: Rng): GameState {
  assert(state.phase === 'ROLL_OFF', 'ROLL_OFF only allowed in ROLL_OFF phase')

  const human = { value: rng.rollDie() }
  const bot = { value: rng.rollDie() }

  if (human.value === bot.value) {
    // Tie: nobody wins the roll-off, re-roll. Record the dice for display.
    return withLog(
      { ...state, rollOff: { human, bot } },
      `Tiro iniziale: Tu ${human.value} — Bot ${bot.value}. Pareggio, si ritira.`,
    )
  }

  const winner: PlayerId = human.value > bot.value ? 'human' : 'bot'
  const next: GameState = {
    ...state,
    rollOff: { human, bot },
    primary: winner,
    phase: 'INITIAL_BET',
    toAct: winner, // primary opens the initial bet
  }
  return withLog(
    next,
    `Tiro iniziale: Tu ${human.value} — Bot ${bot.value}. Inizia ${labelOf(winner)}.`,
  )
}

// --- Betting: INITIAL_BET and SECOND_BET ---

function inBettingPhase(state: GameState): boolean {
  return state.phase === 'INITIAL_BET' || state.phase === 'SECOND_BET'
}

/** The minimum an opening bet must be for the current phase. */
function openMinimum(state: GameState): number {
  // First bet: at least config.minBet. Second bet: at least the settled first bet.
  return state.phase === 'SECOND_BET' ? state.firstBetAmount : state.config.minBet
}

function handleOpen(state: GameState, player: PlayerId, amount: number): GameState {
  assert(inBettingPhase(state), 'OPEN only allowed in a betting phase')
  assert(state.toAct === player, 'not this player to act')
  assert(player === state.primary, 'only the primary opens a betting round')
  assert(state.aggressor === null, 'the round is already opened')

  const min = openMinimum(state)
  assert(amount >= min, `opening bet must be at least ${min}`)

  const hand = state.hands[player]
  const toPut = amount - hand.committed
  assert(toPut > 0, 'opening bet must add chips on top of what is already committed')

  const opponent = otherPlayer(player)
  let next = commit(state, player, toPut)
  next = { ...next, currentBet: amount, aggressor: player, toAct: opponent }
  return withLog(next, `${labelOf(player)} punta ${amount}. Tocca a ${labelOf(opponent)}: vedi o rilancia.`)
}

function handleCall(state: GameState, player: PlayerId, rng: Rng): GameState {
  assert(inBettingPhase(state), 'CALL only allowed in a betting phase')
  assert(state.toAct === player, 'not this player to act')
  // There is no check: a player may only CALL to match an existing bet.
  assert(state.aggressor !== null, 'nothing to call — the round has not been opened')

  const hand = state.hands[player]
  const toMatch = state.currentBet - hand.committed
  assert(toMatch >= 0, 'nothing to call implies negative match')

  const next = withLog(
    toMatch > 0 ? commit(state, player, toMatch) : state,
    `${labelOf(player)} vede (${toMatch}).`,
  )
  // A call that matches the current bet closes the round.
  return settleWindow(next, rng)
}

function handleRaise(state: GameState, player: PlayerId, amount: number): GameState {
  assert(inBettingPhase(state), 'RAISE only allowed in a betting phase')
  assert(state.toAct === player, 'not this player to act')
  assert(state.aggressor !== null, 'cannot raise before the round is opened')
  assert(
    state.raisesThisWindow < state.config.maxRaisesPerWindow,
    'raise cap reached for this betting round',
  )

  // Raise TO `amount`: must exceed the current bet by at least minBet.
  const minRaiseTo = state.currentBet + state.config.minBet
  assert(amount >= minRaiseTo, `raise must be to at least ${minRaiseTo}`)

  const hand = state.hands[player]
  const toPut = amount - hand.committed
  let next = commit(state, player, toPut)
  next = {
    ...next,
    currentBet: amount,
    raisesThisWindow: next.raisesThisWindow + 1,
    aggressor: player, // the raiser is now the aggressor; opponent must respond
    toAct: otherPlayer(player),
  }
  return withLog(next, `${labelOf(player)} rilancia a ${amount}.`)
}

/**
 * The betting round has closed (a call matched the current bet).
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
  // Own dice are rolled first (human then bot), then the common dice.
  const humanOwn = rollOwnDice(rng)
  const botOwn = rollOwnDice(rng)
  const common = rollCommonDice(rng)

  let next: GameState = {
    ...state,
    phase: 'STEAL',
    common,
    firstBetAmount: state.currentBet,
    // Primary (the roll-off winner) steals first.
    toAct: state.primary,
  }
  next = setHand(next, 'human', { own: humanOwn })
  next = setHand(next, 'bot', { own: botOwn })

  // Log the full flow: both players' rolled dice, then the common dice.
  next = withLog(next, `Lancio — Tu: ${diceStr(humanOwn)}. Bot: ${diceStr(botOwn)}.`)
  const c = common.map((d) => d.value).join(', ')
  next = withLog(next, `Dadi comuni: ${c}. Ruba per primo ${labelOf(state.primary)}.`)
  return next
}

/** Formats a list of dice as their values, e.g. "3, 5, 5, 1". */
function diceStr(dice: ReadonlyArray<{ readonly value: number }>): string {
  return dice.map((d) => d.value).join(', ')
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
  if (player === state.primary) {
    // Primary stole first; non-primary steals next.
    return { ...next, toAct: nonPrimary }
  }
  // Non-primary just stole (second). Both have stolen -> reroll selection phase.
  return enterRerollSelect(next)
}

function enterRerollSelect(state: GameState): GameState {
  // Primary selects reroll first, then non-primary (order mirrors steal for consistency).
  return withLog(
    { ...state, phase: 'REROLL_SELECT', toAct: state.primary },
    'Scelta dei dadi da rilanciare (fino a 4, il rubato resta fisso).',
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
  // All 4 own dice may be rerolled; only the stolen die is fixed (and is not indexable here).

  let next = setHand(state, player, { rerollSelection: unique })
  next = withLog(
    next,
    unique.length > 0
      ? `${labelOf(player)} rilancerà ${unique.length} dad${unique.length === 1 ? 'o' : 'i'}.`
      : `${labelOf(player)} tiene tutti i dadi.`,
  )

  const nonPrimary = otherPlayer(state.primary)
  if (player === state.primary) {
    return { ...next, toAct: nonPrimary }
  }
  // Both selections in -> SECOND_BET. Primary acts first (check or bet).
  return enterSecondBet(next)
}

function enterSecondBet(state: GameState): GameState {
  // The second bet is a fresh betting round: the first-round chips are already in the pot
  // and stay there, so we reset each player's per-round `committed` to 0 and start with no
  // bet on the table. The primary must OPEN with an amount >= the first bet (openMinimum),
  // then the opponent must see/raise (no check, no fold).
  const reset: GameState = {
    ...state,
    phase: 'SECOND_BET',
    currentBet: 0,
    raisesThisWindow: 0,
    aggressor: null,
    toAct: state.primary,
    hands: {
      human: { ...state.hands.human, committed: 0 },
      bot: { ...state.hands.bot, committed: 0 },
    },
  }
  return withLog(
    reset,
    `Seconda scommessa — punta ${labelOf(state.primary)} (minimo ${state.firstBetAmount}).`,
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
      : { kind: 'win', winner: cmp > 0 ? 'human' : 'bot' }

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
    // Split the pot evenly. Because every hand reaches showdown with both players having
    // matched each betting round, the pot is always even and splits cleanly. No score change.
    const half = next.pot / 2
    next = {
      ...next,
      bankroll: {
        human: next.bankroll.human + half,
        bot: next.bankroll.bot + half,
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

/**
 * Starts the next hand: resets per-hand state and returns to ROLL_OFF, where a fresh
 * die-off decides the new primary. (The primary is no longer alternated; it is won each
 * hand by the highest roll-off die.)
 */
function handleNextHand(state: GameState): GameState {
  assert(state.phase === 'HAND_COMPLETE', 'NEXT_HAND only allowed after a hand completes')

  const nextHandNumber = state.handNumber + 1

  return {
    ...state,
    phase: 'ROLL_OFF',
    // primary keeps its previous value until the next roll-off resolves it.
    rollOff: null,
    handNumber: nextHandNumber,
    pot: 0,
    hands: { human: emptyHandState(), bot: emptyHandState() },
    common: null,
    stolenCommonIndices: [],
    currentBet: 0,
    raisesThisWindow: 0,
    aggressor: null,
    toAct: state.primary,
    firstBetAmount: 0,
    lastShowdown: null,
    log: [
      ...state.log,
      `Mano ${nextHandNumber} — tira il dado per decidere chi inizia.`,
    ],
    matchWinner: null,
  }
}
