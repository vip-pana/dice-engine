// Core domain types for the pure rules engine.
// Portability note: everything here is plain data (numbers, string-literal unions,
// readonly arrays/objects) so it maps almost 1:1 to GDScript/C# structs & enums.

/** A single die face value. All dice are standard d6. */
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6

/**
 * Identifier of a die's special ability (roguelike upgrades).
 *
 * Data-driven on purpose: the roll behaviour of each ability lives in ONE table
 * (ABILITIES in abilities.ts), so adding the Nth ability is a new entry there, not a
 * new branch scattered across the engine. `null`/absent means a plain d6.
 *
 * Naming note: ids are stable strings (not numbers) so saved loadouts stay readable
 * and portable to GDScript/C# enums-by-name.
 */
export type AbilityId =
  /** Rolls 3 dice and keeps the highest. */
  | 'STELLA_ESSICCATA'
  /** A 4-sided die: rolls 1..4 instead of 1..6. */
  | 'D4'
  /**
   * Hides one of the OPPONENT's dice from them until the showdown.
   *
   * Unlike every other ability this one changes no value at all — it changes who knows
   * what. Its effect therefore lives outside AbilitySpec.roll (see `concealedIndices` on
   * PlayerHandState); the spec entry exists only so it can drop, be named and be drawn.
   */
  | 'NERO_DI_SEPPIA'
  /**
   * Doubles the pot the winner collects.
   *
   * Like NERO_DI_SEPPIA it changes no die value; unlike every other ability it moves
   * COINS, so its effect lives in the reducer at payout time (see `hasGoldenPayout` in
   * game.ts) rather than in AbilitySpec.roll. Held by a seat it doubles for that seat;
   * left unstolen among the commons it doubles for whoever wins.
   */
  | 'DADO_D_ORO'
  /**
   * Subtracts 1 from a die of the opponent's hand, chosen by this die's owner.
   *
   * The first ability that changes a VALUE, and someone else's at that — so like the two
   * above its effect cannot live in AbilitySpec.roll. Two moments, deliberately split (see
   * applyTorpedoes in game.ts): the owner picks the victim die during REROLL_SELECT, and
   * the -1 lands at the showdown. Applying it earlier would let the victim reroll the
   * zapped die and undo it for free, since a reroll rebuilds the die from its ability alone.
   *
   * Also the first ability that needs a player DECISION; the choice is stored as
   * `torpedoTarget` on PlayerHandState.
   */
  | 'DADO_TORPEDO'

/**
 * A rolled die.
 *
 * `ability` is the ability of the PHYSICAL die that produced this value; it travels with
 * the die so the UI can mark it and so a reroll re-applies the same ability. Absent for
 * plain dice, which keeps every existing `{ value }` literal valid.
 *
 * `rolls` records the individual faces an ability produced (e.g. Stella Essiccata's 3 dice)
 * purely so the UI can *show* the split. It is never read by hand evaluation.
 */
export interface Die {
  readonly value: DieValue
  readonly ability?: AbilityId | undefined
  readonly rolls?: readonly DieValue[] | undefined
  /**
   * Set only on a die that has been MASKED for a particular viewer (see view.ts): its
   * `value` is a placeholder, not the real face. Never set on the reducer's true state —
   * if you find it there, something wrote a view back into the engine.
   */
  readonly concealed?: boolean | undefined
}

/**
 * A final 5-die hand: the player's 4 own dice plus the 1 stolen common die.
 * The engine treats a hand purely as its 5 values for evaluation.
 */
export type Hand = readonly [Die, Die, Die, Die, Die]

/**
 * Ordinary hand categories, from lowest to highest.
 *
 * Rank 0 "High card" is added on top of the GDD (which starts at Pair) so any roll
 * is comparable at showdown. Straights are NOT here — they are special categories
 * (see StraightKind) that outrank every ordinary category.
 */
export enum OrdinaryRank {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  FullHouse = 4,
  FourOfAKind = 5,
  FiveOfAKind = 6,
}

/**
 * Special straight categories. They outrank all ordinary categories.
 * Their relative priority is data-driven (see STRAIGHT_PRIORITY in hand.ts),
 * so tweaking "six beats five" is a one-line change, not scattered logic.
 *
 * TODO(roguelike): the GDD also mentions a rare "Niente ★" category with an
 * undefined effect. Excluded from the MVP on purpose.
 */
export enum StraightKind {
  /** {1,2,3,4,5} */
  FiveHigh = 'FIVE_HIGH',
  /** {2,3,4,5,6} */
  SixHigh = 'SIX_HIGH',
}

/**
 * The evaluated category of a hand: either a straight or an ordinary rank.
 * Discriminated union on `kind` for exhaustive, portable branching.
 */
export type HandCategory =
  | { readonly kind: 'straight'; readonly straight: StraightKind }
  | { readonly kind: 'ordinary'; readonly rank: OrdinaryRank }

/**
 * Fully evaluated hand, ready for comparison.
 *
 * `tiebreakers` is an ordered list of die values used to break ties WITHIN the same
 * category, most significant first. Examples:
 *  - Pair:        [pairValue, kicker1, kicker2, kicker3]
 *  - Two pair:    [highPairValue, lowPairValue, kicker]
 *  - Full house:  [tripleValue, pairValue]
 *  - Straights:   [] (a straight of a given kind never ties-breaks on values)
 *
 * compareHands walks `tiebreakers` element by element. This keeps all tiebreak
 * rules in one place (evaluateHand) rather than scattered across comparison code.
 */
export interface EvaluatedHand {
  readonly category: HandCategory
  readonly tiebreakers: readonly DieValue[]
  /** The sorted die values (descending), kept for debugging/UI display. */
  readonly values: readonly DieValue[]
}

/** Result of comparing two hands. Sign convention matches Array.sort comparators. */
export type CompareResult = -1 | 0 | 1
