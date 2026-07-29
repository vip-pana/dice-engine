import { evaluateHand, compareHands } from './hand'
import {
  ALL_ABILITY_IDS,
  NO_MODIFIERS,
  abilitySpec,
  rerollDie,
  rollDieWithAbility,
  type RollModifiers,
} from './abilities'
import type { AbilityId, Die, DieValue, Hand } from './types'
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

/**
 * Rolls 4 fresh own dice, applying each slot's ability from the loadout.
 *
 * `mods` applies to all four dice, because it describes the SEAT rolling them, not any one
 * die — an opponent's Dado Brumeggio fogs everything this seat throws.
 */
export function rollOwnDice(
  rng: Rng,
  loadout: Loadout = PLAIN_LOADOUT,
  mods: RollModifiers = NO_MODIFIERS,
): OwnDice {
  return [
    rollDieWithAbility(rng, loadout[0] ?? undefined, mods),
    rollDieWithAbility(rng, loadout[1] ?? undefined, mods),
    rollDieWithAbility(rng, loadout[2] ?? undefined, mods),
    rollDieWithAbility(rng, loadout[3] ?? undefined, mods),
  ]
}

/**
 * Rolls the 3 common dice offered at the center.
 *
 * Commons can carry abilities too — at most one of each type among the three, at their
 * own (lower) drop rate. A stolen special die keeps its ability, so the steal becomes
 * "high value now, or a die that rerolls better". With NO_ABILITY_DROPS this is
 * bit-for-bit plain.
 *
 * Takes no RollModifiers, deliberately: a common die is rolled while it belongs to nobody, so
 * no seat's fog can reach it. "Whose fog was this rolled in?" has no answer at the centre.
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
 * Picks which of the victim's 4 own dice a Dado Torpedo should zap: the one whose -1 hurts
 * the victim's hand most.
 *
 * Scores each candidate with `handScore`, which is monotonic with compareHands (asserted in
 * tests/strategy.test.ts), so "lowest resulting score" really is "weakest resulting hand".
 * That matters because the damage is not about the face value: taking 1 off a die that
 * breaks a full house costs far more than taking 1 off a lone 6.
 *
 * Ties go to the lowest index, so the choice is deterministic and testable. Feed this the
 * victim's VISIBLE dice (a view): a die concealed by a Nero di Seppia must not inform it.
 */
export function chooseTorpedoTarget(victimOwn: OwnDice, victimStolen: Die): number {
  let bestIndex = 0
  let bestScore = Infinity

  for (let i = 0; i < victimOwn.length; i++) {
    const die = victimOwn[i]!
    // Same floor as the reducer's zapDie: a 1 cannot drop to 0.
    const value = (die.value > 1 ? die.value - 1 : 1) as DieValue
    const after = victimOwn.map((d, j) => (j === i ? { ...d, value } : d))
    const score = handScore([after[0]!, after[1]!, after[2]!, after[3]!, victimStolen])
    if (score < bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  return bestIndex
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
 * die, then reroll by heuristic, then spend a Mulinello's extra roll if it helps. Returns
 * the final 5-die hand. Used by the simulator.
 *
 * The Mulinello step lives here rather than only in the reducer because this function is the
 * simulator's whole model of a hand. Without it the balance harness would measure a Mulinello
 * that never fires and report it as worth nothing.
 *
 * DADO_BRUMEGGIO is the standing exception to that lesson, and knowingly so: this function
 * plays ONE seat, so it has no notion of two loadouts interacting, and a fog is by definition
 * something the other seat imposes. The balance harness will therefore report the Brumeggio at
 * roughly break-even — not a bug in the ability, a limit of a one-seat model. Measuring it
 * needs a two-seat harness, which is a separate change.
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
  return applyPaguro(applyMulinello(finalHand(own, stolen, reroll, rng), rng), rng)
}

/**
 * Spends a Mulinello's extra roll on its own die when the exact EV beats standing pat.
 *
 * Enumerated, not sampled: ONE die has only six outcomes, so averaging all six is both exact
 * and cheaper than any sample count worth trusting. It also consumes no Rng for the decision
 * itself — `expectedScore` draws per sample, which at 40k hands x 60 samples dominated the
 * whole simulation.
 *
 * `exactRerollEV` in optimal.ts computes the same quantity, but optimal.ts imports from THIS
 * file, so calling it here would close an import cycle. The bot has no such constraint and
 * uses it directly; both agree because the arithmetic is exact on either side.
 *
 * Only own dice are considered: a stolen Mulinello is reachable in a real match, but this
 * heuristic's stolen die is fixed throughout, matching chooseRerollIndices.
 */
function applyMulinello(hand: Hand, rng: Rng): Hand {
  const own: OwnDice = [hand[0], hand[1], hand[2], hand[3]]
  const index = own.findIndex((d) => d.ability === 'MULINELLO')
  if (index === -1) {
    return hand
  }
  const stolen = hand[4]

  let total = 0
  for (const face of [1, 2, 3, 4, 5, 6] as const) {
    const trial = own.map((die, i) => (i === index ? { ...die, value: face } : die))
    total += handScore([trial[0]!, trial[1]!, trial[2]!, trial[3]!, stolen])
  }
  if (total / 6 <= handScore(hand)) {
    return hand
  }

  const after = own.map((die, i) => (i === index ? rerollDie(rng, die) : die))
  return [after[0]!, after[1]!, after[2]!, after[3]!, stolen]
}

/**
 * Makes the Dado Paguro's blind pick for the simulator: keeps a uniformly-chosen one of its
 * three rolled faces.
 *
 * No EV to compute — the choice is blind, so every index is equally good and the kept value is
 * a plain d6 (E 3.500). This exists for FIDELITY, not balance: rollOwnDice already leaves the
 * die on a uniform placeholder face (keepFirst), so the measured strength is the same with or
 * without this step. It models the real PAGURO_SELECT so the harness plays the same hand the
 * reducer would, rather than silently standing on the placeholder.
 *
 * Own dice only, matching applyMulinello: the die is ownOnly, so it can never be the stolen one.
 */
function applyPaguro(hand: Hand, rng: Rng): Hand {
  const own: OwnDice = [hand[0], hand[1], hand[2], hand[3]]
  const index = own.findIndex((d) => d.ability === 'DADO_PAGURO')
  if (index === -1) {
    return hand
  }
  const die = own[index]!
  // A Paguro always carries its three rolled faces; fall back to its current value defensively.
  const faces = die.rolls ?? [die.value]
  const kept = faces[rng.nextInt(0, faces.length - 1)]!
  const after = own.map((d, i) => (i === index ? { ...d, value: kept } : d))
  return [after[0]!, after[1]!, after[2]!, after[3]!, hand[4]]
}
