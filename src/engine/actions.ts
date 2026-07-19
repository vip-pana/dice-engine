// Actions accepted by the match reducer. Each action carries the acting player so the
// reducer can validate it is that player's turn. Discriminated on `type`.

import type { PlayerId } from './gameTypes'

/**
 * Betting actions, valid in INITIAL_BET and SECOND_BET.
 *
 * Bet amounts are FREE (chosen by the player), subject to reducer-enforced minimums.
 * There is no fold and no check: to stay in a hand a player must always match or exceed
 * the current bet.
 */
export type BetAction =
  /** Match the current bet exactly (stay in without raising). */
  | { readonly type: 'CALL'; readonly player: PlayerId }
  /**
   * Raise the current bet TO `amount` (must be strictly greater than the current bet).
   * The player commits the difference between `amount` and what they already put in.
   */
  | { readonly type: 'RAISE'; readonly player: PlayerId; readonly amount: number }
  /**
   * Open the betting (INITIAL_BET only) by posting `amount` (>= config.minBet). The
   * primary chooses how much to bet.
   */
  | { readonly type: 'OPEN'; readonly player: PlayerId; readonly amount: number }

/** Steal a common die by index (0..2), valid in STEAL. */
export interface StealAction {
  readonly type: 'STEAL'
  readonly player: PlayerId
  readonly commonIndex: number
}

/**
 * Commit a reroll selection, valid in REROLL_SELECT.
 * `ownIndices` are indices (0..3) of the player's OWN dice to reroll.
 * All 4 own dice may be rerolled; only the stolen die is fixed.
 */
export interface RerollAction {
  readonly type: 'REROLL'
  readonly player: PlayerId
  readonly ownIndices: readonly number[]
}

/** Advance from HAND_COMPLETE to the next hand (or reveal MATCH_OVER). */
export interface NextHandAction {
  readonly type: 'NEXT_HAND'
}

/** Roll both players' dice to decide the primary for this hand (valid in ROLL_OFF). */
export interface RollOffAction {
  readonly type: 'ROLL_OFF'
}

export type Action =
  | BetAction
  | StealAction
  | RerollAction
  | NextHandAction
  | RollOffAction
