// Opponent AI as pure logic. chooseAction(state, player, rng) returns a single legal
// Action for the current phase. It reuses the shared strategy helpers (steal + reroll)
// so the bot plays the same policy the Monte Carlo simulator measures.
//
// All betting thresholds are NAMED CONSTANTS grouped in BOT_TUNING, so they are easy to
// find and re-balance during playtest. The bot is deterministic given the Rng.

import {
  chooseStolenDie,
  chooseRerollIndices,
  chooseTorpedoTarget,
  handScore,
} from './strategy'
import { exactRerollEV } from './optimal'
import type { Rng } from './rng'
import type { AbilityId, Hand } from './types'
import type { Action } from './actions'
import { maxBetFor } from './game'
import { viewFor } from './view'
import { otherPlayer, type GameState, type PlayerId } from './gameTypes'

/**
 * Tunable bot parameters. These are intentionally simple and named so they can be
 * dialed in during playtest without touching the decision logic below.
 */
export const BOT_TUNING = {
  /**
   * Second-bet strength gate: at/above this normalized hand strength ([0,1]) the bot
   * raises; below it, the bot just calls. There is no fold — the bot always sees the bet.
   */
  raiseAtLeast: 0.62,
  /**
   * Initial bet is blind (before dice are rolled), so the bot plays it flat: it opens /
   * calls at the minimum and never raises pre-roll. Kept as a flag for clarity.
   */
  raiseOnInitialBet: false,
  /**
   * Second-bet fold gate: at/below this normalized strength the bot will consider folding
   * rather than paying. Only applies in SECOND_BET while facing a bet, the only spot where
   * folding is legal.
   */
  foldBelow: 0.3,
  /**
   * ...and only when the call costs at least this fraction of its remaining stack. Without
   * a price gate the bot would fold weak hands to trivial bets, which plays as needlessly
   * timid and hands the human free pots.
   *
   * Calibrated against actual play: at the default 200 stack / 10 minimum bet, the price
   * of a second-round call is ~5% of stack typically and 12.5% at the observed maximum, so
   * anything above that makes the rule dead code. 10% means the bot folds weak hands only
   * to bets that are genuinely large for it — which is what a human raising big wants.
   */
  foldWhenPriceOverStack: 0.1,
} as const

/**
 * Normalizes a hand's handScore into [0, 1] so thresholds are readable.
 * The min is the weakest possible 5-die score, the max the strongest (five sixes-ish);
 * we derive both from handScore of anchor hands to stay consistent with the scoring.
 */
const MIN_SCORE = handScore([{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 6 }])
// Strongest realistic hand: six-high straight is the top category in this game.
const MAX_SCORE = handScore([{ value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }, { value: 6 }])

/**
 * True when the opponent has already committed everything they have.
 *
 * Raising into an all-in opponent is pointless — there is nobody left to call the extra —
 * so the bot only ever matches. Without this it would keep "raising" against a player who
 * cannot respond, which reads as the bot bullying a broke opponent.
 */
function opponentIsAllIn(state: GameState, player: PlayerId): boolean {
  return state.bankroll[otherPlayer(player)] <= 0
}

/**
 * Turns a desired total bet into a legal action.
 *
 * Two clamps, both delegating the ceiling to the engine's maxBetFor (which caps at the
 * SHORTER stack, so the bot cannot bet chips the opponent could never cover):
 *  - cannot afford the raise -> call instead. This bot has no all-in strategy, and
 *    shoving its whole stack on a minimum-raise impulse is worse than matching.
 *  - opponent already all-in -> call, since a raise cannot be contested.
 */
function betOrCall(
  state: GameState,
  player: PlayerId,
  type: 'OPEN' | 'RAISE',
  amount: number,
): Action {
  const max = maxBetFor(state, player)

  if (type === 'RAISE' && opponentIsAllIn(state, player)) {
    return { type: 'CALL', player }
  }
  if (amount > max) {
    return type === 'OPEN' ? { type: 'OPEN', player, amount: max } : { type: 'CALL', player }
  }
  return type === 'OPEN' ? { type: 'OPEN', player, amount } : { type: 'RAISE', player, amount }
}

function normalizedStrength(hand: Hand): number {
  return normalizeScore(handScore(hand))
}

/**
 * Maps a raw handScore (or an expected one) into [0, 1] against the same anchors.
 *
 * Split out from normalizedStrength so an EXPECTED score — which is an average and therefore
 * not any real hand's score — can be normalized on the identical scale. Sharing the scale is
 * what lets BOT_TUNING's thresholds keep their meaning whether the bot is pricing settled dice
 * or dice it is about to throw.
 */
function normalizeScore(raw: number): number {
  const clamped = Math.max(MIN_SCORE, Math.min(MAX_SCORE, raw))
  return (clamped - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)
}

