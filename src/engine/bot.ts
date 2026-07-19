// Opponent AI as pure logic. chooseAction(state, player, rng) returns a single legal
// Action for the current phase. It reuses the shared strategy helpers (steal + reroll)
// so the bot plays the same policy the Monte Carlo simulator measures.
//
// All betting thresholds are NAMED CONSTANTS grouped in BOT_TUNING, so they are easy to
// find and re-balance during playtest. The bot is deterministic given the Rng.

import { chooseStolenDie, chooseRerollIndices, handScore } from './strategy'
import type { Rng } from './rng'
import type { Hand } from './types'
import type { Action } from './actions'
import type { GameState, PlayerId } from './gameTypes'

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
} as const

/**
 * Normalizes a hand's handScore into [0, 1] so thresholds are readable.
 * The min is the weakest possible 5-die score, the max the strongest (five sixes-ish);
 * we derive both from handScore of anchor hands to stay consistent with the scoring.
 */
const MIN_SCORE = handScore([{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 6 }])
// Strongest realistic hand: six-high straight is the top category in this game.
const MAX_SCORE = handScore([{ value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }, { value: 6 }])

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

  switch (state.phase) {
    case 'INITIAL_BET':
      return chooseInitialBet(state, player)
    case 'STEAL':
      return chooseSteal(state, player)
    case 'REROLL_SELECT':
      return chooseReroll(state, player, rng)
    case 'SECOND_BET':
      return chooseSecondBet(state, player)
    case 'SHOWDOWN':
    case 'MATCH_OVER':
      throw new Error(`[bot] no action to take in phase ${state.phase}`)
  }
}

// --- INITIAL_BET (blind) ---

function chooseInitialBet(state: GameState, player: PlayerId): Action {
  // Primary opens at the minimum; non-primary calls. Blind, so keep it flat.
  if (player === state.primary && state.aggressor === null) {
    return { type: 'OPEN', player, amount: state.config.minBet }
  }
  if (BOT_TUNING.raiseOnInitialBet && state.raisesThisWindow < state.config.maxRaisesPerWindow) {
    return { type: 'RAISE', player, amount: state.currentBet + state.config.minBet }
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
  return { type: 'REROLL', player, ownIndices: indices }
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
    return { type: 'OPEN', player, amount }
  }

  // Facing a bet: raise when strong (no fold — the bot always at least sees the bet).
  if (wantsRaise) {
    return { type: 'RAISE', player, amount: state.currentBet + state.config.minBet }
  }
  return { type: 'CALL', player }
}
