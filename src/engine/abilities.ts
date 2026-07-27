// Die abilities (roguelike upgrades).
//
// Design: ONE table (ABILITIES) holds everything about every ability — its label, its
// rolling behaviour, and how many raw faces it consumes. Adding the Nth ability means
// adding one entry here; no other engine file needs a new branch.
//
// Constraint on THIS FILE: an AbilitySpec may only decide *what face a single die shows
// when rolled*. Nothing here touches hand evaluation, betting or phase order, which keeps
// hand.ts oblivious to the roguelike layer entirely.
//
// Two abilities need more than a face, so their spec below is a plain-d6 stub and the real
// effect lives in the reducer, where the state it acts on exists:
//   - NERO_DI_SEPPIA moves INFORMATION -> applyConcealment in game.ts
//   - DADO_D_ORO moves COINS           -> hasGoldenPayout in game.ts
// Both are named here so the pattern is discoverable from the registry. A new ability that
// only decides a face still needs nothing but an entry in this table.

import type { AbilityId, Die, DieValue } from './types'
import type { Rng } from './rng'

/** Static, presentation-and-balance metadata plus the roll behaviour of an ability. */
export interface AbilitySpec {
  readonly id: AbilityId
  /** Short Italian name shown on the die. */
  readonly name: string
  /** One-line rules text for tooltips/UI. */
  readonly description: string
  /** Single glyph badge drawn on the die face in the UI. */
  readonly icon: string
  /**
   * Whether the ability helps or hurts the die that carries it. Drives the UI accent, so
   * a malus never reads as a buff at a glance. Kept here rather than in the UI so a new
   * ability declares its own colour along with its rules.
   */
  readonly kind: 'buff' | 'malus'
  /**
   * When true this ability may only sit on a player's OWN dice, never on a shared common
   * die. Needed by effects defined in terms of "the opponent": a common die has no owner
   * yet when it is rolled, so there is nobody to target.
   */
  readonly ownOnly?: boolean
  /**
   * How many raw d6 faces this ability consumes per roll. Used by the UI (to size the
   * split animation) and by simulations reasoning about entropy consumption.
   */
  readonly diceRolled: number
  /**
   * Rolls this ability, returning the faces produced (most relevant first is NOT assumed;
   * `resolve` decides the kept value). Pure apart from the injected Rng.
   */
  readonly roll: (rng: Rng) => readonly DieValue[]
  /** Picks the final face from the rolled faces. */
  readonly resolve: (rolls: readonly DieValue[]) => DieValue
}

/** Rolls `n` raw faces. */
function rollFaces(rng: Rng, n: number): readonly DieValue[] {
  const faces: DieValue[] = []
  for (let i = 0; i < n; i++) {
    faces.push(rng.rollDie())
  }
  return faces
}

/** Highest of the rolled faces. */
function keepHighest(rolls: readonly DieValue[]): DieValue {
  return rolls.reduce<DieValue>((best, v) => (v > best ? v : best), 1)
}

/**
 * The ability registry. Every ability the game knows about lives here.
 *
 * Expected value note (for balance work): Stella Essiccata's max-of-3 on a d6 has
 * E[value] = 4.958 vs 3.5 for a plain die, and P(6) = 42%. That is a big buff —
 * measure it with the Monte Carlo sim before raising its drop rate.
 */
export const ABILITIES: Readonly<Record<AbilityId, AbilitySpec>> = {
  STELLA_ESSICCATA: {
    id: 'STELLA_ESSICCATA',
    name: 'Stella Essiccata',
    description: 'Quando viene lanciato si divide in 3 dadi e tiene il valore più alto.',
    icon: '✵',
    kind: 'buff',
    diceRolled: 3,
    roll: (rng) => rollFaces(rng, 3),
    resolve: keepHighest,
  },
  D4: {
    id: 'D4',
    name: 'D4',
    description: 'Dado a 4 facce: esce sempre un valore da 1 a 4.',
    icon: '▲',
    kind: 'malus',
    // One physical die, one face — but drawn from a 4-sided range instead of a d6.
    diceRolled: 1,
    // E[value] = 2.5 vs 3.5 for a plain d6, and it can never show a 5 or a 6. A malus
    // die: it caps the hand's top end, so it hurts high-card and pairs-of-sixes hands
    // most. Measure it with the Monte Carlo sim before tuning its drop rate.
    roll: (rng) => [rng.nextInt(1, 4) as DieValue],
    resolve: (rolls) => rolls[0]!,
  },
  NERO_DI_SEPPIA: {
    id: 'NERO_DI_SEPPIA',
    name: 'Nero di Seppia',
    description:
      "Nasconde un dado dell'avversario fino allo showdown. Tra i dadi comuni acceca entrambi finché qualcuno non lo ruba.",
    icon: '🦑',
    kind: 'buff',
    // Not ownOnly: an unclaimed common Seppia belongs to nobody, so it blinds BOTH seats,
    // and narrows to the opponent alone once a player steals it (see applyConcealment and
    // releaseCommonConcealment in game.ts). That gives the "no owner" case a real target.
    // Value-wise a plain d6 — the die itself is ordinary. Its power is informational and
    // is applied by the reducer when the hand is dealt (see applyConcealment in game.ts),
    // because AbilitySpec is only allowed to decide faces.
    diceRolled: 1,
    roll: (rng) => [rng.rollDie()],
    resolve: (rolls) => rolls[0]!,
  },
  DADO_D_ORO: {
    id: 'DADO_D_ORO',
    name: "Dado d'Oro",
    description:
      'Se vinci la mano incassi il doppio del piatto. Se resta tra i dadi comuni vale per entrambi.',
    icon: '🪙',
    kind: 'buff',
    // Not ownOnly: an unstolen common Dado d'Oro doubles for WHOEVER wins, so it has a real
    // effect with no owner and must not be filtered out of the commons.
    // Value-wise a plain d6 — it never helps you win the hand, only what winning pays. The
    // payout is applied by the reducer at resolveHand time (see hasGoldenPayout in game.ts),
    // because AbilitySpec is only allowed to decide faces.
    diceRolled: 1,
    roll: (rng) => [rng.rollDie()],
    resolve: (rolls) => rolls[0]!,
  },
}

/** Looks up an ability spec, or null for a plain die. */
export function abilitySpec(ability: AbilityId | null | undefined): AbilitySpec | null {
  return ability == null ? null : ABILITIES[ability]
}

/**
 * Rolls a single die, applying its ability if it has one.
 *
 * This is THE roll entry point for any die that belongs to a player: it keeps the
 * ability attached to the resulting Die (so a later reroll re-applies it) and records
 * the individual faces in `rolls` for the UI to display the split.
 *
 * A plain die (no ability) records no `rolls` — it stays a bare `{ value }`, so nothing
 * downstream sees a behavioural change from this module existing.
 */
export function rollDieWithAbility(rng: Rng, ability?: AbilityId | undefined): Die {
  const spec = abilitySpec(ability)
  if (spec === null) {
    return { value: rng.rollDie() }
  }
  const rolls = spec.roll(rng)
  return { value: spec.resolve(rolls), ability: spec.id, rolls }
}

/**
 * Rerolls a die in place, preserving its ability.
 * Used by the reroll step, where the physical die (and thus its ability) is kept.
 */
export function rerollDie(rng: Rng, die: Die): Die {
  return rollDieWithAbility(rng, die.ability)
}

/** All ability ids, in registry order. Handy for UI pickers and simulations. */
export const ALL_ABILITY_IDS: readonly AbilityId[] = Object.keys(ABILITIES) as AbilityId[]
