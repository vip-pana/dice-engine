// Deck of dice: the 10 dice a player brings to a match, and the 4 drawn from them each hand.
//
// Why a deck instead of per-hand random drops: drops (see rollRandomLoadout in strategy.ts)
// give the player no agency — they get whatever the Rng hands them. A deck is CHOSEN before
// the match and fixed for its duration, so the player knows exactly which special dice they
// might see and how often: HAND_SIZE / DECK_SIZE = 40% per special, per hand.
//
// The two systems coexist as explicit per-seat modes (see OwnDiceSource in gameTypes.ts);
// neither one shadows the other implicitly.

import { ALL_ABILITY_IDS, abilitySpec } from './abilities'
import type { AbilityId } from './types'
import type { Rng } from './rng'
import type { Loadout } from './strategy'

/** How many dice a deck holds. */
export const DECK_SIZE = 10

/** How many of those dice are drawn to form a hand. */
export const HAND_SIZE = 4

/**
 * A player's deck: `DECK_SIZE` dice, each either a special (an AbilityId) or a plain d6
 * (`null`).
 *
 * A flat array rather than a fixed-length tuple: the length invariant is not the
 * interesting one (the no-duplicate-specials rule is), and a 10-tuple would be unreadable
 * while letting DECK_SIZE drift out of sync with the type. Element type matches Loadout's,
 * so a drawn hand IS a Loadout and rollOwnDice needs no changes.
 *
 * Build one with `buildDeck` — it is the only constructor that guarantees the invariants.
 */
export type Deck = readonly (AbilityId | null)[]

/** A deck of ten plain dice — the base game, with no specials at all. */
export const PLAIN_DECK: Deck = Array.from({ length: DECK_SIZE }, () => null)

/**
 * The most specials a deck can hold: one of each registered ability.
 *
 * Derived from the registry, so registering a new ability raises this automatically.
 */
export const MAX_SPECIALS_PER_DECK = ALL_ABILITY_IDS.length

/**
 * Builds a deck from the specials it should contain, padding the rest with plain dice.
 *
 * THE only blessed constructor. It enforces both invariants by construction:
 *  - no duplicate specials (input is deduplicated);
 *  - exactly DECK_SIZE dice (padded with nulls).
 *
 * Specials are placed in registry order rather than caller order, so the same set of
 * abilities always yields the identical array. That keeps a deck — and therefore a
 * seeded match built on it — reproducible regardless of how the UI happened to order the
 * player's clicks.
 */
export function buildDeck(specials: readonly AbilityId[]): Deck {
  // Filtering the REGISTRY by the request (rather than the request by the registry) does
  // three things at once: deduplicates, imposes registry order, and drops any id that is
  // not a real ability — so an unknown id can never reach a built deck.
  const unique = ALL_ABILITY_IDS.filter((id) => specials.includes(id))
  if (unique.length > DECK_SIZE) {
    throw new Error(`[deck] ${unique.length} specials exceed the deck size of ${DECK_SIZE}`)
  }
  const plain = Array.from({ length: DECK_SIZE - unique.length }, () => null)
  return [...unique, ...plain]
}

/**
 * Lists everything wrong with a deck, or an empty array if it is valid.
 *
 * Returns problems instead of throwing so a UI can render them next to the offending
 * choice. The engine still asserts on entry (see assertValidDeck) — a UI is only a
 * suggestion, the reducer is what makes an illegal deck impossible.
 */
export function validateDeck(deck: Deck): readonly string[] {
  const problems: string[] = []

  if (deck.length !== DECK_SIZE) {
    problems.push(`un mazzo deve contenere ${DECK_SIZE} dadi, non ${deck.length}`)
  }

  const seen = new Set<AbilityId>()
  for (const id of deck) {
    if (id === null) {
      continue
    }
    // `abilitySpec` is typed against the AbilityId union, so it returns undefined (not
    // null) for an id outside it. Data crossing a boundary can be anything, so check both.
    const spec = abilitySpec(id)
    if (spec === null || spec === undefined) {
      problems.push(`abilità sconosciuta: ${id}`)
      continue
    }
    if (seen.has(id)) {
      problems.push(`${spec.name} è presente più di una volta`)
    }
    seen.add(id)
  }

  return problems
}

/** Throws if `deck` is invalid. Used at the engine boundary. */
export function assertValidDeck(deck: Deck, who: string): void {
  const problems = validateDeck(deck)
  if (problems.length > 0) {
    throw new Error(`[deck] invalid deck for ${who}: ${problems.join('; ')}`)
  }
}

/** The specials in a deck, in registry order. */
export function deckSpecials(deck: Deck): readonly AbilityId[] {
  return deck.filter((id): id is AbilityId => id !== null)
}

/** How many dice in the deck carry an ability. */
export function specialCount(deck: Deck): number {
  return deckSpecials(deck).length
}

/**
 * Draws HAND_SIZE dice from a deck of DECK_SIZE, uniformly and without replacement.
 *
 * Partial Fisher-Yates over a local copy: the input Deck is never mutated (everything in
 * this engine is readonly), and the shuffle is truncated after HAND_SIZE picks.
 *
 * Rng discipline: consumes EXACTLY HAND_SIZE nextInt calls, always, whatever the deck
 * contains. The same rule as drawAbilitySlots in strategy.ts — a draw count that varied
 * with the deck would shift every downstream roll and break seed reproducibility. (A
 * reservoir sample would also be fixed-count, but at DECK_SIZE draws for the same result.)
 *
 * Because the deck holds at most one die of each ability, a drawn hand can never contain
 * two dice of the same special. That player-visible rule is a consequence of the deck
 * invariant, not of anything here.
 */
export function drawHandFromDeck(rng: Rng, deck: Deck): Loadout {
  const bag = [...deck]
  for (let i = 0; i < HAND_SIZE; i++) {
    const j = rng.nextInt(i, bag.length - 1)
    const swap = bag[i]!
    bag[i] = bag[j]!
    bag[j] = swap
  }
  return [bag[0] ?? null, bag[1] ?? null, bag[2] ?? null, bag[3] ?? null]
}

/**
 * Generates the bot's deck, matching the human's special COUNT.
 *
 * Matching the count keeps the matchup even in the only dimension the engine can measure
 * without a per-ability power rating. Note the consequence, which is a deliberate design
 * call: a malus die (the D4) counts the same as a buff, so choosing one costs the human
 * twice — they take the penalty AND hand the bot another special that may be a buff. To
 * mirror buffs and maluses separately instead, filter `candidates` by
 * `abilitySpec(id)?.kind` and draw each group to its own count.
 *
 * Lives here rather than in createInitialState because that function is pure and takes no
 * Rng; callers roll the deck first and pass it in. Fixed draw count, so a seed reproduces
 * the bot's deck exactly.
 */
export function rollBotDeck(rng: Rng, humanDeck: Deck): Deck {
  // Clamp rather than throw: the builder UI prevents this, but the engine should not be
  // brittle if a caller asks for more specials than the registry can supply.
  const wanted = Math.min(specialCount(humanDeck), ALL_ABILITY_IDS.length)

  const candidates = [...ALL_ABILITY_IDS]
  for (let i = 0; i < wanted; i++) {
    const j = rng.nextInt(i, candidates.length - 1)
    const swap = candidates[i]!
    candidates[i] = candidates[j]!
    candidates[j] = swap
  }

  return buildDeck(candidates.slice(0, wanted))
}
