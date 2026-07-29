// Actions accepted by the match reducer. Each action carries the acting player so the
// reducer can validate it is that player's turn. Discriminated on `type`.

import type { PlayerId } from './gameTypes'
import type { AbilityId } from './types'

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
   * reroll, and the state machine stays untouched. (Contrast MulinelloAction, which could
   * NOT ride along: it has to be answered after the reroll result exists.)
   */
  readonly torpedoTarget?: number | undefined
  /**
   * The opponent ability a Dado Spugna cancels for this hand.
   *
   * Deliberately NOT symmetric with torpedoTarget above: this one is ALWAYS optional. It is
   * accepted whenever supplied and ignored when the seat holds no Spugna, rather than being
   * required-iff-held. Two reasons, both concrete:
   *
   *  - REROLL_SELECT is sequential. If sponging the opponent's Torpedo removed their
   *    obligation to name a victim mid-phase, their client would still send the target it
   *    computed a moment earlier and the reducer would reject it.
   *  - required-iff-held means every client must re-implement the ownership check. There are
   *    already four copies of seatHolds in this repo; this would make six.
   *
   * The reducer still rejects a target that names a non-spongeable ability, or a Spugna: those
   * are client bugs, not choices, and failing loudly beats a silent no-op.
   */
  readonly spongeTarget?: AbilityId | undefined
}

/**
 * Spend or decline a Mulinello's extra roll, valid in MULINELLO_SELECT.
 *
 * Two explicit action types rather than one carrying a boolean: declining is a real move that
 * passes the turn, and a reducer that accepted silence would leave the phase with no way to
 * tell "chose to keep" from "client never answered".
 */
export type MulinelloAction =
  /** Roll the Mulinello die once more, replacing its face. One-shot per hand. */
  | { readonly type: 'MULINELLO_ROLL'; readonly player: PlayerId }
  /** Keep the current face and pass the turn. */
  | { readonly type: 'MULINELLO_PASS'; readonly player: PlayerId }

/**
 * Pick which of a Dado Paguro's three covered faces to keep, valid in PAGURO_SELECT.
 *
 * `index` is 0..2 into the die's `rolls`. The pick is BLIND — the client sends an index without
 * ever being shown the faces (the die is masked in every view until the choice lands), so the
 * chosen face is a uniform draw whatever the index. One-shot per hand, tracked as `paguroChosen`.
 *
 * A single action carrying an index rather than a per-face choice: there is exactly one Paguro
 * per seat (it is ownOnly, so at most one own die can carry it), so "which face" is the whole
 * decision. Like MulinelloAction it could NOT ride along on the REROLL action: it has to be
 * answered after the reroll has resolved, once the dice are fixed.
 */
export interface PaguroChooseAction {
  readonly type: 'PAGURO_CHOOSE'
  readonly player: PlayerId
  readonly index: number
}

/**
 * Take a Dado Lanterna's one look at the opponent's deck. Valid from STEAL to SECOND_BET.
 *
 * THE ONLY ACTION IN THIS REDUCER THAT IS NOT A MOVE. It does not read `toAct`, does not write
 * it, and does not advance `phase` — it flips one flag and writes one log line. Every other
 * player action here asserts `toAct === player`; this one must NOT, or the button would be dead
 * for most of the hand: STEAL, REROLL_SELECT and MULINELLO_SELECT are all sequential, and a
 * player has to be able to peek while waiting for the opponent to act.
 *
 * If you are adding an action and copying a handler as a template, copy handleSteal, not this.
 */
export interface LanternPeekAction {
  readonly type: 'LANTERNA_PEEK'
  readonly player: PlayerId
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
  | MulinelloAction
  | PaguroChooseAction
  | LanternPeekAction
  | NextHandAction
  | RollOffAction
