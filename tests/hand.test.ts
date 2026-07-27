import { describe, it, expect } from 'vitest'
import {
  ALL_HAND_CATEGORIES,
  categoryPriority,
  evaluateHand,
  compareHands,
  OrdinaryRank,
  StraightKind,
  type DieValue,
  type Hand,
} from '../src/engine'

/** Builds a Hand from exactly 5 die values, for terse test fixtures. */
function hand(a: DieValue, b: DieValue, c: DieValue, d: DieValue, e: DieValue): Hand {
  return [{ value: a }, { value: b }, { value: c }, { value: d }, { value: e }]
}

describe('evaluateHand — categories', () => {
  it('high card (5 distinct values that do not form a straight)', () => {
    const h = evaluateHand(hand(1, 3, 4, 6, 2))
    expect(h.category).toEqual({ kind: 'ordinary', rank: OrdinaryRank.HighCard })
    expect(h.tiebreakers).toEqual([6, 4, 3, 2, 1])
  })

  it('pair', () => {
    const h = evaluateHand(hand(4, 4, 1, 3, 6))
    expect(h.category).toEqual({ kind: 'ordinary', rank: OrdinaryRank.Pair })
    expect(h.tiebreakers).toEqual([4, 6, 3, 1]) // pair value, then kickers desc
  })

  it('two pair', () => {
    const h = evaluateHand(hand(5, 5, 2, 2, 6))
    expect(h.category).toEqual({ kind: 'ordinary', rank: OrdinaryRank.TwoPair })
    expect(h.tiebreakers).toEqual([5, 2, 6]) // high pair, low pair, kicker
  })

  it('three of a kind', () => {
    const h = evaluateHand(hand(3, 3, 3, 1, 6))
    expect(h.category).toEqual({ kind: 'ordinary', rank: OrdinaryRank.ThreeOfAKind })
    expect(h.tiebreakers).toEqual([3, 6, 1])
  })

  it('full house', () => {
    const h = evaluateHand(hand(2, 2, 2, 5, 5))
    expect(h.category).toEqual({ kind: 'ordinary', rank: OrdinaryRank.FullHouse })
    expect(h.tiebreakers).toEqual([2, 5]) // triple value, then pair value
  })

  it('four of a kind', () => {
    const h = evaluateHand(hand(6, 6, 6, 6, 1))
    expect(h.category).toEqual({ kind: 'ordinary', rank: OrdinaryRank.FourOfAKind })
    expect(h.tiebreakers).toEqual([6, 1])
  })

  it('five of a kind', () => {
    const h = evaluateHand(hand(4, 4, 4, 4, 4))
    expect(h.category).toEqual({ kind: 'ordinary', rank: OrdinaryRank.FiveOfAKind })
    expect(h.tiebreakers).toEqual([4])
  })

  it('five-high straight {1,2,3,4,5}', () => {
    const h = evaluateHand(hand(3, 1, 5, 2, 4))
    expect(h.category).toEqual({ kind: 'straight', straight: StraightKind.FiveHigh })
    expect(h.tiebreakers).toEqual([])
  })

  it('six-high straight {2,3,4,5,6}', () => {
    const h = evaluateHand(hand(6, 4, 2, 5, 3))
    expect(h.category).toEqual({ kind: 'straight', straight: StraightKind.SixHigh })
    expect(h.tiebreakers).toEqual([])
  })
})

describe('compareHands — category ordering', () => {
  it('higher ordinary rank wins', () => {
    const trips = evaluateHand(hand(3, 3, 3, 1, 6))
    const twoPair = evaluateHand(hand(5, 5, 2, 2, 6))
    expect(compareHands(trips, twoPair)).toBe(1)
    expect(compareHands(twoPair, trips)).toBe(-1)
  })

  it('both straights beat every ordinary hand (even five of a kind)', () => {
    const fiveKind = evaluateHand(hand(6, 6, 6, 6, 6))
    const fiveHigh = evaluateHand(hand(1, 2, 3, 4, 5))
    const sixHigh = evaluateHand(hand(2, 3, 4, 5, 6))
    expect(compareHands(fiveHigh, fiveKind)).toBe(1)
    expect(compareHands(sixHigh, fiveKind)).toBe(1)
  })

  it('six-high straight beats five-high straight', () => {
    const sixHigh = evaluateHand(hand(2, 3, 4, 5, 6))
    const fiveHigh = evaluateHand(hand(1, 2, 3, 4, 5))
    expect(compareHands(sixHigh, fiveHigh)).toBe(1)
    expect(compareHands(fiveHigh, sixHigh)).toBe(-1)
  })
})

