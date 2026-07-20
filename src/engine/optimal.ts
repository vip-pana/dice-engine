// Level-1 optimal single-hand solver: exact expected-value play, no sampling and no
// opponent modeling. It answers "how strong a hand can a player build if they play
// perfectly?" — the theoretical ceiling of the hand-building phase.
//
// Metric: expected `handScore` of the final 5-die hand (consistent with compareHands
// ordering). At each decision the solver picks the choice that maximizes exact EV:
//   - reroll: over every legal keep-set, the rerolled dice are uniform over 6 faces, so
//     the EV is computed EXACTLY by enumerating all 6^k outcomes (k = # rerolled, <= 4).
//   - steal:  try each available common die, solve the reroll EV for each, take the best.
//
// This is pure and deterministic given the input dice. It does NOT use an Rng: the reroll
// EV is analytic, not sampled.

import { handScore } from './strategy'
import type { OwnDice } from './strategy'
import type { Die, DieValue, Hand } from './types'

const FACES: readonly DieValue[] = [1, 2, 3, 4, 5, 6]

/**
 * Exact expected handScore of rerolling the given own-dice indices, keeping the rest,
 * with the stolen die fixed. Enumerates all 6^k equally-likely outcomes.
 */
function exactRerollEV(
  own: OwnDice,
  stolen: Die,
  rerollIdx: readonly number[],
): number {
  const k = rerollIdx.length
  if (k === 0) {
    return handScore([own[0], own[1], own[2], own[3], stolen])
  }

  const total = 6 ** k
  let sum = 0
  // Enumerate every assignment of faces to the k rerolled dice as a base-6 counter.
  const faceOf = new Array<DieValue>(k)
  for (let code = 0; code < total; code++) {
    let c = code
    for (let j = 0; j < k; j++) {
      faceOf[j] = FACES[c % 6]!
      c = Math.floor(c / 6)
    }
    const dice: DieValue[] = [own[0].value, own[1].value, own[2].value, own[3].value]
    for (let j = 0; j < k; j++) {
      dice[rerollIdx[j]!] = faceOf[j]!
    }
    const hand: Hand = [
      { value: dice[0]! },
      { value: dice[1]! },
      { value: dice[2]! },
      { value: dice[3]! },
      stolen,
    ]
    sum += handScore(hand)
  }
  return sum / total
}

export interface OptimalReroll {
  /** Own-dice indices (0..3) to reroll for maximum expected final strength. */
  readonly rerollIdx: readonly number[]
  /** The exact expected handScore achieved by that choice. */
  readonly ev: number
}

/**
 * Finds the reroll keep-set that maximizes exact expected final strength, given the fixed
 * stolen die. `maxReroll` bounds how many own dice may be rerolled (default 4 = all).
 */
export function optimalReroll(
  own: OwnDice,
  stolen: Die,
  maxReroll = 4,
): OptimalReroll {
  const idx = [0, 1, 2, 3] as const
  let best: OptimalReroll = { rerollIdx: [], ev: -Infinity }

  for (let mask = 0; mask < 1 << 4; mask++) {
    const reroll = idx.filter((i) => (mask & (1 << i)) !== 0)
    if (reroll.length > maxReroll) {
      continue
    }
    const ev = exactRerollEV(own, stolen, reroll)
    if (ev > best.ev) {
      best = { rerollIdx: reroll, ev }
    }
  }
  return best
}

export interface OptimalPlay {
  /** Index into the offered common dice of the die to steal. */
  readonly stealIndex: number
  /** The chosen reroll for that steal. */
  readonly reroll: OptimalReroll
}

/**
 * Solves the full hand-building decision: which common die to steal AND which own dice to
 * reroll, to maximize exact expected final strength. `available` are the common dice still
 * on offer (their index in this array is returned as `stealIndex`).
 */
export function optimalPlay(
  own: OwnDice,
  available: readonly Die[],
  maxReroll = 4,
): OptimalPlay {
  let best: OptimalPlay | null = null
  for (let i = 0; i < available.length; i++) {
    const reroll = optimalReroll(own, available[i]!, maxReroll)
    if (best === null || reroll.ev > best.reroll.ev) {
      best = { stealIndex: i, reroll }
    }
  }
  // available is never empty in a real hand; the non-null assertion is safe.
  return best!
}
