// Actions accepted by the match reducer. Each action carries the acting player so the
// reducer can validate it is that player's turn. Discriminated on `type`.

import type { PlayerId } from './gameTypes'

/**
 * Betting actions, valid in INITIAL_BET and SECOND_BET.
 *
 * Bet amounts are FREE (chosen by the player), subject to reducer-enforced minimums.
 * There is no check: to stay in a hand a player must always match or exceed the current
 * bet. Folding is allowed only in SECOND_BET, and only when facing a bet (see FoldAction).
 */
export type BetAction =
  /** Match the current bet exactly (stay in without raising). */
  | { readonly type: 'CALL'; readonly player: PlayerId }
  /**
   * Give up the hand, conceding the pot to the opponent.
   *
   * Restricted to SECOND_BET and to a player facing a bet: by then both hands are fully
   * formed, so folding is an informed read rather than a blind escape. The opponent takes
   * the pot AND the Bo3 point, so a match can be won on folds alone.
   */
  | { readonly type: 'FOLD'; readonly player: PlayerId }
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
  /**
   * Index (0..3) of the OPPONENT's own die to zap with a Dado Torpedo.
   *
   * Required if and only if this player holds a Torpedo — the reducer asserts both ways, so
   * a client can neither skip the choice nor zap without the die. Rides on this action
   * rather than getting its own phase: the choice belongs to the same decision point as the
   * reroll, and the state machine stays untouched.
   */
  readonly torpedoTarget?: number | undefined
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