describe('compareHands — tiebreaks within a category', () => {
  it('higher trips beat lower trips', () => {
    const highTrips = evaluateHand(hand(5, 5, 5, 1, 2))
    const lowTrips = evaluateHand(hand(3, 3, 3, 6, 4))
    expect(compareHands(highTrips, lowTrips)).toBe(1)
  })

  it('same combination breaks on kicker', () => {
    const a = evaluateHand(hand(4, 4, 6, 3, 1))
    const b = evaluateHand(hand(4, 4, 5, 3, 1))
    expect(compareHands(a, b)).toBe(1) // kicker 6 beats 5
  })

  it('full house ties on triple then breaks on pair', () => {
    const a = evaluateHand(hand(5, 5, 5, 6, 6)) // triple 5, pair 6
    const b = evaluateHand(hand(5, 5, 5, 2, 2)) // triple 5, pair 2
    expect(compareHands(a, b)).toBe(1)
  })

  it('two pair breaks on high pair, then low pair, then kicker', () => {
    const a = evaluateHand(hand(6, 6, 2, 2, 3))
    const b = evaluateHand(hand(5, 5, 4, 4, 3))
    expect(compareHands(a, b)).toBe(1) // high pair 6 beats 5

    const c = evaluateHand(hand(6, 6, 4, 4, 1))
    const d = evaluateHand(hand(6, 6, 2, 2, 5))
    expect(compareHands(c, d)).toBe(1) // low pair 4 beats 2

    const e = evaluateHand(hand(6, 6, 4, 4, 5))
    const f = evaluateHand(hand(6, 6, 4, 4, 3))
    expect(compareHands(e, f)).toBe(1) // kicker 5 beats 3
  })

  it('total tie returns 0 (split pot / replay)', () => {
    const a = evaluateHand(hand(4, 4, 6, 3, 1))
    const b = evaluateHand(hand(4, 4, 6, 3, 1))
    expect(compareHands(a, b)).toBe(0)
  })

  it('two straights of the same kind total-tie', () => {
    const a = evaluateHand(hand(2, 3, 4, 5, 6))
    const b = evaluateHand(hand(6, 5, 4, 3, 2))
    expect(compareHands(a, b)).toBe(0)
  })
})

describe('compareHands — invariants', () => {
  it('is antisymmetric across many seeds', () => {
    const fixtures: Hand[] = [
      hand(1, 1, 1, 1, 1),
      hand(2, 3, 4, 5, 6),
      hand(1, 2, 3, 4, 5),
      hand(6, 6, 6, 2, 2),
      hand(5, 5, 5, 5, 1),
      hand(4, 4, 3, 3, 1),
      hand(2, 2, 6, 4, 1),
      hand(6, 5, 4, 2, 1),
    ]
    for (const x of fixtures) {
      for (const y of fixtures) {
        const forward = compareHands(evaluateHand(x), evaluateHand(y))
        const backward = compareHands(evaluateHand(y), evaluateHand(x))
        // `|| 0` normalizes -0 (from negating +0) to +0 for Object.is equality.
        expect(forward).toBe((-backward || 0) as -1 | 0 | 1)
      }
    }
  })
})

describe('ALL_HAND_CATEGORIES', () => {
  it('is ordered weakest to strongest, with no gaps or duplicates', () => {
    const priorities = ALL_HAND_CATEGORIES.map(categoryPriority)
    expect(priorities).toEqual(priorities.map((_p, i) => i))
  })

  it('covers every ordinary rank and every straight exactly once', () => {
    // Guards the legend against silently missing a category added to the enums later.
    const ordinary = ALL_HAND_CATEGORIES.filter((c) => c.kind === 'ordinary')
    const straights = ALL_HAND_CATEGORIES.filter((c) => c.kind === 'straight')
    expect(ordinary.length).toBe(OrdinaryRank.FiveOfAKind + 1)
    expect(straights.length).toBe(Object.keys(StraightKind).length)
  })

  it('ranks every straight above every ordinary hand', () => {
    const worstStraight = Math.min(
      ...ALL_HAND_CATEGORIES.filter((c) => c.kind === 'straight').map(categoryPriority),
    )
    const bestOrdinary = Math.max(
      ...ALL_HAND_CATEGORIES.filter((c) => c.kind === 'ordinary').map(categoryPriority),
    )
    expect(worstStraight).toBeGreaterThan(bestOrdinary)
  })
})
