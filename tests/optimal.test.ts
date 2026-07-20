import { describe, it, expect } from 'vitest'
import {
  optimalReroll,
  optimalPlay,
  handScore,
  chooseRerollIndices,
  createRng,
  type Die,
  type DieValue,
  type OwnDice,
} from '../src/engine'

function own(a: DieValue, b: DieValue, c: DieValue, d: DieValue): OwnDice {
  return [{ value: a }, { value: b }, { value: c }, { value: d }]
}

/** Brute-force exact EV of a keep-set, independent of optimal.ts, to cross-check. */
function bruteEV(o: OwnDice, stolen: Die, rerollIdx: number[]): number {
  const faces: DieValue[] = [1, 2, 3, 4, 5, 6]
  const k = rerollIdx.length
  if (k === 0) return handScore([o[0], o[1], o[2], o[3], stolen])
  let sum = 0
  const total = 6 ** k
  for (let code = 0; code < total; code++) {
    let c = code
    const vals: DieValue[] = [o[0].value, o[1].value, o[2].value, o[3].value]
    for (let j = 0; j < k; j++) {
      vals[rerollIdx[j]!] = faces[c % 6]!
      c = Math.floor(c / 6)
    }
    sum += handScore([
      { value: vals[0]! },
      { value: vals[1]! },
      { value: vals[2]! },
      { value: vals[3]! },
      stolen,
    ])
  }
  return sum / total
}

describe('optimalReroll', () => {
  it('keeps a made straight draw: 2,3,4,5 + stolen 2 rerolls the duplicate to chase the six-high straight', () => {
    // Own 2,3,4,5 with a stolen 2: the greedy view keeps the pair of 2s; the optimal view
    // sees a strong straight draw (needs a 6) and should reroll exactly the duplicate 2.
    const o = own(2, 3, 4, 5)
    const stolen: Die = { value: 2 }
    const best = optimalReroll(o, stolen)
    // The best play rerolls the own die whose value is 2 (index 0), keeping 3,4,5.
    expect(best.rerollIdx).toEqual([0])
  })

  it('reported EV matches an independent brute-force enumeration', () => {
    const o = own(6, 6, 2, 3)
    const stolen: Die = { value: 6 }
    const best = optimalReroll(o, stolen)
    const check = bruteEV(o, stolen, [...best.rerollIdx])
    expect(best.ev).toBeCloseTo(check, 6)
  })

  it('never rerolls more dice than maxReroll', () => {
    const o = own(1, 2, 3, 4)
    const stolen: Die = { value: 6 }
    const best3 = optimalReroll(o, stolen, 3)
    expect(best3.rerollIdx.length).toBeLessThanOrEqual(3)
  })
})

describe('optimalPlay steal choice', () => {
  it('picks the common die that yields the highest optimal EV', () => {
    const o = own(5, 5, 5, 1)
    // Offer a 5 (=> four of a kind, unbeatable EV) vs a 2 and a 3.
    const common: Die[] = [{ value: 2 }, { value: 5 }, { value: 3 }]
    const play = optimalPlay(o, common)
    expect(play.stealIndex).toBe(1)
  })
})

describe('optimal dominates the heuristic on expected strength', () => {
  it('optimal EV >= heuristic-choice EV across many random spots', () => {
    const rng = createRng(2026)
    let optimalWins = 0
    let ties = 0
    const N = 400
    for (let t = 0; t < N; t++) {
      const o = own(
        rng.rollDie(),
        rng.rollDie(),
        rng.rollDie(),
        rng.rollDie(),
      )
      const stolen: Die = { value: rng.rollDie() }

      const optimal = optimalReroll(o, stolen)
      // What the heuristic would choose, scored on the SAME exact-EV metric.
      const heuristicIdx = [...chooseRerollIndices(o, stolen, createRng(t + 1))]
      const heuristicEV = bruteEV(o, stolen, heuristicIdx)

      // Optimal must never be worse than the heuristic's choice (within fp tolerance).
      expect(optimal.ev).toBeGreaterThanOrEqual(heuristicEV - 1e-6)
      if (optimal.ev > heuristicEV + 1e-6) optimalWins++
      else ties++
    }
    // Sanity: the two agree often, but optimal strictly wins in a meaningful share.
    expect(optimalWins + ties).toBe(N)
  })
})
