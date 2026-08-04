// Match state machine: a reducer over GameState, driven by Action.
//
// This file is the PHASE GRAPH — the reducer, the per-phase handlers, and the transitions
// between them. They live together because every handler tail-calls into the transition graph
// and the transition graph calls back into the handlers; splitting them would only relocate a
// cycle. Everything a handler needs but does not decide lives elsewhere:
//
//   gameSetup.ts       building a match, the per-hand loadout draw, the reset between hands
//   betting.ts         the effective stack and what it forbids
//   abilityQueries.ts  who holds what, what is unclaimed, what a Spugna cancelled
//   abilityEffects.ts  what abilities do to the dice
//   showdown.ts        comparing the hands and paying the pot out
//   logFormat.ts       how dice and showdowns are worded
//   stateOps.ts        log / commit / setHand / assert
//
// Design: pure and deterministic. All randomness comes from an injected Rng, threaded
// through the reducer's third argument. The reducer NEVER mutates its input; it returns
// a fresh GameState. Invalid actions for the current phase throw (the UI/bot only ever
// send legal actions; tests assert the guards).

import { abilitySpec, isSpongeable } from './abilities'
import {
  applyConcealment,
  applyRerollSelections,
  paguroShells,
  releaseCommonConcealment,
  rerollMulinelloDie,
  restoreSightIfSponged,
} from './abilityEffects'
import {
  isFogged,
  modsFor,
  seatHolds,
  seatHoldsActive,
  unclaimedCommonIndex,
} from './abilityQueries'
import { assertAffordable, maxBetFor, noChipsBehind } from './betting'
import { drawLoadouts, handleNextHand } from './gameSetup'
import { otherPlayer, type GameState, type PlayerId } from './gameTypes'
import { diceStr, dieStr, handStr } from './logFormat'
import type { Rng } from './rng'
import { goToShowdown, resolveHand } from './showdown'
import { assert, commit as commitChips, labelOf, setHand, withLog } from './stateOps'
import { MAX_REROLL, rollCommonDice, rollOwnDice } from './strategy'
import type { Action } from './actions'
import type { AbilityId } from './types'

// The engine's public surface. Re-exported here so `index.ts` and bot.ts keep importing from
// './game', and so the many helpers the modules above had to export stay out of the barrel.
export { createInitialState, type NewGameOptions } from './gameSetup'
export { maxBetFor } from './betting'
export { seatIsFogged } from './abilityQueries'

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

// ---------------------------------------------------------------------------
// The phase graph, in the order a hand walks it
//
//   ROLL_OFF --------> INITIAL_BET --settleWindow--> startHandAfterInitialBet
//                 \-- (noChipsBehind) -------------^
//   startHandAfterInitialBet --> STEAL --(non-primary stole)--> enterSecondBet
//   enterSecondBet --> SECOND_BET --settleWindow--> enterRerollSelect
//              \-- (noChipsBehind) ----------------^
//   enterRerollSelect --> REROLL_SELECT --(both chose)--> afterRerollResolved
//   afterRerollResolved --> MULINELLO_SELECT --> enterPaguroSelectOrShowdown
//                      \------------------------^
//   enterPaguroSelectOrShowdown --> PAGURO_SELECT --> goToShowdown
//                              \-----------------------^
//   goToShowdown --> resolveHand --> HAND_COMPLETE --NEXT_HAND--> ROLL_OFF
//                                \-> MATCH_OVER
// ---------------------------------------------------------------------------

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

/** Initial bet settled: draw the loadouts, roll every die, and open the steal. */
function startHandAfterInitialBet(state: GameState, rng: Rng): GameState {
  // Which special dice each seat gets is drawn fresh every hand (unless the seat is
  // pinned), so a lucky loadout is a property of the hand, not of the whole match.
  const loadouts = drawLoadouts(state, rng)

  // Own dice are rolled first (human then bot), then the common dice.
  //
  // A Dado Brumeggio fogs from the very FIRST roll, so the modifiers are derived before any
  // die is thrown — an opponent's fog is already in force on the roll that reveals it. Note
  // `loadouts` is passed explicitly: see isFogged in abilityQueries.ts for why state.loadouts
  // is the wrong source at this exact instant.
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
      // "Tu" for the human, and "i dadi di Tu" is not Italian.
      const victim = seat === 'human' ? 'i tuoi dadi escono' : 'i dadi del Bot escono'
      next = withLog(
        next,
        `${labelOf(otherPlayer(seat))} lancia il Brumeggio: ${victim} due volte e tengono il più basso.`,
      )
    }
  }

  // Only the HUMAN's own concealed die is masked: the log is written for the human, so
  // printing their hidden face would undo the concealment instantly. The bot's dice stay
  // fully printed even when the bot itself cannot see one of them — that asymmetry IS the
  // advantage a Nero di Seppia buys, and hiding it here would rob the caster of it.
  next = withLog(next, `Lancio — Tu: ${handStr(next, 'human')}. Bot: ${diceStr(botOwn)}.`)
  next = withLog(
    next,
    `Dadi comuni: ${diceStr(common)}. Ruba per primo ${labelOf(state.primary)}.`,
  )
  return next
}

/**
 * Opens the second betting round, straight after the steal.
 *
 * Takes no Rng, and that absence is the shape of the design: nothing random happens between
 * the deal and this round — the reroll is entirely downstream.
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

function enterRerollSelect(state: GameState): GameState {
  // Primary selects reroll first, then non-primary (order mirrors steal for consistency).
  return withLog(
    { ...state, phase: 'REROLL_SELECT', toAct: state.primary },
    'Scelta dei dadi da rilanciare (fino a 4, il rubato resta fisso).',
  )
}

/**
 * Routes onward once the dice have been thrown, which is AFTER the second bet.
 *
 * MULINELLO_SELECT is entered ONLY when a seat can act in it. A phase that showed up in every
 * hand would force every caller — bot, tests, UI — to click through a decision nobody has,
 * so a hand with no Mulinello follows exactly the path it always did.
 */
