// Match state machine: a reducer over GameState, driven by Action.
//
// Design: pure and deterministic. All randomness comes from an injected Rng, threaded
// through the reducer's third argument. The reducer NEVER mutates its input; it returns
// a fresh GameState. Invalid actions for the current phase throw (the UI/bot only ever
// send legal actions; tests assert the guards).

import { evaluateHand, compareHands } from './hand'
import { abilitySpec, rerollDie } from './abilities'
import {
  rollOwnDice,
  rollCommonDice,
  rollRandomLoadout,
  MAX_REROLL,
  NO_ABILITY_DROPS,
  PLAIN_LOADOUT,
  type AbilityDropConfig,
  type Loadout,
  type OwnDice,
} from './strategy'
import { assertValidDeck, drawHandFromDeck, type Deck } from './deck'
import type { Rng } from './rng'
import type { AbilityId, Die, DieValue, Hand } from './types'
import type { Action } from './actions'
import {
  DEFAULT_BET_CONFIG,
  DEFAULT_STARTING_BANKROLL,
  WINS_TO_TAKE_MATCH,
  otherPlayer,
  type BetConfig,
  type GameState,
  type HandOutcome,
  type OwnDiceSource,
  type PlayerHandState,
  type PlayerId,
  type ShowdownInfo,
} from './gameTypes'

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function emptyHandState(): PlayerHandState {
  return {
    own: null,
    stolen: null,
    committed: 0,
    rerollSelection: null,
    concealedIndices: [],
    torpedoTarget: null,
  }
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
  /**
   * Per-seat FIXED die loadouts. Omitted seats get four plain dice, so leaving this out
   * yields the base game unchanged.
   *
   * A seat listed here is pinned: `abilityDrops` never overwrites it. That keeps the
   * deterministic setup used by tests and by balance runs available alongside the
   * random-drop mode.
   */
  readonly loadouts?: Partial<Record<PlayerId, Loadout>>
  /**
   * Per-seat 12-die decks. A seat with a deck draws 4 of its 12 dice fresh every hand,
   * ignoring `abilityDrops.ownChance`.
   *
   * Mutually exclusive with `loadouts` for the same seat — supplying both is a caller bug
   * and throws, rather than being silently resolved by a precedence rule.
   */
  readonly decks?: Partial<Record<PlayerId, Deck>>
  /**
   * Random ability drops. When set, every hand re-rolls the loadout of each seat that has
   * neither a pinned loadout nor a deck, and the common dice draw their own abilities.
   * Defaults to no drops (base game).
   */
  readonly abilityDrops?: AbilityDropConfig
}

/** Which source a seat's own dice come from, given the options supplied. */
function ownDiceSourceFor(options: NewGameOptions, seat: PlayerId): OwnDiceSource {
  const deck = options.decks?.[seat]
  const loadout = options.loadouts?.[seat]
  assert(
    deck === undefined || loadout === undefined,
    `${seat} was given both a deck and a pinned loadout; pick one`,
  )
  if (deck !== undefined) {
    return { kind: 'deck' }
  }
  return loadout !== undefined ? { kind: 'pinned' } : { kind: 'drops' }
}

