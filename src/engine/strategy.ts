import { evaluateHand, compareHands } from './hand'
import { ALL_ABILITY_IDS, abilitySpec, rerollDie, rollDieWithAbility } from './abilities'
import type { AbilityId, Die, Hand } from './types'
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

/**
 * Which ability sits on each of a player's 4 own dice — their "loadout".
 * `null` in a slot means that slot holds a plain d6, so `[null, null, null, null]`
 * (the default) reproduces the base game exactly.
 */
export type Loadout = readonly [
  AbilityId | null,
  AbilityId | null,
  AbilityId | null,
  AbilityId | null,
]

/** A loadout of four plain dice — the base game. */
export const PLAIN_LOADOUT: Loadout = [null, null, null, null]

/**
 * How often a special die turns up.
 *
 * At most one special die OF EACH TYPE per group — a hand can hold a Stella and a D4 at
 * once, but never two Stelle. Each ability in `pool` draws its own independent chance, so
 * `ownChance` is the per-ability probability that a hand contains that die, not the
 * probability of "a special" in the aggregate: with two abilities at 0.35, a hand carries
 * on average 0.7 specials and can carry two.
 *
 * Capping duplicates (rather than allowing four Stelle) keeps the strongest possible hand
 * bounded and each ability readable at a glance.
 */
export interface AbilityDropConfig {
  /** Chance in [0,1] that a player's 4 own dice contain a die of any GIVEN ability. */
  readonly ownChance: number
  /** Chance in [0,1] that the 3 common dice contain a die of any GIVEN ability. */
  readonly commonChance: number
  /** Which abilities can drop. Each draws independently at the rates above. */
  readonly pool: readonly AbilityId[]
}

/**
 * Default drop rates. A special shows up in roughly 1 hand in 3 for each player, and in
 * 1 set of commons in 5 — rare enough that drawing one still feels like an event, and
 * the steal stays mostly a value decision rather than a grab-the-special decision.
 */
export const DEFAULT_ABILITY_DROPS: AbilityDropConfig = {
  ownChance: 0.35,
  commonChance: 0.2,
  pool: ALL_ABILITY_IDS,
}

/** Drop config that never produces a special die — reproduces the base game exactly. */
export const NO_ABILITY_DROPS: AbilityDropConfig = {
  ownChance: 0,
  commonChance: 0,
  pool: ALL_ABILITY_IDS,
}

/**
 * Assigns abilities to `size` dice: every ability in the pool draws its own independent
 * chance, and each winner takes a distinct slot. Returns one entry per slot, null = plain.
 *
 * Two rules fall out of this shape:
 *  - at most ONE die of each ability, because every ability is drawn exactly once;
 *  - never more specials than there are dice, because slots are consumed as they are used.
 *
 * Rng discipline: the SAME number of draws is consumed per ability whether or not it
 * lands (one for the chance, one for the slot). That keeps the downstream dice stream
 * from shifting based on the outcome, so a seed stays reproducible while drop rates are
 * being tuned. `pool` order therefore matters for reproducibility — ALL_ABILITY_IDS is
 * registry order, which is stable.
 */
function drawAbilitySlots(
  rng: Rng,
  chance: number,
  pool: readonly AbilityId[],
  size: number,
): readonly (AbilityId | null)[] {
  const slots: (AbilityId | null)[] = Array.from({ length: size }, () => null)

  for (const id of pool) {
    const hits = chance > 0 && rng.next() < chance
    // Drawn unconditionally to keep the stream aligned; only used when `hits`.
    const pick = rng.nextInt(0, size - 1)
    if (!hits) {
      continue
    }
    // Take the drawn slot, or the next free one after it — so a collision between two
    // abilities shifts the second along instead of overwriting the first.
    for (let i = 0; i < size; i++) {
      const slot = (pick + i) % size
      if (slots[slot] === null) {
        slots[slot] = id
        break
      }
    }
  }

  return slots
}

/**
 * Rolls a fresh random loadout for one player's 4 own dice: at most one die of each
 * ability, each in a uniformly-chosen free slot.
 *
 * Drawn from the match Rng, so the whole sequence of specials is reproducible from the
 * seed — same seed, same drops, which is what makes bugs and balance runs repeatable.
 */
export function rollRandomLoadout(
  rng: Rng,
  drops: AbilityDropConfig = DEFAULT_ABILITY_DROPS,
): Loadout {
  const s = drawAbilitySlots(rng, drops.ownChance, drops.pool, 4)
  return [s[0] ?? null, s[1] ?? null, s[2] ?? null, s[3] ?? null]
}

/** Rolls 4 fresh own dice, applying each slot's ability from the loadout. */
export function rollOwnDice(rng: Rng, loadout: Loadout = PLAIN_LOADOUT): OwnDice {
  return [
    rollDieWithAbility(rng, loadout[0] ?? undefined),
    rollDieWithAbility(rng, loadout[1] ?? undefined),
    rollDieWithAbility(rng, loadout[2] ?? undefined),
    rollDieWithAbility(rng, loadout[3] ?? undefined),
  ]
}

/**
 * Rolls the 3 common dice offered at the center.
 *
 * Commons can carry abilities too — at most one of each type among the three, at their
 * own (lower) drop rate. A stolen special die keeps its ability, so the steal becomes
 * "high value now, or a die that rerolls better". With NO_ABILITY_DROPS this is
 * bit-for-bit plain.
 */
export function rollCommonDice(
  rng: Rng,
  drops: AbilityDropConfig = NO_ABILITY_DROPS,
): readonly [Die, Die, Die] {
  // Own-only abilities (those that target "the opponent") are filtered out here: a common
  // die has no owner while it sits at the centre, so such an effect has no target.
  const pool = drops.pool.filter((id) => abilitySpec(id)?.ownOnly !== true)
  const s = drawAbilitySlots(rng, drops.commonChance, pool, 3)
  return [
    rollDieWithAbility(rng, s[0] ?? undefined),
    rollDieWithAbility(rng, s[1] ?? undefined),
    rollDieWithAbility(rng, s[2] ?? undefined),
  ]
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

/**
 * Builds the final 5-die hand after rerolling the given own indices.
 * A rerolled die keeps its ability — the ability belongs to the physical die, not the roll.
 */
function finalHand(own: OwnDice, stolen: Die, reroll: ReadonlySet<number>, rng: Rng): Hand {
  const after = own.map((die, i) => (reroll.has(i) ? rerollDie(rng, die) : die))
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
  maxReroll: number = MAX_REROLL,
): readonly number[] {
  const ownIndices = [0, 1, 2, 3] as const
  const minKeep = own.length - maxReroll // how many own dice must be kept

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
export function playHeuristicHand(
  rng: Rng,
  maxReroll: number = MAX_REROLL,
  loadout: Loadout = PLAIN_LOADOUT,
): Hand {
  const own = rollOwnDice(rng, loadout)
  const common = rollCommonDice(rng)
  const { die: stolen } = chooseStolenDie(own, common)
  const reroll = new Set(chooseRerollIndices(own, stolen, rng, 60, maxReroll))
  return finalHand(own, stolen, reroll, rng)
}
