// Game-state domain types for the match state machine (reducer in game.ts).
// Kept separate from the hand-evaluation types (types.ts) so the two concerns stay tidy.
// Still pure data: string-literal unions + readonly structs, portable to GDScript/C#.

import type { Die, EvaluatedHand } from './types'
import type { AbilityDropConfig, Loadout, OwnDice } from './strategy'
import type { Deck } from './deck'

/**
 * Where a seat's 4 own dice come from. Explicit and per-seat, rather than inferred from
 * which config fields happen to be set: implicit precedence is exactly the trap `loadouts`
 * fell into by serving as both input and output.
 */
export type OwnDiceSource =
  /** A fixed loadout, supplied at match creation and held all match. */
  | { readonly kind: 'pinned' }
  /** Re-rolled every hand from `abilityDrops` (rollRandomLoadout). */
  | { readonly kind: 'drops' }
  /** Drawn every hand as HAND_SIZE of the seat's DECK_SIZE-die deck. */
  | { readonly kind: 'deck' }

/** The two seats at the table. Roles (primary/non-primary) rotate on top of these. */
export type PlayerId = 'human' | 'bot'

/** Returns the opposing seat. */
export function otherPlayer(p: PlayerId): PlayerId {
  return p === 'human' ? 'bot' : 'human'
}

/**
 * Phases of a single hand, in fixed order (see SPEC). The reducer advances through
 * these; only actions valid for the current phase are accepted.
 *
 *  ROLL_OFF      -> both players roll one die; highest becomes primary (tie -> re-roll)
 *  INITIAL_BET   -> primary opens with a free amount; opponent must see/raise (no fold)
 *  STEAL         -> primary steals a common die first, then non-primary (exclusive)
 *  REROLL_SELECT -> each player picks which own dice to reroll (up to 4; stolen fixed)
 *  SECOND_BET    -> primary bets >= first bet; opponent see/raise (no check, no fold)
 *  SHOWDOWN      -> hands compared, pot awarded (or split + replay on total tie)
 *  HAND_COMPLETE -> result recorded; ready to start next hand or end the match
 *  MATCH_OVER    -> Best of 3 decided
 *
 * Note: the dice rolls (own + common) happen deterministically on transition INTO
 * STEAL, so there is no separate "rolling" phase to click through.
 */
export type Phase =
  | 'ROLL_OFF'
  | 'INITIAL_BET'
  | 'STEAL'
  | 'REROLL_SELECT'
  | 'SECOND_BET'
  | 'SHOWDOWN'
  | 'HAND_COMPLETE'
  | 'MATCH_OVER'

/** Betting configuration. Amounts are player-chosen (free), bounded by these limits. */
export interface BetConfig {
  /** Minimum opening bet, and the minimum increment of any raise. */
  readonly minBet: number
  /** Max number of raises allowed within a single betting round (caps raise wars). */
  readonly maxRaisesPerWindow: number
}

/** Default betting configuration. Tunable in one place. */
export const DEFAULT_BET_CONFIG: BetConfig = {
  minBet: 10,
  maxRaisesPerWindow: 4,
}

/** Starting bankroll for each player. */
export const DEFAULT_STARTING_BANKROLL = 200

/** How many hand wins take the Best of 3. */
export const WINS_TO_TAKE_MATCH = 2

/** Per-player state within the current hand. */
export interface PlayerHandState {
  /** The 4 own dice (hidden from the opponent in the UI). Null before they are rolled. */
  readonly own: OwnDice | null
  /** The common die this player stole, or null before stealing. */
  readonly stolen: Die | null
  /** Chips this player has committed to the pot in the current hand. */
  readonly committed: number
  /**
   * Chosen own-dice indices to reroll (step 5). Recorded during REROLL_SELECT and
   * applied physically at the transition into SHOWDOWN (step 7). Null until chosen.
   */
  readonly rerollSelection: readonly number[] | null
  /**
   * Own-dice indices THIS player cannot see, because the opponent rolled a Nero di Seppia.
   *
   * Concealment is about knowledge, not value: a hidden die still counts in full at the
   * showdown, and the owner may still reroll it blind. The engine keeps the true value in
   * `own` — filtering is the VIEWER's job (see viewFor), so the reducer stays a single
   * source of truth and only the presentation layer is restricted.
   */
  readonly concealedIndices: readonly number[]
  /**
   * Index (0..3) into the OPPONENT's own dice that this seat's Dado Torpedo will zap, or
   * null when this seat has no Torpedo (or has not chosen yet).
   *
   * Chosen during REROLL_SELECT but applied at the showdown (see applyTorpedoes): the split
   * is what makes the -1 unavoidable, since a reroll rebuilds a die from its ability alone
   * and would otherwise wipe the effect for free.
   */
  readonly torpedoTarget: number | null
}

