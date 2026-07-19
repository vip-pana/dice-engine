import { describe, it, expect } from 'vitest'
import {
  handScore,
  evaluateHand,
  compareHands,
  chooseStolenDie,
  createRng,
  type Die,
  type DieValue,
  type Hand,
  type OwnDice,
} from '../src/engine'

function hand(a: DieValue, b: DieValue, c: DieValue, d: DieValue, e: DieValue): Hand {
  return [{ value: a }, { value: b }, { value: c }, { value: d }, { value: e }]
}

/** Enumerate a spread of representative hands covering every category. */
function sampleHands(): Hand[] {
  const rng = createRng(7)
  const hands: Hand[] = [
    hand(1, 2, 3, 4, 6), // high card
    hand(2, 2, 1, 4, 6), // pair
    hand(5, 5, 3, 3, 1), // two pair
    hand(6, 6, 6, 2, 1), // trips
    hand(4, 4, 4, 5, 5), // full house
    hand(3, 3, 3, 3, 6), // four of a kind
    hand(2, 2, 2, 2, 2), // five of a kind
    hand(1, 2, 3, 4, 5), // five-high straight
    hand(2, 3, 4, 5, 6), // six-high straight
  ]
  // Add random hands for broader coverage.
  for (let i = 0; i < 200; i++) {
    hands.push([
      { value: rng.rollDie() },
      { value: rng.rollDie() },
      { value: rng.rollDie() },
      { value: rng.rollDie() },
      { value: rng.rollDie() },
    ])
  }
  return hands
}

describe('handScore is consistent with compareHands', () => {
  it('agrees on ordering for every pair of sampled hands', () => {
    const hands = sampleHands()
    for (const a of hands) {
      for (const b of hands) {
        const cmp = compareHands(evaluateHand(a), evaluateHand(b))
        const sa = handScore(a)
        const sb = handScore(b)
        if (cmp > 0) expect(sa).toBeGreaterThan(sb)
        else if (cmp < 0) expect(sa).toBeLessThan(sb)
        else expect(sa).toBe(sb)
      }
    }
  })
})

describe('chooseStolenDie', () => {
  it('picks the common die that maximizes the current hand', () => {
    // Own dice: three 5s and a 1. Commons: a 5 (=> four of a kind), a 2, a 3.
    const own: OwnDice = [{ value: 5 }, { value: 5 }, { value: 5 }, { value: 1 }]
    const common: Die[] = [{ value: 2 }, { value: 5 }, { value: 3 }]
    const { die, index } = chooseStolenDie(own, common)
    expect(die.value).toBe(5)
    expect(index).toBe(1)
  })
})
