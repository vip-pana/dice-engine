// The money rules: how much anyone can be committed to a hand, and what that forbids.

import { otherPlayer, type GameState, type PlayerId } from './gameTypes'
import { assert } from './stateOps'

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
export function assertAffordable(state: GameState, player: PlayerId, amount: number): void {
  const max = maxBetFor(state, player)
  assert(amount <= max, `bet of ${amount} exceeds the effective stack (max ${max})`)
}

/**
 * True when neither player has anything left to wager, so a betting round would be a
 * formality with nothing at stake. Such rounds are SKIPPED rather than presented with
 * every action disabled — being asked to bet nothing is worse than not being asked.
 */
export function noChipsBehind(state: GameState): boolean {
  return maxBetFor(state, 'human') <= 0 && maxBetFor(state, 'bot') <= 0
}
