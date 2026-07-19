import { evaluateHand, compareHands } from './hand'
import type { Die, Hand } from './types'
import type { Rng } from './rng'

/**
 * Shared reroll heuristic, used by both the Monte Carlo simulator (Step 3) and the
 * bot (Step 5). Kept pure and portable: it only reads dice values and an injected Rng.
 *
 * Constraints enforced by the rules:
 *  - Only the 4 OWN dice may be rerolled; the stolen die is always fixed.
 *  - Up to MAX_REROLL (all 4) own dice may be rerolled.
 */
export const MAX_REROLL = 4

/** The 4 own dice of a player, before the stolen die is added. */
export type OwnDice = readonly [Die, Die, Die, Die]

/** Rolls 4 fresh own dice. */
export function rollOwnDice(rng: Rng): OwnDice {
  return [
    { value: rng.rollDie() },
    { value: rng.rollDie() },
    { value: rng.rollDie() },
    { value: rng.rollDie() },
  ]
}

/** Rolls the 3 common dice offered at the center. */
export function rollCommonDice(rng: Rng): readonly [Die, Die, Die] {
  return [{ value: rng.rollDie() }, { value: rng.rollDie() }, { value: rng.rollDie() }]
}

/**
 * A monotonic scalar score for a hand, used to RANK options against each other.
 * It is consistent with compareHands: for any two hands, `handScore(a) > handScore(b)`
 * iff `compareHands(evaluate(a), evaluate(b)) > 0`. (Verified in strategy tests.)
 *
 * Encoding: category priority in the high digits, then tiebreaker values as a
 * fixed-width base-7 number (die values are 1..6, so base 7 keeps digits disjoint).
 */
export function handScore(hand: Hand): number {
  const e = evaluateHand(hand)
  const priority =
    e.category.kind === 'ordinary'
      ? e.category.rank // 0..6
      : e.category.straight === 'FIVE_HIGH'
        ? 7 // straights outrank all ordinary ranks (max ordinary priority = 6)
        : 8 // SixHigh, matching STRAIGHT_PRIORITY order in hand.ts

  // Up to 5 tiebreakers, each a value 1..6, packed as base-7 digits (most significant first).
  let tb = 0
  for (const t of e.tiebreakers) {
    tb = tb * 7 + t
  }
  // Reserve 6 base-7 digits worth of space for tiebreakers under the priority.
  const TB_SPACE = 7 ** 6
  return priority * TB_SPACE + tb
}

/** Builds the final 5-die hand after rerolling the given own indices. */
function finalHand(own: OwnDice, stolen: Die, reroll: ReadonlySet<number>, rng: Rng): Hand {
  const after = own.map((die, i) => (reroll.has(i) ? { value: rng.rollDie() } : die))
  return [after[0]!, after[1]!, after[2]!, after[3]!, stolen]
}

/**
 * Estimates expected strength of rerolling `reroll` by sampling outcomes and averaging
 * handScore. With no reroll the outcome is deterministic (one evaluation).
 */
function expectedScore(
  own: OwnDice,
  stolen: Die,
  reroll: ReadonlySet<number>,
  rng: Rng,
  samples: number,
): number {
  if (reroll.size === 0) {
    return handScore(finalHand(own, stolen, reroll, rng))
  }
  let total = 0
  for (let s = 0; s < samples; s++) {
    total += handScore(finalHand(own, stolen, reroll, rng))
  }
  return total / samples
}

/**
 * Chooses which of the 4 own dice indices (0..3) to reroll, given the fixed stolen die.
 *
 * Enumerates every legal keep-set (respecting "keep at least 4 - MAX_REROLL = 1"),
 * estimates each option's expected strength via sampling, and rerolls the complement of
 * the best keep-set. Deterministic given the seed.
 */
export function chooseRerollIndices(
  own: OwnDice,
  stolen: Die,
  rng: Rng,
  samplesPerOption = 60,
): readonly number[] {
  const ownIndices = [0, 1, 2, 3] as const
  const minKeep = own.length - MAX_REROLL // = 1

  let bestReroll: readonly number[] = []
  let bestScore = -Infinity

  for (let mask = 0; mask < 1 << own.length; mask++) {
    const keep = ownIndices.filter((i) => (mask & (1 << i)) !== 0)
    if (keep.length < minKeep) {
      continue
    }
    const reroll = new Set(ownIndices.filter((i) => !keep.includes(i)))
    const score = expectedScore(own, stolen, reroll, rng, samplesPerOption)
    if (score > bestScore) {
      bestScore = score
      bestReroll = [...reroll]
    }
  }

  return bestReroll
}

/**
 * Greedy steal: picks the common die that maximizes the player's current hand
 * (evaluate own 4 + candidate). Shared by simulator and bot.
 */
export function chooseStolenDie(
  own: OwnDice,
  common: readonly Die[],
): { die: Die; index: number } {
  let bestIndex = 0
  let bestHand: Hand | null = null
  for (let i = 0; i < common.length; i++) {
    const candidate = common[i]!
    const trial: Hand = [own[0], own[1], own[2], own[3], candidate]
    if (bestHand === null || compareHands(evaluateHand(trial), evaluateHand(bestHand)) > 0) {
      bestHand = trial
      bestIndex = i
    }
  }
  return { die: common[bestIndex]!, index: bestIndex }
}

/**
 * Full heuristic play of a single hand: roll own + common, greedy-steal the best common
 * die, then reroll by heuristic. Returns the final 5-die hand. Used by the simulator.
 */
export function playHeuristicHand(rng: Rng): Hand {
  const own = rollOwnDice(rng)
  const common = rollCommonDice(rng)
  const { die: stolen } = chooseStolenDie(own, common)
  const reroll = new Set(chooseRerollIndices(own, stolen, rng))
  return finalHand(own, stolen, reroll, rng)
}