/** The bot's current 5-die hand (own 4 + stolen), if both are known. */
function currentHand(state: GameState, player: PlayerId): Hand | null {
  const h = state.hands[player]
  if (h.own === null || h.stolen === null) {
    return null
  }
  return [h.own[0], h.own[1], h.own[2], h.own[3], h.stolen]
}

/**
 * Chooses a single legal action for `player` given the current phase.
 * Throws if asked to act when it is not the player's turn (defensive; the caller should
 * only invoke this when state.toAct === player).
 */
export function chooseAction(state: GameState, player: PlayerId, rng: Rng): Action {
  // ROLL_OFF and HAND_COMPLETE are system transitions with no per-player turn.
  if (state.phase === 'ROLL_OFF') {
    return { type: 'ROLL_OFF' }
  }
  if (state.phase === 'HAND_COMPLETE') {
    return { type: 'NEXT_HAND' }
  }

  if (state.toAct !== player) {
    throw new Error('[bot] asked to act out of turn')
  }

  // EVERY decision below reads the FILTERED view, never the raw state. A die concealed
  // from the bot by the human's Nero di Seppia must be unknown to the bot too, otherwise
  // the ability would only work in one direction and the bot would be quietly cheating.
  // Filtering once here covers all four decision paths.
  const seen = viewFor(state, player)

  // Switch on the already-narrowed `state.phase` (ROLL_OFF/HAND_COMPLETE returned above),
  // but pass `seen` to every handler.
  //
  // Note what is NOT here: the bot never sends LANTERNA_PEEK. Nothing below reads
  // `state.decks`, so knowing the human's deck would feed no decision — and a peek dispatched
  // for appearances would be worse than its absence, implying the bot had weighed it. The
  // machine never waits for one either: a peek changes neither `phase` nor `toAct`, so no
  // phase can stall on an action the bot declines to send. A Lanterna in the bot's deck is
  // therefore dead weight for the bot, which is a real and accepted asymmetry.
  switch (state.phase) {
    case 'INITIAL_BET':
      return chooseInitialBet(seen, player)
    case 'STEAL':
      return chooseSteal(seen, player)
    case 'REROLL_SELECT':
      return chooseReroll(seen, player, rng)
    case 'MULINELLO_SELECT':
      return chooseMulinello(seen, player)
    case 'PAGURO_SELECT':
      return choosePaguro(seen, player, rng)
    case 'SECOND_BET':
      return chooseSecondBet(seen, player)
    case 'SHOWDOWN':
    case 'MATCH_OVER':
      throw new Error(`[bot] no action to take in phase ${state.phase}`)
  }
}

// --- INITIAL_BET (blind) ---

function chooseInitialBet(state: GameState, player: PlayerId): Action {
  // Primary opens at the minimum; non-primary calls. Blind, so keep it flat.
  if (player === state.primary && state.aggressor === null) {
    return betOrCall(state, player, 'OPEN', state.config.minBet)
  }
  if (BOT_TUNING.raiseOnInitialBet && state.raisesThisWindow < state.config.maxRaisesPerWindow) {
    return betOrCall(state, player, 'RAISE', state.currentBet + state.config.minBet)
  }
  return { type: 'CALL', player }
}

// --- STEAL: greedy best common die ---

function chooseSteal(state: GameState, player: PlayerId): Action {
  const own = state.hands[player].own
  if (own === null || state.common === null) {
    throw new Error('[bot] steal requested before dice rolled')
  }
  // Only consider commons not already taken, keeping track of their original indices.
  const availableIndices = [0, 1, 2].filter((i) => !state.stolenCommonIndices.includes(i))
  const availableDice = availableIndices.map((i) => state.common![i]!)

  // Greedy pick via the shared helper; map its local index back to the original index.
  const { index: localIndex } = chooseStolenDie(own, availableDice)
  return { type: 'STEAL', player, commonIndex: availableIndices[localIndex]! }
}

// --- REROLL_SELECT: reuse shared heuristic ---

