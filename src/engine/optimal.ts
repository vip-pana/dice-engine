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
 *
 * Exported so the bot can price a single die's extra roll (a Mulinello) with the same exact
 * arithmetic the solver uses, instead of a second, drifting EV estimate. Note the uniform
 * 1..6 assumption: valid for a plain die or a Mulinello, WRONG for an ability that reshapes
 * its faces (a Stella keeps max-of-3, a D4 caps at 4), so do not price those with this.
 *
 * By DEFAULT also WRONG for any die rolled in fog: an opponent's Dado Brumeggio makes every
 * reroll min-of-two, E[face] 2.528 rather than 3.500, so the uniform assumption over-values
 * rerolling in fog. The fog is a property of the SEAT, not of the die, so nothing in the dice
 * passed here reveals it — which is why a caller that knows its seat is fogged has to say so
 * by passing `faceWeights` (see FOGGED_FACE_WEIGHTS in abilities.ts).
 */
export function exactRerollEV(
  own: OwnDice,
  stolen: Die,
  rerollIdx: readonly number[],
  /**
   * Probability of each face, index 0 = face 1. Omit for a uniform (clear) die.
   *
   * Re-weighting the enumeration keeps the result EXACT — this is not a scale factor applied
   * to a uniform answer, which could not be exact because handScore is not linear in face
   * value. Each outcome simply gets its true probability instead of 1/6^k.
   */
  faceWeights?: readonly number[],
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
    // The uniform branch performs exactly the floating-point operations it always did — an
    // unweighted sum divided once at the end. That is load-bearing rather than tidy: this
    // function feeds an argmax (optimalReroll below), and re-associating the arithmetic could
    // flip a near-tie and quietly change how the default bot plays.
    if (faceWeights === undefined) {
      sum += handScore(hand)
    } else {
      let p = 1
      for (let j = 0; j < k; j++) {
        p *= faceWeights[faceOf[j]! - 1]!
      }
      sum += p * handScore(hand)
    }
  }
  // Weighted probabilities already sum to 1, so there is nothing left to divide by.
  return faceWeights === undefined ? sum / total : sum
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
 *
 * `faceWeights` is passed straight through to exactRerollEV — omit it for a clear seat, pass
 * FOGGED_FACE_WEIGHTS for a fogged one. It changes WHICH keep-set wins, not merely the EV of the
 * winner, and it changes it in BOTH directions: a fogged face averages 2.528 rather than 3.500,
 * but the fogged distribution is bunched on the low faces, so fresh dice pair up more often — and
 * a category outranks a face value. "In fog you should keep more" is therefore not what this
 * computes, and not what it finds.
 */
export function optimalReroll(
  own: OwnDice,
  stolen: Die,
  maxReroll = 4,
  faceWeights?: readonly number[],
): OptimalReroll {
  const idx = [0, 1, 2, 3] as const
  let best: OptimalReroll = { rerollIdx: [], ev: -Infinity }

  for (let mask = 0; mask < 1 << 4; mask++) {
    const reroll = idx.filter((i) => (mask & (1 << i)) !== 0)
    if (reroll.length > maxReroll) {
      continue
    }
    const ev = exactRerollEV(own, stolen, reroll, faceWeights)
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
 *
 * `faceWeights` passes through to the reroll EV, so a fogged seat picks the steal that is best
 * GIVEN the fog rather than the one that would be best in clear air.
 */
export function optimalPlay(
  own: OwnDice,
  available: readonly Die[],
  maxReroll = 4,
  faceWeights?: readonly number[],
): OptimalPlay {
  let best: OptimalPlay | null = null
  for (let i = 0; i < available.length; i++) {
    const reroll = optimalReroll(own, available[i]!, maxReroll, faceWeights)
    if (best === null || reroll.ev > best.reroll.ev) {
      best = { stealIndex: i, reroll }
    }
  }
  // available is never empty in a real hand; the non-null assertion is safe.
  return best!
}
