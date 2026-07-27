import {
  OrdinaryRank,
  StraightKind,
  type CompareResult,
  type DieValue,
  type EvaluatedHand,
  type Hand,
  type HandCategory,
} from './types'

/**
 * Priority of special straight categories, LOW to HIGH.
 *
 * This is the single, data-driven place that encodes "Scala di sei batte Scala di
 * cinque" and "the straights outrank all ordinary hands". Change the order here to
 * re-tune straight priority during playtest — nothing else needs touching.
 *
 * Ordinary hands get priority values below every straight (see categoryPriority).
 */
const STRAIGHT_PRIORITY: readonly StraightKind[] = [
  StraightKind.FiveHigh,
  StraightKind.SixHigh,
]

/** How many ordinary rank slots exist (0..FiveOfAKind). Straights sit above these. */
const ORDINARY_SLOTS = OrdinaryRank.FiveOfAKind + 1

/**
 * Maps a category to a single comparable priority number (higher = stronger).
 * Ordinary ranks occupy [0, ORDINARY_SLOTS); straights occupy the slots above,
 * ordered by STRAIGHT_PRIORITY. This guarantees any straight beats any ordinary hand.
 */
export function categoryPriority(category: HandCategory): number {
  if (category.kind === 'ordinary') {
    return category.rank
  }
  const straightIndex = STRAIGHT_PRIORITY.indexOf(category.straight)
  return ORDINARY_SLOTS + straightIndex
}

/**
 * Every hand category that exists, ordered WEAKEST to STRONGEST.
 *
 * Built from the same two sources categoryPriority reads (the OrdinaryRank ladder and
 * STRAIGHT_PRIORITY), so a new category or a retuned straight order shows up here for
 * free — this list can never drift out of sync with the comparison rules.
 *
 * Exists for presentation (a "which hand beats which" legend); the engine itself never
 * needs to enumerate categories.
 */
export const ALL_HAND_CATEGORIES: readonly HandCategory[] = [
  ...Array.from({ length: ORDINARY_SLOTS }, (_unused, rank): HandCategory => ({
    kind: 'ordinary',
    rank: rank as OrdinaryRank,
  })),
  ...STRAIGHT_PRIORITY.map((straight): HandCategory => ({ kind: 'straight', straight })),
]

/** Counts occurrences of each die value in the hand. */
function countByValue(values: readonly DieValue[]): Map<DieValue, number> {
  const counts = new Map<DieValue, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

/** Detects a straight from a set of exactly 5 distinct-or-not values. */
function detectStraight(values: readonly DieValue[]): StraightKind | null {
  const unique = new Set(values)
  if (unique.size !== 5) {
    return null
  }
  const key = [...unique].sort((a, b) => a - b).join('')
  if (key === '23456') {
    return StraightKind.SixHigh
  }
  if (key === '12345') {
    return StraightKind.FiveHigh
  }
  return null
}

/**
 * Evaluates a 5-die hand into a comparable category + tiebreakers.
 *
 * The 5 dice are the player's 4 own dice plus the 1 stolen common die; this function
 * doesn't care which is which — it only sees the final five values.
 */
export function evaluateHand(hand: Hand): EvaluatedHand {
  const values = hand.map((d) => d.value)
  const sortedDesc = [...values].sort((a, b) => b - a)

  // Straights first: they outrank every ordinary category.
  const straight = detectStraight(values)
  if (straight !== null) {
    return {
      category: { kind: 'straight', straight },
      // A straight of a given kind is a fixed set of values, so it never ties on values.
      tiebreakers: [],
      values: sortedDesc,
    }
  }

  const counts = countByValue(values)
  // Group values by how many times they appear, then order groups by (count, value) desc.
  // e.g. full house 5-5-5-2-2 -> groups [{value:5,count:3},{value:2,count:2}].
  const groups = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || b.value - a.value)

  const counts0 = groups[0]?.count ?? 0
  const counts1 = groups[1]?.count ?? 0

  // Tiebreakers are built most-significant-first: the primary combination value(s),
  // then remaining kickers in descending order.
  const kickers = (minCount: number): DieValue[] =>
    groups
      .filter((g) => g.count < minCount)
      .map((g) => g.value)
      .sort((a, b) => b - a)

  let category: HandCategory
  let tiebreakers: DieValue[]

  if (counts0 === 5) {
    category = { kind: 'ordinary', rank: OrdinaryRank.FiveOfAKind }
    tiebreakers = [groups[0]!.value]
  } else if (counts0 === 4) {
    category = { kind: 'ordinary', rank: OrdinaryRank.FourOfAKind }
    tiebreakers = [groups[0]!.value, ...kickers(4)]
  } else if (counts0 === 3 && counts1 === 2) {
    category = { kind: 'ordinary', rank: OrdinaryRank.FullHouse }
    // Triple value first, then pair value: full-house ties break on triple then pair.
    tiebreakers = [groups[0]!.value, groups[1]!.value]
  } else if (counts0 === 3) {
    category = { kind: 'ordinary', rank: OrdinaryRank.ThreeOfAKind }
    tiebreakers = [groups[0]!.value, ...kickers(3)]
  } else if (counts0 === 2 && counts1 === 2) {
    category = { kind: 'ordinary', rank: OrdinaryRank.TwoPair }
    // Higher pair first, then lower pair, then the single kicker.
    const highPair = Math.max(groups[0]!.value, groups[1]!.value) as DieValue
    const lowPair = Math.min(groups[0]!.value, groups[1]!.value) as DieValue
    tiebreakers = [highPair, lowPair, ...kickers(2)]
  } else if (counts0 === 2) {
    category = { kind: 'ordinary', rank: OrdinaryRank.Pair }
    tiebreakers = [groups[0]!.value, ...kickers(2)]
  } else {
    category = { kind: 'ordinary', rank: OrdinaryRank.HighCard }
    tiebreakers = [...sortedDesc]
  }

  return { category, tiebreakers, values: sortedDesc }
}

/**
 * Compares two evaluated hands.
 * Returns 1 if `a` wins, -1 if `b` wins, 0 for a total tie (split pot / replay).
 *
 * A 0 here means the two hands are indistinguishable under the rules: same category,
 * same primary combination, same kickers. The caller (game reducer) treats that as a
 * tie hand that splits the pot and is replayed without scoring.
 */
export function compareHands(a: EvaluatedHand, b: EvaluatedHand): CompareResult {
  const pa = categoryPriority(a.category)
  const pb = categoryPriority(b.category)
  if (pa !== pb) {
    return pa > pb ? 1 : -1
  }

  // Same category: walk tiebreakers most-significant-first.
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length)
  for (let i = 0; i < len; i++) {
    const va = a.tiebreakers[i] ?? 0
    const vb = b.tiebreakers[i] ?? 0
    if (va !== vb) {
      return va > vb ? 1 : -1
    }
  }
  return 0
}