function chooseReroll(state: GameState, player: PlayerId, rng: Rng): Action {
  const h = state.hands[player]
  if (h.own === null || h.stolen === null) {
    throw new Error('[bot] reroll requested before steal')
  }
  const indices = chooseRerollIndices(h.own, h.stolen, rng)

  // Holding a Torpedo makes the target mandatory (the reducer asserts it), so it is chosen
  // here in the same action. `state` is already the filtered view, so a die the bot cannot
  // see cannot inform the choice.
  //
  // Note the bot picks its victim well, but chooseRerollIndices above does NOT know the bot's
  // own hand may be zapped by an opponent Torpedo — the same blind spot it has for the Nero
  // di Seppia and the Dado d'Oro. Teaching the reroll heuristic about pending effects is a
  // separate change.
  //
  // It is also blind to FOG: in a Dado Brumeggio's fog a fresh die averages 2.53 rather than
  // 3.50, so the bot rerolls more than it should (it should keep more). Bounded and
  // one-directional — the heuristic is an argmax over keep-sets, and the fog scales every
  // candidate by the same factor, so it misjudges keep-vs-reroll rather than which dice to
  // pick. Joins the same documented list as the Stella and the D4, which exactRerollEV has
  // always mispriced for the same reason.
  const victim = otherPlayer(player)
  const victimHand = state.hands[victim]
  const sponge = chooseSponge(state, player)
  const base = { type: 'REROLL' as const, player, ownIndices: indices }
  const withSponge = sponge === null ? base : { ...base, spongeTarget: sponge }

  if (holdsAbility(h, 'DADO_TORPEDO') && victimHand.own !== null && victimHand.stolen !== null) {
    const target = chooseTorpedoTarget(victimHand.own, victimHand.stolen)
    return { ...withSponge, torpedoTarget: target }
  }
  return withSponge
}

/**
 * Which opponent ability to soak up with a Dado Spugna, or null when there is nothing to take.
 *
 * A RANKING, not an EV calculation, and deliberately so. `exactRerollEV` prices dice faces; it
 * cannot price information, coins, or damage that has not landed, and there is no opponent model
 * in this codebase to price them against. A fabricated EV number here would look rigorous and be
 * arbitrary, so the order below is stated as the judgement call it is:
 *
 *  1. DADO_BRUMEGGIO — first on the Torpedo's own criteria, which it wins on every count:
 *     strictly negative, aimed at us, certain, quantifiable — and far larger. A Torpedo is -1
 *     on one die, once. The fog is about -0.97 expected value on EVERY die we roll (E 3.500
 *     -> 2.528), and it applies again to every die we reroll. Lifting it also un-fogs the
 *     reroll we are about to choose, which no other sponge target does.
 *  2. TORPEDO — a strictly-negative effect aimed at us whose cost we can quantify (a -1 on the
 *     die chooseTorpedoTarget says we can least afford).
 *  3. DADO_D_ORO — doubles what they collect. Cancelling it is worth a whole pot, but only in
 *     the branch where they win, so it ranks below a certain loss.
 *  4. MULINELLO — priced with the same quantity chooseMulinello uses on our own behalf, so the
 *     bot never disagrees with itself about what an extra roll is worth.
 *  5. NERO_DI_SEPPIA — last because by now it has already cost us the reroll decision; the
 *     sponge only buys back sight for the betting.
 *
 * Reads the FILTERED view like every other bot decision, so a die the bot cannot see cannot
 * inform the choice.
 */
function chooseSponge(state: GameState, player: PlayerId): AbilityId | null {
  const hand = state.hands[player]
  if (!holdsAbility(hand, 'DADO_SPUGNA')) {
    return null
  }
  const opponent = otherPlayer(player)
  const oppHand = state.hands[opponent]

  // An ability threatens us if the opponent holds it, or if it sits unstolen among the commons
  // (where several abilities still hit both seats).
  const threatens = (ability: AbilityId): boolean =>
    holdsAbility(oppHand, ability) ||
    (state.common ?? []).some(
      (d, i) => d.ability === ability && !state.stolenCommonIndices.includes(i),
    )

  for (const ability of SPONGE_PRIORITY) {
    if (threatens(ability)) {
      return ability
    }
  }
  return null
}

/**
 * See chooseSponge for why this order, and why it is a ranking rather than a computation.
 *
 * A plain array, NOT a Record over AbilityId, so a new spongeable ability compiles fine while
 * being silently un-sponged forever. Exported so a test can assert the list is complete —
 * which is the only thing that turns that omission into a failure.
 */
export const SPONGE_PRIORITY: readonly AbilityId[] = [
  'DADO_BRUMEGGIO',
  'DADO_TORPEDO',
  'DADO_D_ORO',
  'MULINELLO',
  'NERO_DI_SEPPIA',
]

/** Whether this hand carries `ability`, among its own dice or as its stolen die. */
function holdsAbility(hand: GameState['hands'][PlayerId], ability: AbilityId): boolean {
  return (
    (hand.own ?? []).some((d) => d.ability === ability) || hand.stolen?.ability === ability
  )
}


// --- MULINELLO_SELECT: spend the extra roll only when it pays ---

/**
 * Takes the Mulinello's third roll when its exact EV beats keeping the hand as it stands.
 *
 * No new EV code: `exactRerollEV` (optimal.ts) prices "reroll exactly this die" by enumerating
 * all 6 faces, and `handScore` prices standing pat. Both are the same metric the solver and
 * the reroll heuristic already use, so the bot cannot drift away from them.
 *
 * Three known limits, all inherited rather than introduced. `state` is the filtered view, so a
 * Mulinello concealed by the human's Nero di Seppia is priced from its masked face — the same
 * blind spot chooseReroll has. The EV ignores a pending Torpedo, exactly as noted above. And a
 * third roll taken in a Brumeggio's fog is priced as a clean d6 when it will actually average
 * 2.53, so the bot takes the roll in some spots where keeping was better.
 */
