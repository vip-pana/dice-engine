// Core domain types for the pure rules engine.
// Portability note: everything here is plain data (numbers, string-literal unions,
// readonly arrays/objects) so it maps almost 1:1 to GDScript/C# structs & enums.

/** A single die face value. All dice are standard d6. */
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6

/** A rolled die. Kept as a distinct type so we can attach metadata later without churn. */
export interface Die {
  readonly value: DieValue
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
