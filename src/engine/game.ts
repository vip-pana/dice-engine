// Match state machine: a reducer over GameState, driven by Action.
//
// Design: pure and deterministic. All randomness comes from an injected Rng, threaded
// through the reducer's third argument. The reducer NEVER mutates its input; it returns
// a fresh GameState. Invalid actions for the current phase throw (the UI/bot only ever
// send legal actions; tests assert the guards).

import { evaluateHand, compareHands } from './hand'
import {
  NO_MODIFIERS,
  abilitySpec,
  isSpongeable,
  rerollDie,
  type RollModifiers,
} from './abilities'
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
    mulinelloUsed: false,
    paguroChosen: false,
    spongeTarget: null,
    lanternaUsed: false,
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
      return handleReroll(
        state,
        action.player,
        action.ownIndices,
        action.torpedoTarget,
        action.spongeTarget,
        rng,
      )
    case 'MULINELLO_ROLL':
      return handleMulinello(state, action.player, true, rng)
    case 'MULINELLO_PASS':
      return handleMulinello(state, action.player, false, rng)
    case 'PAGURO_CHOOSE':
      return handlePaguroChoose(state, action.player, action.index, rng)
    case 'LANTERNA_PEEK':
      return handleLanternPeek(state, action.player)
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

/**
 * Whether a Dado Lanterna could be used to peek right now — "from the deal to the showdown".
 *
 * Exported because the UI needs the same answer to decide whether to offer the button, and a
 * duplicated phase list there would drift. The reducer stays the authority.
 *
 * Why exactly these four:
 *  - ROLL_OFF / INITIAL_BET: the dice do not exist yet (`own` is null), so nobody can be
 *    holding a lantern. Excluded explicitly so the guard fails with "no lantern" honestly
 *    rather than by accident.
 *  - SHOWDOWN: never observable. goToShowdown sets it and then tail-calls resolveHand, which
 *    overwrites it with HAND_COMPLETE or MATCH_OVER in the same step — no reducer output ever
 *    carries it, so listing it would be dead code.
 *  - HAND_COMPLETE / MATCH_OVER: the hand is over and so is its lantern. Allowing a peek here
 *    would let a player bank one they declined to spend.
 */
export function inPeekablePhase(state: GameState): boolean {
  return (
    state.phase === 'STEAL' ||
    state.phase === 'REROLL_SELECT' ||
    state.phase === 'MULINELLO_SELECT' ||
    state.phase === 'PAGURO_SELECT' ||
    state.phase === 'SECOND_BET'
  )
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
  // SECOND_BET settled -> NOW the reroll happens, choice and throw together. The betting is over
  // before any of it, which is the whole point: you commit chips to the hand you were dealt, and
  // only then decide what to gamble away.
  return enterRerollSelect(state)
}

// --- Transition: initial bet settled -> roll dice, go to STEAL ---

