// Pure reads over GameState: who holds what, what is still unclaimed on the table, and what a
// Dado Spugna has cancelled. Nothing here logs, rolls, or returns a new state.
//
// THE SPONGE DIRECTION, once, for everything below. `hasSponged(state, seat, ability)` asks one
// question about ONE seat: "did THIS seat cancel that ability?" Every caller must name the
// PROTECTED seat — the one holding the sponge — and never the seat whose effect is firing. An
// earlier draft folded the opponent lookup into the helper and got the direction silently
// backwards for table effects, protecting the wrong player. Keeping the helper direction-free
// forces each call site to state who is protected, out loud, where a reader can check it.

import { otherPlayer, type GameState, type PlayerId } from './gameTypes'
import type { RollModifiers } from './abilities'
import type { Loadout } from './strategy'
import type { AbilityId } from './types'

/**
 * Whether `seat` owns a die carrying `ability` — among its 4 own dice or as its stolen die.
 *
 * The stolen die counts: taking a special from the commons is the intended way to acquire
 * one, so an ability must work the same whether it was dealt or stolen.
 *
 * RAW ownership, ignoring any Dado Spugna. Most effects want `seatHoldsActive` instead; this
 * one is for the places that must answer "is the die physically there" regardless.
 */
export function seatHolds(state: GameState, seat: PlayerId, ability: AbilityId): boolean {
  const hand = state.hands[seat]
  return (hand.own ?? []).some((d) => d.ability === ability) || hand.stolen?.ability === ability
}

/**
 * Index of a common die carrying `ability` while it is still unclaimed, or null.
 *
 * Returns null once that die has been stolen: at that point it is a seat's die, not a table
 * effect, so any "applies to both" rule stops holding. Shared by the two abilities with a
 * table-wide form — NERO_DI_SEPPIA (blinds both) and DADO_D_ORO (doubles for whoever wins).
 *
 * Like seatHolds, this ignores Spugne — see `unclaimedCommonActiveFor`, which does not.
 */
export function unclaimedCommonIndex(state: GameState, ability: AbilityId): number | null {
  if (state.common === null) {
    return null
  }
  const index = state.common.findIndex((d) => d.ability === ability)
  if (index === -1 || state.stolenCommonIndices.includes(index)) {
    return null
  }
  return index
}

/**
 * Whether `seat` has soaked up `ability` with its own Dado Spugna. See the direction note at the
 * top of this file.
 *
 * `spongeTarget` is only ever set to a spongeable id, and only for a seat that really holds a
 * Spugna (handleReroll enforces both), so there is nothing left to re-derive here.
 */
export function hasSponged(state: GameState, seat: PlayerId, ability: AbilityId): boolean {
  return state.hands[seat].spongeTarget === ability
}

/**
 * Ownership AND not cancelled by the opponent — the form nearly every effect wants.
 *
 * `seat` is the ability's OWNER here, so the sponge to check is the other seat's: the victim is
 * the one with a reason to have cancelled it.
 *
 * Deliberately a separate function rather than folded into `seatHolds`: two call sites must NOT
 * nullify (the reroll-target validation and handleMulinello's legality guard, both marked at
 * their site), and a helper that silently nullified everywhere would break them.
 */
export function seatHoldsActive(state: GameState, seat: PlayerId, ability: AbilityId): boolean {
  return seatHolds(state, seat, ability) && !hasSponged(state, otherPlayer(seat), ability)
}

/**
 * Whether `seat`'s dice are rolling in fog — an OPPONENT holds an active Dado Brumeggio.
 *
 * TWO SOURCES, and they are not interchangeable. The FIRST roll of the hand happens inside
 * startHandAfterInitialBet, where the hands do not exist yet (`own` is null, nothing has been
 * stolen) — only the loadouts have been drawn, a few lines earlier. Every LATER roll (both
 * rerolls, and a Mulinello's third) happens with the hands fully formed, where seatHoldsActive
 * is the right question because it also counts a die stolen from the commons and it respects
 * a Spugna.
 *
 * Hence `loadouts` as an explicit parameter rather than a lookup on state: at first-roll time
 * `state.loadouts` is still the PREVIOUS hand's for a drops- or deck-mode seat, because
 * drawLoadouts returns the new ones and they are only written into the state afterwards.
 * Passing them in is what stops this reading a stale hand.
 *
 * An unowned common Brumeggio is NOT a source: "the opponent's rolls" means nothing for a die
 * still sitting at the centre. See the spec comment in abilities.ts for why that differs from
 * the Torpedo, which does stay live unowned.
 */
export function isFogged(
  state: GameState,
  seat: PlayerId,
  loadouts?: Readonly<Record<PlayerId, Loadout>>,
): boolean {
  const opponent = otherPlayer(seat)
  if (loadouts !== undefined) {
    // FIRST ROLL. No hands, no steals, and no Spugna yet — REROLL_SELECT is two phases away —
    // so scanning the opponent's loadout is the whole answer.
    return loadouts[opponent].includes('DADO_BRUMEGGIO')
  }
  // The owner goes in as `seat` and the protected one is the fogged seat — see the direction note.
  return seatHoldsActive(state, opponent, 'DADO_BRUMEGGIO')
}

/** The roll modifiers in force for `seat` right now. See isFogged for the two sources. */
export function modsFor(
  state: GameState,
  seat: PlayerId,
  loadouts?: Readonly<Record<PlayerId, Loadout>>,
): RollModifiers {
  return { fogged: isFogged(state, seat, loadouts) }
}

/**
 * Whether `seat` is rolling in fog. Exported to clients so the UI asks the reducer rather than
 * keeping its own copy of the rule (same reasoning as inPeekablePhase and maxBetFor).
 *
 * Only the post-first-roll source is exposed: from STEAL onwards the hands exist, which is
 * every phase the UI renders. The loadouts overload is an internal detail of one transition.
 */
export function seatIsFogged(state: GameState, seat: PlayerId): boolean {
  return isFogged(state, seat)
}

/**
 * `unclaimedCommonIndex`, unless `protectedSeat` has sponged that ability.
 *
 * Per-seat, because a table effect is now asymmetric: one seat may have soaked up the common
 * Torpedo while the other still eats it. The parameter is named for what it means — the seat
 * being spared — because "seat" alone is exactly the ambiguity that produced a reversed check.
 */
export function unclaimedCommonActiveFor(
  state: GameState,
  protectedSeat: PlayerId,
  ability: AbilityId,
): number | null {
  return hasSponged(state, protectedSeat, ability) ? null : unclaimedCommonIndex(state, ability)
}