/** Creates the initial match state at the start of hand 1 (ROLL_OFF phase). */
export function createInitialState(options: NewGameOptions = {}): GameState {
  const config = options.config ?? DEFAULT_BET_CONFIG
  const bankroll = options.startingBankroll ?? DEFAULT_STARTING_BANKROLL
  const primary = options.firstPrimary ?? 'human'

  const ownDiceSource = {
    human: ownDiceSourceFor(options, 'human'),
    bot: ownDiceSourceFor(options, 'bot'),
  }
  const decks = {
    human: options.decks?.human ?? null,
    bot: options.decks?.bot ?? null,
  }
  // The engine validates, not just the UI: an illegal deck must be impossible to play,
  // whatever the caller is.
  for (const seat of ['human', 'bot'] as const) {
    const deck = decks[seat]
    if (deck !== null) {
      assertValidDeck(deck, seat)
    }
  }

  return {
    config,
    phase: 'ROLL_OFF',
    loadouts: {
      human: options.loadouts?.human ?? PLAIN_LOADOUT,
      bot: options.loadouts?.bot ?? PLAIN_LOADOUT,
    },
    ownDiceSource,
    decks,
    pinnedLoadouts: {
      human: ownDiceSource.human.kind === 'pinned',
      bot: ownDiceSource.bot.kind === 'pinned',
    },
    abilityDrops: options.abilityDrops ?? NO_ABILITY_DROPS,
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

/**
 * The largest total bet `player` could cover alone: what they have left plus what they
 * already put in. Betting is stated as a TOTAL ("bet to 40"), not as an increment, so the
 * ceiling has to include the existing commitment.
 */
function ownStack(state: GameState, player: PlayerId): number {
  return state.bankroll[player] + state.hands[player].committed
}

/**
 * The EFFECTIVE stack: the most anyone can be committed to this hand.
 *
 * Capped by the SHORTER of the two stacks, because chips the opponent cannot cover can
 * never be won. In heads-up this is equivalent to running side pots — the excess would
 * just be returned — and it avoids modelling multiple pots entirely. Consequence: facing
 * an all-in short stack, the rich player simply cannot bet more than the short one has.
 */
export function maxBetFor(state: GameState, player: PlayerId): number {
  return Math.min(ownStack(state, player), ownStack(state, otherPlayer(player)))
}

/**
 * Guards a bet against the effective stack.
 *
 * This is the rule, so it lives in the engine: the UI clamps its input too, but a UI is
 * only a suggestion — the reducer is what makes a bankroll impossible to overdraw, for
 * the bot and for any future client alike.
 */
function assertAffordable(state: GameState, player: PlayerId, amount: number): void {
  const max = maxBetFor(state, player)
  assert(
    amount <= max,
    `bet of ${amount} exceeds the effective stack (max ${max})`,
  )
}

/**
 * True when neither player has anything left to wager, so a betting round would be a
 * formality with nothing at stake. Such rounds are SKIPPED rather than presented with
 * every action disabled — being asked to bet nothing is worse than not being asked.
 */
function noChipsBehind(state: GameState): boolean {
  return maxBetFor(state, 'human') <= 0 && maxBetFor(state, 'bot') <= 0
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
    case 'FOLD':
      return handleFold(state, action.player)
    case 'RAISE':
      return handleRaise(state, action.player, action.amount)
    case 'STEAL':
      return handleSteal(state, action.player, action.commonIndex)
    case 'REROLL':
      return handleReroll(state, action.player, action.ownIndices, action.torpedoTarget, rng)
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
  let next: GameState = {
    ...state,
    rollOff: { human, bot },
    primary: winner,
    phase: 'INITIAL_BET',
    toAct: winner, // primary opens the initial bet
  }
  next = withLog(
    next,
    `Tiro iniziale: Tu ${human.value} — Bot ${bot.value}. Inizia ${labelOf(winner)}.`,
  )

  // Nobody has chips left: skip the betting round entirely and deal. The hand still
  // plays out for the Bo3 point, it is just played for no money.
  if (noChipsBehind(next)) {
    next = withLog(next, 'Nessuno ha monete da puntare: si gioca la mano senza puntate.')
    return startHandAfterInitialBet(next, rng)
  }

  return next
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

  assertAffordable(state, player, amount)

  // The minimum and the bankroll ceiling can contradict each other: a player too poor to
  // meet the minimum must still be able to act (there is no fold in this game). So the
  // minimum is waived exactly when the player is shoving their whole stack.
  const max = maxBetFor(state, player)
  const min = Math.min(openMinimum(state), max)
  assert(amount >= min, `opening bet must be at least ${min}`)

  const hand = state.hands[player]
  const toPut = amount - hand.committed
  // Normally an open must add chips. A player with an empty bankroll is the exception:
  // they are already all-in from an earlier round, and with no fold in this game refusing
  // the action would leave them with no legal move at all.
  assert(
    toPut > 0 || state.bankroll[player] === 0,
    'opening bet must add chips on top of what is already committed',
  )

  const opponent = otherPlayer(player)
  const allIn = amount === max
  let next = commit(state, player, toPut)
  next = { ...next, currentBet: amount, aggressor: player, toAct: opponent }
  return withLog(
    next,
    `${labelOf(player)} punta ${amount}${allIn ? ' (all-in)' : ''}. Tocca a ${labelOf(opponent)}: vedi o rilancia.`,
  )
}

function handleCall(state: GameState, player: PlayerId, rng: Rng): GameState {
  assert(inBettingPhase(state), 'CALL only allowed in a betting phase')
  assert(state.toAct === player, 'not this player to act')
  // There is no check: a player may only CALL to match an existing bet.
  assert(state.aggressor !== null, 'nothing to call — the round has not been opened')

  const hand = state.hands[player]
  const owed = state.currentBet - hand.committed
  assert(owed >= 0, 'nothing to call implies negative match')

  // A caller can never owe more than they hold: cap at the bankroll (an all-in call).
  // Unlike OPEN/RAISE this is a clamp, not an assert — the amount is forced by the
  // opponent's bet, so refusing it would leave the player with no legal action at all.
  const toMatch = Math.min(owed, state.bankroll[player])

  const next = withLog(
    toMatch > 0 ? commit(state, player, toMatch) : state,
    toMatch < owed
      ? `${labelOf(player)} vede all-in (${toMatch}).`
      : `${labelOf(player)} vede (${toMatch}).`,
  )
  // A call that matches the current bet closes the round.
  return settleWindow(next, rng)
}

/**
 * Gives up the hand. The opponent takes the pot and the Bo3 point without a showdown.
 *
 * Only legal in SECOND_BET and only when facing a bet — the two restrictions the game
 * design calls for. Note there is no showdown info to record, so `lastShowdown` keeps
 * whatever the previous hand left; the UI reads `phase` to know a fold ended this one.
 */
function handleFold(state: GameState, player: PlayerId): GameState {
  assert(state.phase === 'SECOND_BET', 'FOLD only allowed in the second betting round')
  assert(state.toAct === player, 'not this player to act')
  assert(state.aggressor !== null, 'cannot fold when there is no bet to face')
  assert(state.aggressor !== player, 'cannot fold to your own bet')

  const winner = otherPlayer(player)
  const next = withLog(
    state,
    `${labelOf(player)} si ritira. ${labelOf(winner)} vince la mano senza showdown.`,
  )
  return resolveHand(next, { kind: 'win', winner })
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
  assertAffordable(state, player, amount)

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
  // Which special dice each seat gets is drawn fresh every hand (unless the seat is
  // pinned), so a lucky loadout is a property of the hand, not of the whole match.
  const loadouts = drawLoadouts(state, rng)

  // Own dice are rolled first (human then bot), then the common dice.
  const humanOwn = rollOwnDice(rng, loadouts.human)
  const botOwn = rollOwnDice(rng, loadouts.bot)
  const common = rollCommonDice(rng, state.abilityDrops)

  let next: GameState = {
    ...state,
    phase: 'STEAL',
    loadouts,
    common,
    firstBetAmount: state.currentBet,
    // Primary (the roll-off winner) steals first.
    toAct: state.primary,
  }
  next = setHand(next, 'human', { own: humanOwn })
  next = setHand(next, 'bot', { own: botOwn })

  // A Nero di Seppia in one seat's dice hides one of the OPPONENT's, so this has to run
  // after both hands exist.
  next = applyConcealment(next, rng)

  // Log the full flow: both players' rolled dice, then the common dice.
  //
  // Only the HUMAN's own concealed die is masked: the log is written for the human, so
  // printing their hidden face would undo the concealment instantly. The bot's dice stay
  // fully printed even when the bot itself cannot see one of them — that asymmetry IS the
  // advantage a Nero di Seppia buys, and hiding it here would rob the caster of it.
  next = withLog(
    next,
    `Lancio — Tu: ${handStr(next, 'human')}. Bot: ${diceStr(botOwn)}.`,
  )
  next = withLog(
    next,
    `Dadi comuni: ${diceStr(common)}. Ruba per primo ${labelOf(state.primary)}.`,
  )
  return next
}

/**
 * Applies every Nero di Seppia on the table.
 *
 * Two sources, both handled here:
 *
 * - IN A SEAT'S OWN DICE: that seat conceals a single random die of the OPPONENT's four.
 *   Symmetric by construction — if both seats rolled one, both lose sight of a die.
 * - AMONG THE COMMON DICE: it belongs to nobody yet, so it blinds BOTH seats at once. Once
 *   a player steals it the malus narrows to the opponent only (see releaseCommonConcealment);
 *   if nobody steals it, both stay blind to the showdown.
 *
 * The choice of which die is uniform (per the design call) and drawn from the match Rng, so
 * it replays identically from a seed.
 */
function applyConcealment(state: GameState, rng: Rng): GameState {
  let next = state
  for (const seat of ['human', 'bot'] as const) {
    const own = state.hands[seat].own
    if (own === null || !own.some((d) => d.ability === 'NERO_DI_SEPPIA')) {
      continue
    }
    // The victim is the opponent: they lose sight of one of THEIR OWN dice.
    const victim = otherPlayer(seat)
    const hidden = rng.nextInt(0, 3)
    next = setHand(next, victim, { concealedIndices: [hidden] })
    next = withLog(
      next,
      `${labelOf(seat)} lancia il Nero di Seppia: un dado di ${labelOf(victim)} è nascosto fino allo showdown.`,
    )
  }

  // A common Nero di Seppia is unowned, so it hits both seats until someone claims it.
  if (unclaimedCommonIndex(next, 'NERO_DI_SEPPIA') !== null) {
    for (const seat of ['human', 'bot'] as const) {
      // Never stack a second hidden die on a seat already blinded by an own-dice Seppia:
      // the ability conceals ONE die, and two would be a strictly harsher malus than the
      // owned version. The existing concealment already covers this seat.
      if (next.hands[seat].concealedIndices.length > 0) {
        continue
      }
      next = setHand(next, seat, { concealedIndices: [rng.nextInt(0, 3)] })
    }
    next = withLog(
      next,
      'Nero di Seppia tra i comuni: finché nessuno lo ruba, entrambi hanno un dado nascosto.',
    )
  }
  return next
}

/**
 * Index of a common die carrying `ability` while it is still unclaimed, or null.
 *
 * Returns null once that die has been stolen: at that point it is a seat's die, not a table
 * effect, so any "applies to both" rule stops holding. Shared by the two abilities with a
 * table-wide form — NERO_DI_SEPPIA (blinds both) and DADO_D_ORO (doubles for whoever wins).
 */
/**
 * Whether `seat` owns a die carrying `ability` — among its 4 own dice or as its stolen die.
 *
 * The stolen die counts: taking a special from the commons is the intended way to acquire
 * one, so an ability must work the same whether it was dealt or stolen.
 */
function seatHolds(state: GameState, seat: PlayerId, ability: AbilityId): boolean {
  const hand = state.hands[seat]
  return (
    (hand.own ?? []).some((d) => d.ability === ability) || hand.stolen?.ability === ability
  )
}

function unclaimedCommonIndex(state: GameState, ability: AbilityId): number | null {
  if (state.common === null) {
    return null
  }
  const index = state.common.findIndex((d) => d.ability === ability)
  if (index === -1 || state.stolenCommonIndices.includes(index)) {
    return null
  }
  return index
}

/**
 * Narrows a common Nero di Seppia's malus to the opponent once `stealer` claims it.
 *
 * The stealer earned the die, so they get their sight back; the opponent keeps a die
 * hidden, which is exactly how an owned Nero di Seppia behaves. Call AFTER the steal has
 * been recorded in `stolenCommonIndices`.
 *
 * Only clears concealment the COMMON die caused: if the opponent also rolled their own
 * Seppia, the stealer is blinded by that too and stealing the common one must not undo it.
 */
function releaseCommonConcealment(state: GameState, stealer: PlayerId): GameState {
  const blindedByOpponent = (state.hands[otherPlayer(stealer)].own ?? []).some(
    (d) => d.ability === 'NERO_DI_SEPPIA',
  )
  if (blindedByOpponent || state.hands[stealer].concealedIndices.length === 0) {
    return state
  }
  return withLog(
    setHand(state, stealer, { concealedIndices: [] }),
    `Nero di Seppia rubato da ${labelOf(stealer)}: ora il malus colpisce solo ${labelOf(otherPlayer(stealer))}.`,
  )
}

/** Formats a seat's own dice for the log, masking the ones that seat cannot see. */
function handStr(state: GameState, seat: PlayerId): string {
  const own = state.hands[seat].own
  if (own === null) {
    return '—'
  }
  const concealed = new Set(state.hands[seat].concealedIndices)
  return own.map((die, i) => (concealed.has(i) ? '?' : dieStr(die))).join(', ')
}

/**
 * Loadouts for the hand about to start, per seat's configured source.
 *
 * Drawn human-then-bot so the Rng stream has a predictable shape. Note the two random
 * modes consume different numbers of draws, so a seed does not produce the same dice
 * across modes — expected, they are different games.
 */
function drawLoadouts(state: GameState, rng: Rng): Readonly<Record<PlayerId, Loadout>> {
  return {
    human: drawLoadoutFor(state, 'human', rng),
    bot: drawLoadoutFor(state, 'bot', rng),
  }
}

function drawLoadoutFor(state: GameState, seat: PlayerId, rng: Rng): Loadout {
  switch (state.ownDiceSource[seat].kind) {
    case 'pinned':
      return state.loadouts[seat]
    case 'deck': {
      const deck = state.decks[seat]
      assert(deck !== null, `${seat} is in deck mode but has no deck`)
      return drawHandFromDeck(rng, deck)
    }
    case 'drops':
      return rollRandomLoadout(rng, state.abilityDrops)
  }
}

/**
 * Formats a list of dice as their values, e.g. "3, 5, 5, 1".
 * A die with an ability shows what it rolled and what it kept, e.g. "☘6 (2/6/3)", so the
 * log makes the ability's effect visible rather than silent.
 */
function diceStr(dice: readonly Die[]): string {
  return dice.map(dieStr).join(', ')
}

/** Formats one die, annotating an ability roll with its icon and the faces it produced. */
function dieStr(die: Die): string {
  const spec = abilitySpec(die.ability)
  if (spec === null) {
    return `${die.value}`
  }
  // Only a multi-face ability has a split worth spelling out; a single-face one (the D4)
  // still gets its icon, so the log never hides which die produced the value.
  const split = die.rolls !== undefined && die.rolls.length > 1 ? ` (${die.rolls.join('/')})` : ''
  return `${spec.icon}${die.value}${split}`
}

// --- STEAL ---

function handleSteal(state: GameState, player: PlayerId, commonIndex: number): GameState {
  assert(state.phase === 'STEAL', 'STEAL only allowed in STEAL phase')
  assert(state.toAct === player, 'not this player to steal')
  assert(state.common !== null, 'no common dice to steal from')
  assert(commonIndex >= 0 && commonIndex < state.common.length, 'invalid common index')
  assert(!state.stolenCommonIndices.includes(commonIndex), 'that common die is already taken')

  const stolen = state.common[commonIndex]!
  const wasCommonSeppia = unclaimedCommonIndex(state, 'NERO_DI_SEPPIA') === commonIndex
  let next = setHand(state, player, { stolen })
  next = {
    ...next,
    stolenCommonIndices: [...next.stolenCommonIndices, commonIndex],
  }
  next = withLog(next, `${labelOf(player)} ruba il dado ${stolen.value}.`)

  // Claiming the common Nero di Seppia turns a table-wide malus into a one-sided one.
  if (wasCommonSeppia) {
    next = releaseCommonConcealment(next, player)
  }

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
  torpedoTarget: number | undefined,
  rng: Rng,
): GameState {
  assert(state.phase === 'REROLL_SELECT', 'REROLL only allowed in REROLL_SELECT')
  assert(state.toAct === player, 'not this player to choose reroll')
  assert(state.hands[player].rerollSelection === null, 'reroll already chosen')

  // The Torpedo's victim is picked here but zapped at the showdown. Required if and only if
  // this seat holds one: demanding it stops a client from silently forfeiting the effect,
  // and rejecting it otherwise stops one from zapping without the die.
  const holdsTorpedo = seatHolds(state, player, 'DADO_TORPEDO')
  if (holdsTorpedo) {
    assert(torpedoTarget !== undefined, 'a Dado Torpedo must choose a target die')
    assert(
      Number.isInteger(torpedoTarget) && torpedoTarget >= 0 && torpedoTarget < 4,
      'torpedo target must be an opponent own-dice index 0..3',
    )
  } else {
    assert(torpedoTarget === undefined, 'only a Dado Torpedo holder may choose a target')
  }

  const unique = [...new Set(ownIndices)]
  assert(unique.length === ownIndices.length, 'duplicate reroll indices')
  assert(
    unique.every((i) => i >= 0 && i < 4),
    'reroll indices must be own-dice indices 0..3',
  )
  assert(unique.length <= MAX_REROLL, `at most ${MAX_REROLL} own dice may be rerolled`)
  // All 4 own dice may be rerolled; only the stolen die is fixed (and is not indexable here).

  let next = setHand(state, player, {
    rerollSelection: unique,
    torpedoTarget: torpedoTarget ?? null,
  })
  next = withLog(
    next,
    unique.length > 0
      ? `${labelOf(player)} rilancerà ${unique.length} dad${unique.length === 1 ? 'o' : 'i'}.`
      : `${labelOf(player)} tiene tutti i dadi.`,
  )
  if (torpedoTarget !== undefined) {
    // Announce the choice, not the damage: the victim may still reroll that die, and the
    // value it ends up losing is only known at the showdown.
    next = withLog(
      next,
      `${labelOf(player)} punta il Dado Torpedo sul dado ${torpedoTarget + 1} di ${labelOf(otherPlayer(player))}.`,
    )
  }

  const nonPrimary = otherPlayer(state.primary)
  if (player === state.primary) {
    return { ...next, toAct: nonPrimary }
  }
  // Both selections in -> SECOND_BET. Primary acts first (check or bet).
  return enterSecondBet(next, rng)
}

function enterSecondBet(state: GameState, rng: Rng): GameState {
  // The second bet is a fresh betting round: the first-round chips are already in the pot
  // and stay there, so we reset each player's per-round `committed` to 0 and start with no
  // bet on the table. The primary must OPEN with an amount >= the first bet (openMinimum),
  // then the opponent must see, raise or fold.
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

  // Someone is already all-in from the first round: there is nothing left to wager, so
  // go straight to the showdown rather than asking for a bet nobody can make.
  if (noChipsBehind(reset)) {
    return goToShowdown(
      withLog(reset, 'Nessuno ha altre monete da puntare: si va direttamente allo showdown.'),
      rng,
    )
  }

  return withLog(
    reset,
    `Seconda scommessa — punta ${labelOf(state.primary)} (minimo ${state.firstBetAmount}).`,
  )
}

// --- SHOWDOWN ---

/**
 * Rerolls the selected own dice. A rerolled die keeps its ability: the ability belongs to
 * the physical die the player owns, so a Stella Essiccata re-splits into 3 on every reroll.
 */
function applyReroll(own: OwnDice, selection: readonly number[], rng: Rng): OwnDice {
  const set = new Set(selection)
  const after = own.map((die, i) => (set.has(i) ? rerollDie(rng, die) : die))
  return [after[0]!, after[1]!, after[2]!, after[3]!]
}

function finalHandOf(hand: PlayerHandState, rng: Rng): Hand {
  assert(hand.own !== null && hand.stolen !== null, 'incomplete hand at showdown')
  const selection = hand.rerollSelection ?? []
  const own = applyReroll(hand.own, selection, rng)
  return [own[0], own[1], own[2], own[3], hand.stolen]
}

/** Chance that a Torpedo electrifies the whole field, zapping its own owner too. */
const TORPEDO_FIELD_CHANCE = 0.1

/** A die with 1 subtracted, floored at 1. */
function zapDie(die: Die): Die {
  // Floored by hand: DieValue is a compile-time union only, every producer casts with `as`,
  // and nothing downstream clamps. A 0 would reach evaluateHand and break handScore, whose
  // base-7 encoding documents "die values are 1..6".
  const value = (die.value > 1 ? die.value - 1 : 1) as DieValue
  return { ...die, value }
}

/** Replaces one own-die (index 0..3) of a 5-die hand, leaving the stolen die untouched. */
function withZappedOwn(hand: Hand, index: number): Hand {
  const zapped = zapDie(hand[index]!)
  const next = [hand[0], hand[1], hand[2], hand[3], hand[4]]
  next[index] = zapped
  return [next[0]!, next[1]!, next[2]!, next[3]!, next[4]!]
}

/**
 * Applies every Dado Torpedo in play to the two FINAL hands.
 *
 * Runs at the showdown, after the rerolls, which is what makes the -1 unavoidable — see the
 * ability's note in types.ts. Works on the local hands rather than on state because at this
 * point the final hands exist only as locals; goToShowdown persists them right after.
 *
 * Two sources, mirroring NERO_DI_SEPPIA:
 *  - HELD by a seat: that seat CHOSE the victim die during REROLL_SELECT (torpedoTarget),
 *    and a 10% "electrified field" costs the owner a random die of their own too.
 *  - UNSTOLEN among the commons: it belongs to nobody, so there is nobody to choose. Each
 *    seat loses a random die.
 *
 * Rng discipline: per Torpedo the SAME draws are consumed whatever the outcome — the field
 * roll, then the owner's own target index even when the field does not trigger. A draw count
 * that varied with the outcome would shift the downstream stream and break seeded replay
 * (same rule as drawAbilitySlots in strategy.ts).
 */
function applyTorpedoes(
  hands: { human: Hand; bot: Hand },
  state: GameState,
  rng: Rng,
): { hands: { human: Hand; bot: Hand }; logs: readonly string[] } {
  let next = { ...hands }
  const logs: string[] = []

  for (const seat of ['human', 'bot'] as const) {
    if (!seatHolds(state, seat, 'DADO_TORPEDO')) {
      continue
    }
    const victim = otherPlayer(seat)
    const target = state.hands[seat].torpedoTarget
    // Always drawn, in this order, so the stream does not depend on either outcome.
    const electrifies = rng.next() < TORPEDO_FIELD_CHANCE
    const selfIndex = rng.nextInt(0, 3)

    if (target !== null) {
      const before = next[victim][target]!.value
      next = { ...next, [victim]: withZappedOwn(next[victim], target) }
      logs.push(
        `Dado Torpedo di ${labelOf(seat)}: il dado ${target + 1} di ${labelOf(victim)} scende da ${before} a ${next[victim][target]!.value}.`,
      )
    }
    if (electrifies) {
      const before = next[seat][selfIndex]!.value
      next = { ...next, [seat]: withZappedOwn(next[seat], selfIndex) }
      logs.push(
        `Campo elettrizzato! Anche il dado ${selfIndex + 1} di ${labelOf(seat)} scende da ${before} a ${next[seat][selfIndex]!.value}.`,
      )
    }
  }

  // An unclaimed common Torpedo has no owner, so nobody chose: a random die each.
  if (unclaimedCommonIndex(state, 'DADO_TORPEDO') !== null) {
    for (const seat of ['human', 'bot'] as const) {
      const index = rng.nextInt(0, 3)
      const before = next[seat][index]!.value
      next = { ...next, [seat]: withZappedOwn(next[seat], index) }
      logs.push(
        `Dado Torpedo tra i comuni: il dado ${index + 1} di ${labelOf(seat)} scende da ${before} a ${next[seat][index]!.value}.`,
      )
    }
  }

  return { hands: next, logs }
}

function goToShowdown(state: GameState, rng: Rng): GameState {
  const rerolled = {
    human: finalHandOf(state.hands.human, rng),
    bot: finalHandOf(state.hands.bot, rng),
  }

  // Zap AFTER the rerolls: applying a Torpedo any earlier would let the victim reroll the
  // marked die and wipe the -1 for free, since a reroll rebuilds a die from its ability.
  const zapped = applyTorpedoes(rerolled, state, rng)
  const humanHand = zapped.hands.human
  const botHand = zapped.hands.bot

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
  // THE REVEAL: the showdown is exactly when concealment ends, so clearing it here is
  // what makes a Nero di Seppia last "until the end of the hand" and no longer.
  next = setHand(next, 'human', { own: humanOwn, concealedIndices: [] })
  next = setHand(next, 'bot', { own: botOwn, concealedIndices: [] })
  // Torpedo lines come BEFORE the dice line, which already shows the reduced values: an
  // unexplained face that differs from what was on the table reads as a bug.
  for (const line of zapped.logs) {
    next = withLog(next, line)
  }
  // Log the post-reroll dice so ability splits on rerolled dice are visible too. Safe to
  // print in full: nothing is concealed any more.
  next = withLog(next, `Dopo il rilancio — Tu: ${diceStr(humanOwn)}. Bot: ${diceStr(botOwn)}.`)
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
 * Where a Dado d'Oro is doubling the payout from, or null if nothing is.
 *
 * Two sources, checked in this order and NEVER combined — doubling is a switch, not a
 * counter, so a seat holding one while another sits unclaimed on the table still collects
 * exactly 2x:
 *
 *  - 'held':  among the winner's 4 own dice or their stolen die. Stealing it from the
 *             commons is the intended way to acquire one, so the stolen die counts.
 *  - 'table': still among the commons, unstolen. It belongs to nobody, so it doubles for
 *             WHOEVER wins — including the seat that never touched it.
 *
 * Defensive on incomplete hands: a fold can resolve before both hands are formed, in which
 * case `own`/`stolen` are null and only the table source can apply.
 */
function goldenPayoutSource(state: GameState, winner: PlayerId): 'held' | 'table' | null {
  if (seatHolds(state, winner, 'DADO_D_ORO')) {
    return 'held'
  }
  return unclaimedCommonIndex(state, 'DADO_D_ORO') !== null ? 'table' : null
}

/**
 * Awards the pot per the outcome, updates score, and moves to HAND_COMPLETE (or
 * MATCH_OVER).
 *
 * A total tie splits the pot evenly and changes no score (the hand is replayed); a Dado
 * d'Oro does nothing there, because a tie is not a win.
 *
 * The winning branch is the ONLY place a payout multiplier applies, which is what makes it
 * cover both ways to win a hand — showdown (goToShowdown) and fold (handleFold) both land
 * here. The doubled coins are minted rather than taken from the loser: the loser is out
 * exactly what they bet, win or lose. Total coins on the table therefore grow, which is
 * harmless because the match ends on WINS_TO_TAKE_MATCH, not on bankruptcy.
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
    const golden = goldenPayoutSource(next, winner)
    const pot = next.pot
    const payout = golden === null ? pot : pot * 2
    next = {
      ...next,
      bankroll: { ...next.bankroll, [winner]: next.bankroll[winner] + payout },
      pot: 0,
      score: { ...next.score, [winner]: next.score[winner] + 1 },
    }
    if (golden !== null) {
      // Say WHICH source doubled it: with a die on the table the winner may never have
      // touched a Dado d'Oro, and an unexplained double payout reads as a bug.
      const why =
        golden === 'held' ? 'in mano' : 'lasciato tra i comuni: vale per chi vince'
      next = withLog(
        next,
        `Dado d'Oro (${why}) — ${labelOf(winner)} incassa il doppio: ${payout} invece di ${pot}.`,
      )
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