/** Outcome of a completed hand. There is no fold in the first round; see FoldAction. */
export type HandOutcome =
  | { readonly kind: 'win'; readonly winner: PlayerId }
  | { readonly kind: 'tie' } // total tie: pot split, hand replayed, no score change

/** Snapshot of a finished showdown, kept for the UI/log. */
export interface ShowdownInfo {
  readonly human: EvaluatedHand
  readonly bot: EvaluatedHand
  readonly outcome: HandOutcome
}

/**
 * The full match state. Immutable: the reducer returns a new object each transition.
 */
export interface GameState {
  readonly config: BetConfig
  readonly phase: Phase

  /**
   * THE 4 DICE THIS SEAT IS PLAYING RIGHT NOW — which ability sits on each of them.
   *
   * For a `pinned` seat this is fixed input config, held for the whole match. For a
   * `drops` or `deck` seat it is an OUTPUT: the result of that hand's draw, overwritten at
   * the start of every hand. Read `ownDiceSource` to know which. Defaults to four plain
   * dice, reproducing the base game bit for bit.
   */
  readonly loadouts: Readonly<Record<PlayerId, Loadout>>

  /** Where each seat's 4 own dice come from this match. See OwnDiceSource. */
  readonly ownDiceSource: Readonly<Record<PlayerId, OwnDiceSource>>

  /**
   * Each seat's 10-die deck, or null when that seat is not in deck mode.
   *
   * `Deck | null` rather than an optional field because `exactOptionalPropertyTypes` is on
   * and optional-vs-undefined gets fiddly across the record.
   */
  readonly decks: Readonly<Record<PlayerId, Deck | null>>

  /**
   * Seats whose loadout was supplied explicitly at match creation. Those are never
   * overwritten by random drops — that is how a test or a balance run pins one side to a
   * known loadout while the other side keeps drawing randomly.
   *
   * Kept as a mirror of `ownDiceSource[seat].kind === 'pinned'`: it is public API that
   * predates the mode field, and a derived boolean is cheaper than migrating its callers.
   */
  readonly pinnedLoadouts: Readonly<Record<PlayerId, boolean>>

  /**
   * Random-drop rates for own and common dice. `ownChance: 0` disables own-dice drops.
   *
   * `ownChance` is IGNORED for a seat in `deck` mode (its dice come from the deck), but the
   * value is kept rather than zeroed so the UI can still read the config. `commonChance`
   * applies in every mode — common dice belong to nobody and are never part of a deck.
   */
  readonly abilityDrops: AbilityDropConfig

  /**
   * Seat that holds the primary role this hand — decided by the ROLL_OFF at the start
   * of each hand (highest die wins). Meaningful from INITIAL_BET onward; during ROLL_OFF
   * it holds the previous hand's value and should not be relied upon.
   */
  readonly primary: PlayerId

  /**
   * The most recent roll-off dice (human vs bot). Set when ROLL_OFF resolves so the UI
   * can show who won the right to be primary. Null before the first roll-off.
   */
  readonly rollOff: { readonly human: Die; readonly bot: Die } | null

  /** 1-based index of the current hand within the match. */
  readonly handNumber: number

  /** Hand wins per seat (ties do not count). */
  readonly score: Readonly<Record<PlayerId, number>>
  /** Coins per seat. */
  readonly bankroll: Readonly<Record<PlayerId, number>>
  /** Chips in the pot for the current hand. */
  readonly pot: number

  /** Per-seat state within the current hand. */
  readonly hands: Readonly<Record<PlayerId, PlayerHandState>>

  /** The 3 common dice at the center (visible, fixed for the hand). Null before rolling. */
  readonly common: readonly [Die, Die, Die] | null
  /** Indices (into `common`) already taken by a steal, in steal order. */
  readonly stolenCommonIndices: readonly number[]

  /**
   * Betting bookkeeping for the CURRENT window. `currentBet` is the amount each player
   * must have committed to stay in; `raisesThisWindow` caps raise wars.
   */
  readonly currentBet: number
  readonly raisesThisWindow: number
  /**
   * The player who opened the current betting round (open/raise), or null before the
   * round is opened. A CALL that matches the aggressor's bet closes the round.
   */
  readonly aggressor: PlayerId | null
  /** Whose turn it is to act in the current betting/steal/reroll phase. */
  readonly toAct: PlayerId

  /** The second bet must be >= this (the settled amount of the first bet). */
  readonly firstBetAmount: number

  /** Result of the most recent showdown, for display. Null until a showdown resolves. */
  readonly lastShowdown: ShowdownInfo | null

  /** Human-readable action log (Italian), newest last. */
  readonly log: readonly string[]

  /** Set once the match is decided. */
  readonly matchWinner: PlayerId | null
}
