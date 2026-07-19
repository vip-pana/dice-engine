// Actions accepted by the match reducer. Each action carries the acting player so the
// reducer can validate it is that player's turn. Discriminated on `type`.

import type { PlayerId } from './gameTypes'

/** Betting actions, valid in INITIAL_BET and SECOND_BET (fold only in SECOND_BET). */
export type BetAction =
  /** Match the current bet (or, when currentBet==committed, this is a "check"). */
  | { readonly type: 'CALL'; readonly player: PlayerId }
  /** Raise by config.raiseStep (subject to maxRaisesPerWindow). */
  | { readonly type: 'RAISE'; readonly player: PlayerId }
  /** In INITIAL_BET only: primary posts the opening ante. */
  | { readonly type: 'OPEN'; readonly player: PlayerId }
  /** Fold — legal ONLY in SECOND_BET. Opponent wins the hand. */
  | { readonly type: 'FOLD'; readonly player: PlayerId }

/** Steal a common die by index (0..2), valid in STEAL. */
export interface StealAction {
  readonly type: 'STEAL'
  readonly player: PlayerId
  readonly commonIndex: number
}

/**
 * Commit a reroll selection, valid in REROLL_SELECT.
 * `ownIndices` are indices (0..3) of the player's OWN dice to reroll.
 * The reducer enforces: at most 3 selected (>=1 kept). The stolen die is never rerollable.
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

export type Action = BetAction | StealAction | RerollAction | NextHandAction
