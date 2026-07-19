import { describe, it, expect } from 'vitest'
import { createRng } from '../src/engine'

describe('SeededRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const seqA = Array.from({ length: 20 }, () => a.rollDie())
    const seqB = Array.from({ length: 20 }, () => b.rollDie())
    expect(seqA).toEqual(seqB)
  })

  it('produces different streams for different seeds', () => {
    const a = createRng(1)
    const b = createRng(2)
    const seqA = Array.from({ length: 20 }, () => a.rollDie())
    const seqB = Array.from({ length: 20 }, () => b.rollDie())
    expect(seqA).not.toEqual(seqB)
  })

  it('rollDie only yields 1..6', () => {
    const r = createRng(999)
    for (let i = 0; i < 5000; i++) {
      const v = r.rollDie()
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
    }
  })

  it('nextInt covers both endpoints and stays in range', () => {
    const r = createRng(42)
    const seen = new Set<number>()
    for (let i = 0; i < 5000; i++) {
      const v = r.nextInt(1, 6)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
      seen.add(v)
    }
    expect(seen.has(1)).toBe(true)
    expect(seen.has(6)).toBe(true)
  })
})