function chooseMulinello(state: GameState, player: PlayerId): Action {
  const h = state.hands[player]
  if (h.own === null || h.stolen === null) {
    throw new Error('[bot] Mulinello requested before the dice were rolled')
  }

  const index = h.own.findIndex((d) => d.ability === 'MULINELLO')
  // A stolen Mulinello sits outside `own`, which is what exactRerollEV indexes into. Rather
  // than price it with the wrong arithmetic, keep: the die is already the one the bot chose
  // to steal, so standing pat is a defensible default rather than a silent mistake.
  if (index === -1) {
    return { type: 'MULINELLO_PASS', player }
  }

  const keep = handScore([h.own[0], h.own[1], h.own[2], h.own[3], h.stolen])
  const reroll = exactRerollEV(h.own, h.stolen, [index])
  return reroll > keep
    ? { type: 'MULINELLO_ROLL', player }
    : { type: 'MULINELLO_PASS', player }
}

// --- PAGURO_SELECT: a blind pick among three covered faces ---

/**
 * Picks one of the Dado Paguro's three covered faces. BLIND by construction: the bot reads the
 * filtered view, where its own pending Paguro is masked, so it cannot see the faces even if it
 * wanted to — and it wouldn't matter, since a blind pick is a uniform draw whatever the index.
 *
 * There is therefore no strategy to have and none is faked. The index is drawn from the Rng so
 * two Paguri in one hand do not both grab the same slot for no reason, but any fixed index would
 * be exactly as strong. Consumes one draw, in a player-action path — the same reproducibility
 * rule the Mulinello's branch follows.
 */
function choosePaguro(_state: GameState, player: PlayerId, rng: Rng): Action {
  return { type: 'PAGURO_CHOOSE', player, index: rng.nextInt(0, 2) }
}

// --- SECOND_BET: threshold on the strength this hand is EXPECTED to end up with ---

/**
 * Normalized strength to bet on at the second bet, accounting for the reroll still pending.
 *
 * The dice on the table are not this hand's final dice: the reroll selection was made in
 * REROLL_SELECT but is thrown only once this betting round closes. Pricing the visible dice
 * would misread every hand that chose to reroll — worst of all the good ones, since a seat
 * that kept everything and a seat that is about to replace three dice would score identically.
 *
 * `exactRerollEV` enumerates all 6^k outcomes of the pending dice, which is the same exact
 * arithmetic the solver and chooseMulinello already use, so the bot cannot drift away from them.
 * Its documented blind spots are inherited unchanged: it assumes a uniform 1..6 face, so a
 * pending Stella, D4 or Paguro — or any die rolled in a Brumeggio's fog — is mispriced.
 */
function pendingStrength(state: GameState, player: PlayerId, hand: Hand): number {
  const h = state.hands[player]
  const pending = h.rerollSelection ?? []
  if (h.own === null || h.stolen === null || pending.length === 0) {
    return normalizedStrength(hand)
  }
  return normalizeScore(exactRerollEV(h.own, h.stolen, pending))
}

function chooseSecondBet(state: GameState, player: PlayerId): Action {
  const hand = currentHand(state, player)
  if (hand === null) {
    throw new Error('[bot] second bet requested before hand is formed')
  }
  const strength = pendingStrength(state, player, hand)
  const canRaise = state.raisesThisWindow < state.config.maxRaisesPerWindow
  const wantsRaise = strength >= BOT_TUNING.raiseAtLeast && canRaise

  // No bet on the table yet: the bot (as primary) MUST open (no check). It opens at the
  // minimum, or higher when its hand is strong.
  if (state.aggressor === null) {
    const min = state.firstBetAmount // second-bet minimum
    const amount = wantsRaise ? min + state.config.minBet : min
    return betOrCall(state, player, 'OPEN', amount)
  }

  // Facing a bet: raise when strong.
  if (wantsRaise) {
    return betOrCall(state, player, 'RAISE', state.currentBet + state.config.minBet)
  }

  // Weak hand facing a bet it has to pay for: fold rather than pay off a big bet.
  // Gated on the price being meaningful relative to the stack, so the bot does not fold
  // to a token bet it could call for almost nothing.
  const owed = state.currentBet - state.hands[player].committed
  const stack = state.bankroll[player]
  const priceRatio = stack > 0 ? owed / stack : 0
  if (
    owed > 0 &&
    strength <= BOT_TUNING.foldBelow &&
    priceRatio >= BOT_TUNING.foldWhenPriceOverStack
  ) {
    return { type: 'FOLD', player }
  }

  return { type: 'CALL', player }
}