function startHandAfterInitialBet(state: GameState, rng: Rng): GameState {
  // Which special dice each seat gets is drawn fresh every hand (unless the seat is
  // pinned), so a lucky loadout is a property of the hand, not of the whole match.
  const loadouts = drawLoadouts(state, rng)

  // Own dice are rolled first (human then bot), then the common dice.
  //
  // A Dado Brumeggio fogs from the very FIRST roll, so the modifiers are derived before any
  // die is thrown — an opponent's fog is already in force on the roll that reveals it. Note
  // `loadouts` is passed explicitly: see isFogged for why state.loadouts is the wrong source
  // at this exact instant.
  const humanOwn = rollOwnDice(rng, loadouts.human, modsFor(state, 'human', loadouts))
  const botOwn = rollOwnDice(rng, loadouts.bot, modsFor(state, 'bot', loadouts))
  // The commons are rolled with no modifiers, deliberately: they belong to nobody when they
  // are thrown, so no seat's fog applies to them.
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

  // A landed fog is announced BEFORE the dice, so a reader meets the rule before the doubled
  // faces it explains — the same ordering goToShowdown uses for the Torpedo's lines. Consumes
  // no Rng and touches no state: isFogged is derived, so this is purely the record.
  for (const seat of ['human', 'bot'] as const) {
    if (isFogged(next, seat, loadouts)) {
      // Phrased to put the victim in the SUBJECT rather than after a preposition: labelOf gives
      // "Tu" for the human, and "i dadi di Tu" is not Italian. The existing lines get away with
      // "di Tu" only because the human is rarely the object there.
      const victim = seat === 'human' ? 'i tuoi dadi escono' : 'i dadi del Bot escono'
      next = withLog(
        next,
        `${labelOf(otherPlayer(seat))} lancia il Brumeggio: ${victim} due volte e tengono il più basso.`,
      )
    }
  }

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
 * Whether `seat` owns a die carrying `ability` — among its 4 own dice or as its stolen die.
 *
 * The stolen die counts: taking a special from the commons is the intended way to acquire
 * one, so an ability must work the same whether it was dealt or stolen.
 *
 * RAW ownership, ignoring any Dado Spugna. Most effects want `seatHoldsActive` instead; this
 * one is for the two places that must answer "is the die physically there" regardless.
 */
function seatHolds(state: GameState, seat: PlayerId, ability: AbilityId): boolean {
  const hand = state.hands[seat]
  return (
    (hand.own ?? []).some((d) => d.ability === ability) || hand.stolen?.ability === ability
  )
}

/**
 * Index of a common die carrying `ability` while it is still unclaimed, or null.
 *
 * Returns null once that die has been stolen: at that point it is a seat's die, not a table
 * effect, so any "applies to both" rule stops holding. Shared by the two abilities with a
 * table-wide form — NERO_DI_SEPPIA (blinds both) and DADO_D_ORO (doubles for whoever wins).
 *
 * Like seatHolds, this ignores Spugne — see `unclaimedCommonActiveFor`, which does not.
 */
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
 * Whether `seat` has soaked up `ability` with its own Dado Spugna.
 *
 * ONE seat, ONE question: "did this seat cancel that ability?" Every caller has to name the
 * seat holding the sponge — the protected one — and never the seat whose effect is firing. An
 * earlier draft folded the opponent lookup in here and got the direction silently backwards
 * for table effects, protecting the wrong player; keeping the helper direction-free means each
 * call site has to state who is protected, out loud, where a reader can check it.
 *
 * `spongeTarget` is only ever set to a spongeable id, and only for a seat that really holds a
 * Spugna (handleReroll enforces both), so there is nothing left to re-derive here.
 */
function hasSponged(state: GameState, seat: PlayerId, ability: AbilityId): boolean {
  return state.hands[seat].spongeTarget === ability
}

/**
 * Ownership AND not cancelled by the opponent — the form nearly every effect wants.
 *
 * `seat` is the ability's OWNER here, so the sponge to check is the other seat's: the victim is
 * the one with a reason to have cancelled it.
 *
 * Deliberately a separate function rather than folded into `seatHolds`: two call sites must NOT
 * nullify (the reroll-target validation and handleMulinello's legality guard, both marked at
 * their site), and a helper that silently nullified everywhere would break them.
 */
function seatHoldsActive(state: GameState, seat: PlayerId, ability: AbilityId): boolean {
  return seatHolds(state, seat, ability) && !hasSponged(state, otherPlayer(seat), ability)
}

/**
 * Whether `seat`'s dice are rolling in fog — an OPPONENT holds an active Dado Brumeggio.
 *
 * TWO SOURCES, and they are not interchangeable. The FIRST roll of the hand happens inside
 * startHandAfterInitialBet, where the hands do not exist yet (`own` is null, nothing has been
 * stolen) — only the loadouts have been drawn, a few lines earlier. Every LATER roll (both
 * rerolls, and a Mulinello's third) happens with the hands fully formed, where seatHoldsActive
 * is the right question because it also counts a die stolen from the commons and it respects
 * a Spugna.
 *
 * Hence `loadouts` as an explicit parameter rather than a lookup on state: at first-roll time
 * `state.loadouts` is still the PREVIOUS hand's for a drops- or deck-mode seat, because
 * drawLoadouts returns the new ones and they are only written into the state afterwards.
 * Passing them in is what stops this reading a stale hand.
 *
 * WHICH SEAT'S SPONGE: seatHoldsActive takes the ability's OWNER and looks up the other seat's
 * spongeTarget itself. So `opponent` goes in as the owner, and the seat being protected is
 * `seat` — the one in the fog, the one with a reason to have sponged. Said out loud because
 * hasSponged's doc records a past bug where exactly this direction was silently backwards.
 *
 * An unowned common Brumeggio is NOT a source: "the opponent's rolls" means nothing for a die
 * still sitting at the centre. See the spec comment in abilities.ts for why that differs from
 * the Torpedo, which does stay live unowned.
 */
function isFogged(
  state: GameState,
  seat: PlayerId,
  loadouts?: Readonly<Record<PlayerId, Loadout>>,
): boolean {
  const opponent = otherPlayer(seat)
  if (loadouts !== undefined) {
    // FIRST ROLL. No hands, no steals, and no Spugna yet — REROLL_SELECT is two phases away —
    // so scanning the opponent's loadout is the whole answer.
    return loadouts[opponent].includes('DADO_BRUMEGGIO')
  }
  return seatHoldsActive(state, opponent, 'DADO_BRUMEGGIO')
}

/** The roll modifiers in force for `seat` right now. See isFogged for the two sources. */
function modsFor(
  state: GameState,
  seat: PlayerId,
  loadouts?: Readonly<Record<PlayerId, Loadout>>,
): RollModifiers {
  return { fogged: isFogged(state, seat, loadouts) }
}

/**
 * Whether `seat` is rolling in fog. Exported so the UI asks the reducer rather than keeping
 * its own copy of the rule (same reasoning as inPeekablePhase and maxBetFor).
 *
 * Only the post-first-roll source is exposed: from STEAL onwards the hands exist, which is
 * every phase the UI renders. The loadouts overload is an internal detail of one transition.
 */
export function seatIsFogged(state: GameState, seat: PlayerId): boolean {
  return isFogged(state, seat)
}

/**
 * `unclaimedCommonIndex`, unless `protectedSeat` has sponged that ability.
 *
 * Per-seat, because a table effect is now asymmetric: one seat may have soaked up the common
 * Torpedo while the other still eats it. The parameter is named for what it means — the seat
 * being spared — because "seat" alone is exactly the ambiguity that produced a reversed check.
 */
function unclaimedCommonActiveFor(
  state: GameState,
  protectedSeat: PlayerId,
  ability: AbilityId,
): number | null {
  return hasSponged(state, protectedSeat, ability) ? null : unclaimedCommonIndex(state, ability)
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

/**
 * Gives a sponging seat its sight back, when what it sponged was a Nero di Seppia.
 *
 * The one ability the Spugna REVERSES rather than prevents. applyConcealment runs on entry
 * into STEAL, long before a sponge target can be named, so by the time this fires the dice are
 * already hidden — there is nothing left to stop, only something to undo.
 *
 * Unlike releaseCommonConcealment, this clears the concealment whatever its source: the sponge
 * cancels the ABILITY, so it does not matter whether the blinding came from the opponent's own
 * die or from an unstolen common one.
 *
 * ORDER MATTERS, and unequally. REROLL_SELECT is sequential, so the primary sponges before
 * choosing its reroll and gets its sight back in time to use it; the non-primary sends both in
 * one action and the dice are thrown immediately after, so it recovers sight only for the
 * second bet. That is a real power difference attached to the primary role — documented rather
 * than levelled, since the roll-off already confers first-mover advantage everywhere else.
 */
function restoreSightIfSponged(
  state: GameState,
  player: PlayerId,
  target: AbilityId,
): GameState {
  if (target !== 'NERO_DI_SEPPIA' || state.hands[player].concealedIndices.length === 0) {
    return state
  }
  return withLog(
    setHand(state, player, { concealedIndices: [] }),
    `Il Nero di Seppia è assorbito: ${labelOf(player)} rivede tutti i suoi dadi.`,
  )
}

/** Formats a seat's own dice for the log, masking the ones that seat cannot see. */
function handStr(state: GameState, seat: PlayerId): string {
  const hand = state.hands[seat]
  const own = hand.own
  if (own === null) {
    return '—'
  }
  const concealed = new Set(hand.concealedIndices)
  return own
    .map((die, i) => {
      if (concealed.has(i)) {
        return '?'
      }
      // A Paguro not yet picked is covered: printing its value/split would spoil the blind
      // choice in the log (this runs at "Dopo il rilancio", before PAGURO_SELECT).
      if (die.ability === 'DADO_PAGURO' && !hand.paguroChosen) {
        return `${abilitySpec(die.ability)?.icon}?`
      }
      return dieStr(die)
    })
    .join(', ')
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
  // Only a multi-face roll has a split worth spelling out; a single-face ability (the D4)
  // still gets its icon, so the log never hides which die produced the value.
  //
  // Gated on `rolls` alone rather than on having an ability: a PLAIN die rolled in fog has two
  // faces and no ability of its own, and printing "2 (5/2)" is the clearest way the fog reads
  // as a rule rather than as bad luck. A clear plain die still has no `rolls` at all, so it
  // stays the bare value it always was.
  const split = die.rolls !== undefined && die.rolls.length > 1 ? ` (${die.rolls.join('/')})` : ''
  if (spec === null) {
    return `${die.value}${split}`
  }
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
  // dieStr, not stolen.value: a bare number would hide that an ABILITY just changed hands,
  // which is the most consequential thing a steal can do.
  next = withLog(next, `${labelOf(player)} ruba il dado ${dieStr(stolen)}.`)

  // Claiming the common Nero di Seppia turns a table-wide malus into a one-sided one.
  if (wasCommonSeppia) {
    next = releaseCommonConcealment(next, player)
  }

  const nonPrimary = otherPlayer(state.primary)
  if (player === state.primary) {
    // Primary stole first; non-primary steals next.
    return { ...next, toAct: nonPrimary }
  }
  // Non-primary just stole (second). Both hands are now complete as dealt, so the second
  // betting round opens — BEFORE anything to do with the reroll. You wager on the hand you can
  // see, then you decide what to throw away and throw it.
  return enterSecondBet(next)
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
  spongeTarget: AbilityId | undefined,
  rng: Rng,
): GameState {
  assert(state.phase === 'REROLL_SELECT', 'REROLL only allowed in REROLL_SELECT')
  assert(state.toAct === player, 'not this player to choose reroll')
  assert(state.hands[player].rerollSelection === null, 'reroll already chosen')

  // The Torpedo's victim is picked here but zapped at the showdown. Required if and only if
  // this seat holds one: demanding it stops a client from silently forfeiting the effect,
  // and rejecting it otherwise stops one from zapping without the die.
  //
  // seatHolds, NOT seatHoldsActive — deliberately. This asks "is the die there", which a
  // Spugna does not change. A sponged Torpedo still names its victim and still logs the aim;
  // only the damage is cancelled, at apply time. Nullifying here instead would break this
  // phase's sequential order: the opponent may sponge AFTER this seat's client already
  // computed a target, and the else-branch below would then reject a perfectly good action.
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

  // The Spugna's target, by contrast, is never REQUIRED and never rejected for lack of the
  // die — see RerollAction's comment for why the asymmetry is deliberate. What IS rejected is
  // a target that cannot be sponged: a client naming a Stella or another Spugna has a bug,
  // and a silent no-op would hide it.
  if (spongeTarget !== undefined) {
    assert(
      spongeTarget !== 'DADO_SPUGNA',
      'a Dado Spugna cannot absorb another Dado Spugna',
    )
    assert(
      isSpongeable(spongeTarget),
      `${spongeTarget} cannot be absorbed: its face is decided when the die is rolled`,
    )
  }

  const unique = [...new Set(ownIndices)]
  assert(unique.length === ownIndices.length, 'duplicate reroll indices')
  assert(
    unique.every((i) => i >= 0 && i < 4),
    'reroll indices must be own-dice indices 0..3',
  )
  assert(unique.length <= MAX_REROLL, `at most ${MAX_REROLL} own dice may be rerolled`)
  // All 4 own dice may be rerolled; only the stolen die is fixed (and is not indexable here).

  // Recorded whether or not this seat holds a Spugna: isNullified is only ever consulted for a
  // seat that does, so an ignored target costs nothing and keeps every client simple.
  const sponges = spongeTarget !== undefined && seatHolds(state, player, 'DADO_SPUGNA')
  let next = setHand(state, player, {
    rerollSelection: unique,
    torpedoTarget: torpedoTarget ?? null,
    spongeTarget: sponges ? spongeTarget : null,
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
  if (sponges) {
    next = withLog(
      next,
      `${labelOf(player)} usa il Dado Spugna su ${abilitySpec(spongeTarget)?.name}.`,
    )
    next = restoreSightIfSponged(next, player, spongeTarget!)
  }

  const nonPrimary = otherPlayer(state.primary)
  if (player === state.primary) {
    return { ...next, toAct: nonPrimary }
  }

  // Both selections in, so the dice are thrown right now — choice and throw in one step, with no
  // betting round in between for them to inform. The betting already happened, back before either
  // seat had committed to a selection.
  //
  // Rolling both seats together (rather than each at its own REROLL) keeps neither seat's blind
  // selection informed by the other's outcome.
  next = applyRerollSelections(next, rng)
  return afterRerollResolved(next, rng)
}

/** Throws each seat's chosen dice and persists the results into `own`. */
function applyRerollSelections(state: GameState, rng: Rng): GameState {
  let next = state
  for (const seat of ['human', 'bot'] as const) {
    const hand = next.hands[seat]
    assert(hand.own !== null, 'reroll resolved before the dice were rolled')
    // No `loadouts` argument here: the hands exist, so seatHoldsActive is the right source —
    // it counts a stolen Brumeggio and, crucially, it respects a Spugna.
    //
    // THE ORDERING THAT MAKES A SPONGED FOG LIFT: handleReroll writes spongeTarget onto the
    // state before it calls this, so a Spugna named this very phase is already visible to
    // seatHoldsActive by the time the dice are thrown. That is the whole mechanism — the fog
    // is derived per roll, never stored, so there is nothing to clear. Move the sponge write
    // after this call and the lift silently stops working.
    const own = applyReroll(hand.own, hand.rerollSelection ?? [], rng, modsFor(next, seat))
    next = setHand(next, seat, { own })
  }
  // Printed even when nothing was rerolled: the line is the record of what the betting was
  // resolved into — the first time anyone, player or bot, sees these values.
  return withLog(
    next,
    `Dopo il rilancio — Tu: ${handStr(next, 'human')}. Bot: ${handStr(next, 'bot')}.`,
  )
}

/**
 * Routes onward once the dice have been thrown, which is now AFTER the second bet.
 *
 * MULINELLO_SELECT is entered ONLY when a seat can act in it. A phase that showed up in every
 * hand would force every caller — bot, tests, UI — to click through a decision nobody has,
 * so a hand with no Mulinello follows exactly the path it always did.
 */
function afterRerollResolved(state: GameState, rng: Rng): GameState {
  const first = firstMulinelloSeat(state)
  if (first === null) {
    // No Mulinello — the Paguro's blind pick, if any, is the next decision after the reroll.
    return enterPaguroSelectOrShowdown(state, rng)
  }
  return withLog(
    { ...state, phase: 'MULINELLO_SELECT', toAct: first },
    `${labelOf(first)} ha un Mulinello: può ritirare quel dado una terza volta.`,
  )
}

/**
 * The next seat owed a Mulinello decision, primary first, or null if nobody is.
 *
 * Turn order matches every other phase (primary acts first). Both seats can hold one at once
 * — one among their own dice, one stolen from the commons — so this is a queue, not a flag.
 */
function firstMulinelloSeat(state: GameState): PlayerId | null {
  const order: readonly PlayerId[] = [state.primary, otherPlayer(state.primary)]
  return order.find((seat) => canUseMulinello(state, seat)) ?? null
}

/** Whether `seat` holds an unspent Mulinello. */
function canUseMulinello(state: GameState, seat: PlayerId): boolean {
  return seatHoldsActive(state, seat, 'MULINELLO') && !state.hands[seat].mulinelloUsed
}

/**
 * Spends or declines a Mulinello's extra roll.
 *
 * `roll` false is a real move, not a no-op: it marks the extra roll spent, which is what
 * passes the turn on and eventually leaves the phase. Rng-wise the two branches differ by one
 * die, and that is fine — the branch is chosen by a player ACTION, so the same action sequence
 * on the same seed still replays identically. What the project's fixed-draw rule forbids is an
 * INTERNAL branch nobody declared, like the Torpedo's electrified field (see applyTorpedoes).
 */
function handleMulinello(
  state: GameState,
  player: PlayerId,
  roll: boolean,
  rng: Rng,
): GameState {
  assert(state.phase === 'MULINELLO_SELECT', 'MULINELLO only allowed in MULINELLO_SELECT')
  assert(state.toAct === player, 'not this player to use a Mulinello')
  // seatHolds, not seatHoldsActive: this guard answers "is the action legal at all", and a
  // sponged seat is already filtered out by canUseMulinello, which decides who is ever `toAct`
  // in this phase. Nullifying here too could desync the two-holder queue.
  assert(seatHolds(state, player, 'MULINELLO'), 'only a Mulinello holder may act here')
  assert(!state.hands[player].mulinelloUsed, 'the Mulinello extra roll is once per hand')

  let next = setHand(state, player, { mulinelloUsed: true })
  if (roll) {
    next = rerollMulinelloDie(next, player, rng)
  } else {
    next = withLog(next, `${labelOf(player)} tiene il dado del Mulinello.`)
  }

  // Both seats can hold one, so hand off before leaving the phase.
  const remaining = firstMulinelloSeat(next)
  if (remaining !== null) {
    return { ...next, toAct: remaining }
  }
  // Mulinelli done — the Paguro's blind pick, if any, comes next.
  return enterPaguroSelectOrShowdown(next, rng)
}

// --- PAGURO_SELECT: the blind pick among a Dado Paguro's three covered faces ---

/**
 * Routes out of the reroll/Mulinello step into PAGURO_SELECT, or straight to the showdown.
 *
 * Entered ONLY when a seat can act in it, exactly like MULINELLO_SELECT: a hand with no Paguro
 * follows the path it always did, so no existing caller pays for a phase it has no decision in.
 */
function enterPaguroSelectOrShowdown(state: GameState, rng: Rng): GameState {
  const first = firstPaguroSeat(state)
  if (first === null) {
    return goToShowdown(state, rng)
  }
  return withLog(
    { ...state, phase: 'PAGURO_SELECT', toAct: first },
    `${labelOf(first)} ha un Dado Paguro: sceglie al buio uno dei tre dadi coperti.`,
  )
}

/**
 * The next seat owed a Paguro pick, primary first, or null if nobody is.
 *
 * A queue like firstMulinelloSeat rather than a flag: both seats can hold a Paguro at once (one
 * each among their own dice), so the phase hands off from one to the other before it ends.
 */
function firstPaguroSeat(state: GameState): PlayerId | null {
  const order: readonly PlayerId[] = [state.primary, otherPlayer(state.primary)]
  return order.find((seat) => canChoosePaguro(state, seat)) ?? null
}

/**
 * The three faces a Dado Paguro offers to pick from, folding in any fog.
 *
 * Clear: exactly the three rolled faces. FOGGED: an opponent's Brumeggio makes the Paguro roll
 * its ability twice, so rollDieWithAbility leaves six faces as [firstThree, secondThree] (see
 * its fog path), and each shell is the LOWER of its pair — the same "roll twice, keep the worse"
 * the fog applies to every other ability, here one shell at a time. Either way the player still
 * picks ONE of THREE covered shells, which is what keeps the UI and the bot (both index 0..2)
 * uniform whether or not the fog is on.
 *
 * Knows the fog's 3+3 layout, like the Stella fog test does; that coupling is the price of
 * composing a blind player choice with a roll-time modifier, and it lives here with the rest of
 * the Paguro's effect rather than leaking into abilities.ts.
 */
function paguroShells(rolls: readonly DieValue[]): readonly DieValue[] {
  if (rolls.length === 6) {
    return [
      Math.min(rolls[0]!, rolls[3]!) as DieValue,
      Math.min(rolls[1]!, rolls[4]!) as DieValue,
      Math.min(rolls[2]!, rolls[5]!) as DieValue,
    ]
  }
  return rolls
}

/** Whether `seat` still owes a Dado Paguro's blind pick this hand. */
function canChoosePaguro(state: GameState, seat: PlayerId): boolean {
  const own = state.hands[seat].own
  if (own === null || state.hands[seat].paguroChosen) {
    return false
  }
  // ownOnly, so the Paguro can only sit among the four own dice — no stolen die to consider.
  return own.some((die) => die.ability === 'DADO_PAGURO')
}

/**
 * Resolves a Dado Paguro's blind pick: writes the chosen one of its three rolled faces into the
 * die and reveals it.
 *
 * `index` is 0..2 into the die's `rolls`. Consumes no Rng — the three faces were already thrown
 * with the rest of the own dice; this only selects which survives. The pick is blind by
 * construction (the client never saw the faces, see viewFor), so the index is a client choice
 * that the reducer merely records; `rng` is threaded only to reach enterSecondBet's deal path.
 */
function handlePaguroChoose(
  state: GameState,
  player: PlayerId,
  index: number,
  rng: Rng,
): GameState {
  assert(state.phase === 'PAGURO_SELECT', 'PAGURO_CHOOSE only allowed in PAGURO_SELECT')
  assert(state.toAct === player, 'not this player to choose a Dado Paguro face')
  assert(canChoosePaguro(state, player), 'this seat has no pending Dado Paguro')

  const hand = state.hands[player]
  assert(hand.own !== null, 'Paguro chosen before the dice were rolled')
  const pIdx = hand.own.findIndex((die) => die.ability === 'DADO_PAGURO')
  assert(pIdx !== -1, 'Paguro holder has no Paguro die')

  const die = hand.own[pIdx]!
  // 3 faces when clear, 6 when fogged (rolled twice). paguroShells folds the fog back to three.
  assert(
    die.rolls !== undefined && (die.rolls.length === 3 || die.rolls.length === 6),
    'a Dado Paguro must have its rolled faces to choose from',
  )
  assert(
    Number.isInteger(index) && index >= 0 && index < 3,
    'Paguro choice must be a covered-shell index 0..2',
  )

  const shells = paguroShells(die.rolls)
  const kept = shells[index]!
  const own = [...hand.own]
  // Reveal the die as its three shells with the kept one — so a fogged Paguro shows the three
  // faces it was actually choosing between, not the six raw rolls behind them.
  own[pIdx] = { ...die, value: kept, rolls: shells }
  let next = setHand(state, player, {
    own: [own[0]!, own[1]!, own[2]!, own[3]!],
    paguroChosen: true,
  })
  // The kept value is announced now — AFTER the pick — so the log never spoils the blind
  // choice. The index is 1-based for the player, matching the reroll-target log style.
  next = withLog(
    next,
    `Dado Paguro di ${labelOf(player)}: pesca il dado ${index + 1} e tiene ${kept}.`,
  )

  // Both seats can owe a pick, so hand off before leaving the phase.
  const remaining = firstPaguroSeat(next)
  if (remaining !== null) {
    return { ...next, toAct: remaining }
  }
  return goToShowdown(next, rng)
}

/**
 * Rolls this seat's Mulinello die once more, wherever it sits.
 *
 * The stolen die is fixed everywhere else in the engine (applyReroll and withZappedOwn both
 * touch own dice only), but `seatHolds` counts a stolen Mulinello as held — so acquiring one
 * from the commons has to work, and the extra roll has to land on that die rather than on an
 * arbitrary own one. Own dice are checked first; a seat holding two Mulinelli spends the own
 * one first, which is arbitrary but has to be *some* fixed order to stay reproducible.
 */
function rerollMulinelloDie(state: GameState, player: PlayerId, rng: Rng): GameState {
  const hand = state.hands[player]
  assert(hand.own !== null, 'Mulinello used before the dice were rolled')

  // Fogged if an opponent's Brumeggio is still active — so a seat that sponged it back in
  // REROLL_SELECT gets a CLEAR third roll here. That is the most visible payoff of the
  // sponge-as-reversal semantics, and the one players will notice.
  const mods = modsFor(state, player)

  const ownIndex = hand.own.findIndex((die) => die.ability === 'MULINELLO')
  if (ownIndex !== -1) {
    const before = hand.own[ownIndex]!
    const after = rerollDie(rng, before, mods)
    const own = [...hand.own]
    own[ownIndex] = after
    const next = setHand(state, player, {
      own: [own[0]!, own[1]!, own[2]!, own[3]!],
    })
    return withLog(
      next,
      `Mulinello di ${labelOf(player)}: il dado ${ownIndex + 1} passa da ${before.value} a ${after.value}.`,
    )
  }

  assert(hand.stolen?.ability === 'MULINELLO', 'Mulinello holder has no Mulinello die')
  const before = hand.stolen
  const after = rerollDie(rng, before, mods)
  return withLog(
    setHand(state, player, { stolen: after }),
    `Mulinello di ${labelOf(player)}: il dado rubato passa da ${before.value} a ${after.value}.`,
  )
}

// --- DADO_LANTERNA: one look at the opponent's deck ---

/**
 * Spends a Dado Lanterna's peek: the holder gets to look at the opponent's 12-die deck.
 *
 * Records only that the look was TAKEN, never what was in it. The deck is already on the state
 * and immutable for the match, so the UI reads `decks[opponent]` at the moment it renders — a
 * stored snapshot would duplicate state AND make a glance permanent, which is the one thing
 * this ability must not be.
 *
 * For the same reason THE LOG LINE DOES NOT NAME THE DICE. Writing them there would preserve
 * the peek forever in the action log, quietly undoing the whole point.
 *
 * Consumes no Rng: nothing here is rolled or chosen.
 *
 * NOT gated on `toAct` — see LanternPeekAction for why, and there is a test pinning it.
 */
function handleLanternPeek(state: GameState, player: PlayerId): GameState {
  assert(inPeekablePhase(state), 'LANTERNA_PEEK only allowed once the dice are on the table')
  assert(seatHolds(state, player, 'DADO_LANTERNA'), 'only a Dado Lanterna holder may peek')
  assert(!state.hands[player].lanternaUsed, 'the Lanterna peek is once per hand')
  // Rejected rather than silently spent: asking to look at a deck that does not exist (a
  // drops- or pinned-mode opponent) is a caller bug, and this file fails loudly on those.
  assert(
    state.decks[otherPlayer(player)] !== null,
    'the opponent has no deck to peek at',
  )

  return withLog(
    setHand(state, player, { lanternaUsed: true }),
    `${labelOf(player)} accende la Lanterna e sbircia il mazzo di ${labelOf(otherPlayer(player))}.`,
  )
}

/**
 * Opens the second betting round, straight after the steal.
 *
 * Takes no Rng, and that absence is the shape of the fix: this used to be reached from the end of
 * REROLL_SELECT with dice already thrown, and its all-in shortcut had to be able to roll. Nothing
 * random happens between the deal and this round any more — the reroll is entirely downstream.
 */
function enterSecondBet(state: GameState): GameState {
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

  // Someone is already all-in from the first round: there is nothing left to wager, so skip
  // asking for a bet nobody can make and go straight on to the reroll. NOT to the showdown —
  // the players still get their reroll, they simply get it for no further money.
  if (noChipsBehind(reset)) {
    return enterRerollSelect(
      withLog(reset, 'Nessuno ha altre monete da puntare: si passa direttamente al rilancio.'),
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
function applyReroll(
  own: OwnDice,
  selection: readonly number[],
  rng: Rng,
  mods: RollModifiers = NO_MODIFIERS,
): OwnDice {
  const set = new Set(selection)
  const after = own.map((die, i) => (set.has(i) ? rerollDie(rng, die, mods) : die))
  return [after[0]!, after[1]!, after[2]!, after[3]!]
}

/**
 * Assembles a seat's 5-die hand. No rolling: `own` is already final by the time the showdown
 * runs, since the reroll resolves back in REROLL_SELECT and any Mulinello in MULINELLO_SELECT.
 * Rolling here too would silently reroll every hand a second time.
 */
function finalHandOf(hand: PlayerHandState): Hand {
  assert(hand.own !== null && hand.stolen !== null, 'incomplete hand at showdown')
  const own = hand.own
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
    // seatHolds, not seatHoldsActive, and the check must stay ABOVE the draws: a seat with no
    // Torpedo consumes nothing, which is the stream shape every seed was recorded against.
    if (!seatHolds(state, seat, 'DADO_TORPEDO')) {
      continue
    }
    const victim = otherPlayer(seat)
    const target = state.hands[seat].torpedoTarget
    // Always drawn, in this order, so the stream does not depend on either outcome.
    const electrifies = rng.next() < TORPEDO_FIELD_CHANCE
    const selfIndex = rng.nextInt(0, 3)

    // A sponged Torpedo is drawn for and then discarded. Skipping the two draws above instead
    // would shift every later roll in the hand, which is exactly what the fixed-draw rule in
    // this function's doc comment exists to prevent — the die is present, so it costs its
    // entropy whether or not the damage lands.
    // The VICTIM is the one who may have sponged it — they are the seat being spared.
    if (hasSponged(state, victim, 'DADO_TORPEDO')) {
      logs.push(
        `Dado Spugna di ${labelOf(victim)}: il Dado Torpedo di ${labelOf(seat)} è assorbito.`,
      )
      continue
    }

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

  // An unclaimed common Torpedo has no owner, so nobody chose: a random die each. A Spugna
  // makes this asymmetric — one seat may have soaked it up while the other still eats it —
  // so the nullify check is INSIDE the loop and, again, AFTER that seat's draw.
  if (unclaimedCommonIndex(state, 'DADO_TORPEDO') !== null) {
    for (const seat of ['human', 'bot'] as const) {
      const index = rng.nextInt(0, 3)
      // No owner to blame, so the seat about to be hit is also the seat that may have sponged.
      if (hasSponged(state, seat, 'DADO_TORPEDO')) {
        logs.push(
          `Dado Spugna di ${labelOf(seat)}: il Dado Torpedo tra i comuni non lo colpisce.`,
        )
        continue
      }
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
    human: finalHandOf(state.hands.human),
    bot: finalHandOf(state.hands.bot),
  }

  // Zap here, at the showdown, and not back when the dice were rerolled: applying a Torpedo
  // before the rolls settle would let the victim reroll the marked die — or spend a Mulinello
  // on it — and wipe the -1 for free, since a roll rebuilds a die from its ability alone.
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
  // The reroll itself was already logged when it happened, back in REROLL_SELECT — but that
  // line masks dice a seat could not see. This one is the reveal: printed in full, after any
  // Torpedo, so a concealed die's true face and every zap are finally on the record.
  next = withLog(next, `Allo showdown — Tu: ${diceStr(humanOwn)}. Bot: ${diceStr(botOwn)}.`)
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
  // Sponge-aware, and the seat doing the sponging is the LOSER — the only one who gains from
  // cancelling a payout. seatHoldsActive takes the ability's owner (the winner) and looks up
  // the other seat itself; the table branch takes the protected seat, so it needs the loser
  // named explicitly. Two different parameter meanings, which is why they read differently.
  const loser = otherPlayer(winner)
  if (seatHoldsActive(state, winner, 'DADO_D_ORO')) {
    return 'held'
  }
  return unclaimedCommonActiveFor(state, loser, 'DADO_D_ORO') !== null ? 'table' : null
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