function afterRerollResolved(state: GameState, rng: Rng): GameState {
  const first = firstSeatWhere(state, canUseMulinello)
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
 * Routes out of the reroll/Mulinello step into PAGURO_SELECT, or straight to the showdown.
 *
 * Entered ONLY when a seat can act in it, exactly like MULINELLO_SELECT: a hand with no Paguro
 * follows the path it always did, so no existing caller pays for a phase it has no decision in.
 */
function enterPaguroSelectOrShowdown(state: GameState, rng: Rng): GameState {
  const first = firstSeatWhere(state, canChoosePaguro)
  if (first === null) {
    return goToShowdown(state, rng)
  }
  return withLog(
    { ...state, phase: 'PAGURO_SELECT', toAct: first },
    `${labelOf(first)} ha un Dado Paguro: sceglie al buio uno dei tre dadi coperti.`,
  )
}

/**
 * The next seat owed a decision, primary first, or null if nobody is.
 *
 * Turn order matches every other phase. Both the Mulinello and the Paguro phases need this,
 * because both abilities can sit in both seats at once — one each — so each phase is a queue
 * that hands off from one seat to the other before it ends, not a flag.
 */
function firstSeatWhere(
  state: GameState,
  predicate: (state: GameState, seat: PlayerId) => boolean,
): PlayerId | null {
  const order: readonly PlayerId[] = [state.primary, otherPlayer(state.primary)]
  return order.find((seat) => predicate(state, seat)) ?? null
}

// ---------------------------------------------------------------------------
// ROLL_OFF: highest die decides the primary
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Betting: INITIAL_BET and SECOND_BET
// ---------------------------------------------------------------------------

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
  let next = commitChips(state, player, toPut)
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
    toMatch > 0 ? commitChips(state, player, toMatch) : state,
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
  let next = commitChips(state, player, toPut)
  next = {
    ...next,
    currentBet: amount,
    raisesThisWindow: next.raisesThisWindow + 1,
    aggressor: player, // the raiser is now the aggressor; opponent must respond
    toAct: otherPlayer(player),
  }
  return withLog(next, `${labelOf(player)} rilancia a ${amount}.`)
}

// ---------------------------------------------------------------------------
// STEAL
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// REROLL_SELECT
// ---------------------------------------------------------------------------

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
  // die — see RerollAction's comment in actions.ts for why the asymmetry is deliberate. What
  // IS rejected is a target that cannot be sponged: a client naming a Stella or another Spugna
  // has a bug, and a silent no-op would hide it.
  if (spongeTarget !== undefined) {
    assert(spongeTarget !== 'DADO_SPUGNA', 'a Dado Spugna cannot absorb another Dado Spugna')
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

  // Recorded whether or not this seat holds a Spugna: the target is only ever consulted for a
  // seat that does, so an ignored one costs nothing and keeps every client simple.
  const sponged = spongeTarget !== undefined && seatHolds(state, player, 'DADO_SPUGNA')
    ? spongeTarget
    : null
  let next = setHand(state, player, {
    rerollSelection: unique,
    torpedoTarget: torpedoTarget ?? null,
    spongeTarget: sponged,
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
  if (sponged !== null) {
    next = withLog(next, `${labelOf(player)} usa il Dado Spugna su ${abilitySpec(sponged)?.name}.`)
    next = restoreSightIfSponged(next, player, sponged)
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

// ---------------------------------------------------------------------------
// MULINELLO_SELECT
// ---------------------------------------------------------------------------

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
  const remaining = firstSeatWhere(next, canUseMulinello)
  if (remaining !== null) {
    return { ...next, toAct: remaining }
  }
  // Mulinelli done — the Paguro's blind pick, if any, comes next.
  return enterPaguroSelectOrShowdown(next, rng)
}

// ---------------------------------------------------------------------------
// PAGURO_SELECT: the blind pick among a Dado Paguro's three covered faces
// ---------------------------------------------------------------------------

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
 * that the reducer merely records; `rng` is threaded only to reach the showdown.
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
  const remaining = firstSeatWhere(next, canChoosePaguro)
  if (remaining !== null) {
    return { ...next, toAct: remaining }
  }
  return goToShowdown(next, rng)
}

// ---------------------------------------------------------------------------
// DADO_LANTERNA: one look at the opponent's deck
// ---------------------------------------------------------------------------

/**
 * Whether a Dado Lanterna could be used to peek right now — "from the deal to the showdown".
 *
 * Exported because the UI needs the same answer to decide whether to offer the button, and a
 * duplicated phase list there would drift. The reducer stays the authority.
 *
 * Excluded on purpose: ROLL_OFF and INITIAL_BET (the dice do not exist yet, so nobody can hold
 * a lantern), HAND_COMPLETE and MATCH_OVER (the hand is over and so is its lantern — allowing a
 * peek would let a player bank one they declined to spend), and SHOWDOWN, which no reducer
 * output ever carries.
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
  assert(state.decks[otherPlayer(player)] !== null, 'the opponent has no deck to peek at')

  return withLog(
    setHand(state, player, { lanternaUsed: true }),
    `${labelOf(player)} accende la Lanterna e sbircia il mazzo di ${labelOf(otherPlayer(player))}.`,
  )
}
