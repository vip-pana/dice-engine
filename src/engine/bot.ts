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
import type { Rng } from './rng'
import type { Hand } from './types'
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
  const raw = handScore(hand)
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
  switch (state.phase) {
    case 'INITIAL_BET':
      return chooseInitialBet(seen, player)
    case 'STEAL':
      return chooseSteal(seen, player)
    case 'REROLL_SELECT':
      return chooseReroll(seen, player, rng)
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
  const victim = otherPlayer(player)
  const victimHand = state.hands[victim]
  if (holdsTorpedo(h) && victimHand.own !== null && victimHand.stolen !== null) {
    const target = chooseTorpedoTarget(victimHand.own, victimHand.stolen)
    return { type: 'REROLL', player, ownIndices: indices, torpedoTarget: target }
  }
  return { type: 'REROLL', player, ownIndices: indices }
}

/** Whether this hand carries a Dado Torpedo, among its own dice or as its stolen die. */
function holdsTorpedo(hand: GameState['hands'][PlayerId]): boolean {
  return (
    (hand.own ?? []).some((d) => d.ability === 'DADO_TORPEDO') ||
    hand.stolen?.ability === 'DADO_TORPEDO'
  )
}

// --- SECOND_BET: threshold on current hand strength ---

function chooseSecondBet(state: GameState, player: PlayerId): Action {
  const hand = currentHand(state, player)
  if (hand === null) {
    throw new Error('[bot] second bet requested before hand is formed')
  }
  const strength = normalizedStrength(hand)
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
