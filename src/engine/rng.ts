import type { DieValue } from './types'

/**
 * Injected source of randomness for the whole engine.
 *
 * The engine NEVER calls Math.random directly — all randomness flows through an Rng
 * instance passed in by the caller. This makes every simulation and test fully
 * deterministic and reproducible from a seed.
 */
export interface Rng {
  /** Returns a float in [0, 1). */
  next(): number
  /** Returns an integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number
  /** Rolls a single standard d6. */
  rollDie(): DieValue
}

/**
 * Deterministic, seedable Rng using mulberry32.
 *
 * Portability note: mulberry32 is a tiny integer PRNG that ports trivially to any
 * language with 32-bit unsigned integer math. We keep the state explicit so the
 * same seed always yields the same stream.
 */
export class SeededRng implements Rng {
  private state: number

  constructor(seed: number) {
    // Force to a 32-bit unsigned integer.
    this.state = seed >>> 0
  }

  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  nextInt(min: number, max: number): number {
    if (min > max) {
      throw new Error(`nextInt: min (${min}) must be <= max (${max})`)
    }
    const span = max - min + 1
    return min + Math.floor(this.next() * span)
  }

  rollDie(): DieValue {
    // nextInt(1, 6) is always in range, so the cast is sound.
    return this.nextInt(1, 6) as DieValue
  }
}

/** Convenience constructor so callers don't import the class name everywhere. */
export function createRng(seed: number): Rng {
  return new SeededRng(seed)
}
