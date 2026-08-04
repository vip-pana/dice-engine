// What abilities DO to the dice and to the state: concealment, rerolls, the Paguro's shells, the
// Mulinello's third throw, the Torpedo's -1. The queries these read live in abilityQueries.ts.

import { rerollDie, type RollModifiers } from './abilities'
import {
  hasSponged,
  modsFor,
  seatHolds,
  unclaimedCommonIndex,
} from './abilityQueries'
import { otherPlayer, type GameState, type PlayerId } from './gameTypes'
import { handStr } from './logFormat'
import type { Rng } from './rng'
import { BOTH_SEATS, assert, labelOf, setHand, withLog } from './stateOps'
import type { OwnDice } from './strategy'
import type { AbilityId, Die, DieValue, Hand } from './types'

/**
 * Applies every Nero di Seppia on the table.
 *
 * Two sources, both handled here:
 *
 * - IN A SEAT'S OWN DICE: that seat conceals a single random die of the OPPONENT's four.
 *   Symmetric by construction — if both seats rolled one, both lose sight of a die.
 * - AMONG THE COMMON DICE: it belongs to nobody yet, so it blinds BOTH seats at once. Once
 *   a player steals it the malus narrows to the opponent only (see releaseCommonConcealment);
 *   if nobody steals it, both stay blind to the showdown.
 *
 * The choice of which die is uniform (per the design call) and drawn from the match Rng, so
 * it replays identically from a seed.
 */
export function applyConcealment(state: GameState, rng: Rng): GameState {
  let next = state
  for (const seat of BOTH_SEATS) {
    const own = state.hands[seat].own
    if (own === null || !own.some((d) => d.ability === 'NERO_DI_SEPPIA')) {
      continue
    }
    // The victim is the opponent: they lose sight of one of THEIR OWN dice.
    const victim = otherPlayer(seat)
    const hidden = rng.nextInt(0, 3)
    next = setHand(next, victim, { concealedIndices: [hidden] })
    next = withLog(
      next,
      `${labelOf(seat)} lancia il Nero di Seppia: un dado di ${labelOf(victim)} è nascosto fino allo showdown.`,
    )
  }

  // A common Nero di Seppia is unowned, so it hits both seats until someone claims it.
  if (unclaimedCommonIndex(next, 'NERO_DI_SEPPIA') !== null) {
    for (const seat of BOTH_SEATS) {
      // Never stack a second hidden die on a seat already blinded by an own-dice Seppia:
      // the ability conceals ONE die, and two would be a strictly harsher malus than the
      // owned version. The existing concealment already covers this seat.
      if (next.hands[seat].concealedIndices.length > 0) {
        continue
      }
      next = setHand(next, seat, { concealedIndices: [rng.nextInt(0, 3)] })
    }
    next = withLog(
      next,
      'Nero di Seppia tra i comuni: finché nessuno lo ruba, entrambi hanno un dado nascosto.',
    )
  }
  return next
}

/**
 * Narrows a common Nero di Seppia's malus to the opponent once `stealer` claims it.
 *
 * The stealer earned the die, so they get their sight back; the opponent keeps a die
 * hidden, which is exactly how an owned Nero di Seppia behaves. Call AFTER the steal has
 * been recorded in `stolenCommonIndices`.
 *
 * Only clears concealment the COMMON die caused: if the opponent also rolled their own
 * Seppia, the stealer is blinded by that too and stealing the common one must not undo it.
 */
export function releaseCommonConcealment(state: GameState, stealer: PlayerId): GameState {
  const blindedByOpponent = (state.hands[otherPlayer(stealer)].own ?? []).some(
    (d) => d.ability === 'NERO_DI_SEPPIA',
  )
  if (blindedByOpponent || state.hands[stealer].concealedIndices.length === 0) {
    return state
  }
  return withLog(
    setHand(state, stealer, { concealedIndices: [] }),
    `Nero di Seppia rubato da ${labelOf(stealer)}: ora il malus colpisce solo ${labelOf(otherPlayer(stealer))}.`,
  )
}

/**
 * Gives a sponging seat its sight back, when what it sponged was a Nero di Seppia.
 *
 * The one ability the Spugna REVERSES rather than prevents. applyConcealment runs on entry
 * into STEAL, long before a sponge target can be named, so by the time this fires the dice are
 * already hidden — there is nothing left to stop, only something to undo.
 *
 * Unlike releaseCommonConcealment, this clears the concealment whatever its source: the sponge
 * cancels the ABILITY, so it does not matter whether the blinding came from the opponent's own
 * die or from an unstolen common one.
 *
 * ORDER MATTERS, and unequally. REROLL_SELECT is sequential, so the primary sponges before
 * choosing its reroll and gets its sight back in time to use it; the non-primary sends both in
 * one action and the dice are thrown immediately after, so it recovers sight only for the
 * second bet. That is a real power difference attached to the primary role — documented rather
 * than levelled, since the roll-off already confers first-mover advantage everywhere else.
 */
export function restoreSightIfSponged(
  state: GameState,
  player: PlayerId,
  target: AbilityId,
): GameState {
  if (target !== 'NERO_DI_SEPPIA' || state.hands[player].concealedIndices.length === 0) {
    return state
  }
  return withLog(
    setHand(state, player, { concealedIndices: [] }),
    `Il Nero di Seppia è assorbito: ${labelOf(player)} rivede tutti i suoi dadi.`,
  )
}

/**
 * Rerolls the selected own dice. A rerolled die keeps its ability: the ability belongs to
 * the physical die the player owns, so a Stella Essiccata re-splits into 3 on every reroll.
 */
function applyReroll(
  own: OwnDice,
  selection: readonly number[],
  rng: Rng,
  mods: RollModifiers,
): OwnDice {
  const set = new Set(selection)
  const after = own.map((die, i) => (set.has(i) ? rerollDie(rng, die, mods) : die))
  return [after[0]!, after[1]!, after[2]!, after[3]!]
}

/** Throws each seat's chosen dice and persists the results into `own`. */
export function applyRerollSelections(state: GameState, rng: Rng): GameState {
  let next = state
  for (const seat of BOTH_SEATS) {
    const hand = next.hands[seat]
    assert(hand.own !== null, 'reroll resolved before the dice were rolled')
    // No `loadouts` argument here: the hands exist, so seatHoldsActive is the right source —
    // it counts a stolen Brumeggio and, crucially, it respects a Spugna.
    //
    // THE ORDERING THAT MAKES A SPONGED FOG LIFT: handleReroll writes spongeTarget onto the
    // state before it calls this, so a Spugna named this very phase is already visible to
    // seatHoldsActive by the time the dice are thrown. That is the whole mechanism — the fog
    // is derived per roll, never stored, so there is nothing to clear. Move the sponge write
    // after this call and the lift silently stops working.
    const own = applyReroll(hand.own, hand.rerollSelection ?? [], rng, modsFor(next, seat))
    next = setHand(next, seat, { own })
  }
  // Printed even when nothing was rerolled: the line is the record of what the betting was
  // resolved into — the first time anyone, player or bot, sees these values.
  return withLog(
    next,
    `Dopo il rilancio — Tu: ${handStr(next, 'human')}. Bot: ${handStr(next, 'bot')}.`,
  )
}

/**
 * The three faces a Dado Paguro offers to pick from, folding in any fog.
 *
 * Clear: exactly the three rolled faces. FOGGED: an opponent's Brumeggio makes the Paguro roll
 * its ability twice, so rollDieWithAbility leaves six faces as [firstThree, secondThree] (see
 * its fog path), and each shell is the LOWER of its pair — the same "roll twice, keep the worse"
 * the fog applies to every other ability, here one shell at a time. Either way the player still
 * picks ONE of THREE covered shells, which is what keeps the UI and the bot (both index 0..2)
 * uniform whether or not the fog is on.
 *
 * Knows the fog's 3+3 layout, like the Stella fog test does; that coupling is the price of
 * composing a blind player choice with a roll-time modifier, and it lives here with the rest of
 * the Paguro's effect rather than leaking into abilities.ts.
 */
export function paguroShells(rolls: readonly DieValue[]): readonly DieValue[] {
  if (rolls.length === 6) {
    return [
      Math.min(rolls[0]!, rolls[3]!) as DieValue,
      Math.min(rolls[1]!, rolls[4]!) as DieValue,
      Math.min(rolls[2]!, rolls[5]!) as DieValue,
    ]
  }
  return rolls
}

/**
 * Rolls this seat's Mulinello die once more, wherever it sits.
 *
 * The stolen die is fixed everywhere else in the engine (applyReroll and withZappedOwn both
 * touch own dice only), but `seatHolds` counts a stolen Mulinello as held — so acquiring one
 * from the commons has to work, and the extra roll has to land on that die rather than on an
 * arbitrary own one. Own dice are checked first; a seat holding two Mulinelli spends the own
 * one first, which is arbitrary but has to be *some* fixed order to stay reproducible.
 */
export function rerollMulinelloDie(state: GameState, player: PlayerId, rng: Rng): GameState {
  const hand = state.hands[player]
  assert(hand.own !== null, 'Mulinello used before the dice were rolled')

  // Fogged if an opponent's Brumeggio is still active — so a seat that sponged it back in
  // REROLL_SELECT gets a CLEAR third roll here. That is the most visible payoff of the
  // sponge-as-reversal semantics, and the one players will notice.
  const mods = modsFor(state, player)

  const ownIndex = hand.own.findIndex((die) => die.ability === 'MULINELLO')
  if (ownIndex !== -1) {
    const before = hand.own[ownIndex]!
    const after = rerollDie(rng, before, mods)
    const own = [...hand.own]
    own[ownIndex] = after
    const next = setHand(state, player, {
      own: [own[0]!, own[1]!, own[2]!, own[3]!],
    })
    return withLog(
      next,
      `Mulinello di ${labelOf(player)}: il dado ${ownIndex + 1} passa da ${before.value} a ${after.value}.`,
    )
  }

  assert(hand.stolen?.ability === 'MULINELLO', 'Mulinello holder has no Mulinello die')
  const before = hand.stolen
  const after = rerollDie(rng, before, mods)
  return withLog(
    setHand(state, player, { stolen: after }),
    `Mulinello di ${labelOf(player)}: il dado rubato passa da ${before.value} a ${after.value}.`,
  )
}

/** Chance that a Torpedo electrifies the whole field, zapping its own owner too. */
const TORPEDO_FIELD_CHANCE = 0.1

/** A die with 1 subtracted, floored at 1. */
function zapDie(die: Die): Die {
  // Floored by hand: DieValue is a compile-time union only, every producer casts with `as`,
  // and nothing downstream clamps. A 0 would reach evaluateHand and break handScore, whose
  // base-7 encoding documents "die values are 1..6".
  const value = (die.value > 1 ? die.value - 1 : 1) as DieValue
  return { ...die, value }
}

/** Replaces one own-die (index 0..3) of a 5-die hand, leaving the stolen die untouched. */
function withZappedOwn(hand: Hand, index: number): Hand {
  const zapped = zapDie(hand[index]!)
  const next = [hand[0], hand[1], hand[2], hand[3], hand[4]]
  next[index] = zapped
  return [next[0]!, next[1]!, next[2]!, next[3]!, next[4]!]
}

/**
 * Applies every Dado Torpedo in play to the two FINAL hands.
 *
 * Runs at the showdown, after the rerolls, which is what makes the -1 unavoidable — see the
 * ability's note in types.ts. Works on the local hands rather than on state because at this
 * point the final hands exist only as locals; goToShowdown persists them right after.
 *
 * Two sources, mirroring NERO_DI_SEPPIA:
 *  - HELD by a seat: that seat CHOSE the victim die during REROLL_SELECT (torpedoTarget),
 *    and a 10% "electrified field" costs the owner a random die of their own too.
 *  - UNSTOLEN among the commons: it belongs to nobody, so there is nobody to choose. Each
 *    seat loses a random die.
 *
 * FIXED DRAWS, the one invariant to preserve when touching this: per Torpedo the SAME draws are
 * consumed whatever the outcome — the field roll, then the owner's own target index even when
 * the field does not trigger, and a sponged Torpedo is drawn for and then discarded. A draw
 * count that varied with the outcome would shift the downstream stream and break seeded replay
 * (same rule as drawAbilitySlots in strategy.ts). Hence every early `continue` sits either
 * ABOVE all draws (no Torpedo at all) or BELOW them (sponged).
 */
export function applyTorpedoes(
  hands: { human: Hand; bot: Hand },
  state: GameState,
  rng: Rng,
): { hands: { human: Hand; bot: Hand }; logs: readonly string[] } {
  let next = { ...hands }
  const logs: string[] = []

  for (const seat of BOTH_SEATS) {
    // seatHolds, not seatHoldsActive: a seat with no Torpedo consumes nothing.
    if (!seatHolds(state, seat, 'DADO_TORPEDO')) {
      continue
    }
    const victim = otherPlayer(seat)
    const target = state.hands[seat].torpedoTarget
    const electrifies = rng.next() < TORPEDO_FIELD_CHANCE
    const selfIndex = rng.nextInt(0, 3)

    // The VICTIM is the one who may have sponged it — they are the seat being spared.
    if (hasSponged(state, victim, 'DADO_TORPEDO')) {
      logs.push(
        `Dado Spugna di ${labelOf(victim)}: il Dado Torpedo di ${labelOf(seat)} è assorbito.`,
      )
      continue
    }

    if (target !== null) {
      const before = next[victim][target]!.value
      next = { ...next, [victim]: withZappedOwn(next[victim], target) }
      logs.push(
        `Dado Torpedo di ${labelOf(seat)}: il dado ${target + 1} di ${labelOf(victim)} scende da ${before} a ${next[victim][target]!.value}.`,
      )
    }
    if (electrifies) {
      const before = next[seat][selfIndex]!.value
      next = { ...next, [seat]: withZappedOwn(next[seat], selfIndex) }
      logs.push(
        `Campo elettrizzato! Anche il dado ${selfIndex + 1} di ${labelOf(seat)} scende da ${before} a ${next[seat][selfIndex]!.value}.`,
      )
    }
  }

  // An unclaimed common Torpedo has no owner, so nobody chose: a random die each. A Spugna
  // makes this asymmetric — one seat may have soaked it up while the other still eats it —
  // so the nullify check is INSIDE the loop and, again, AFTER that seat's draw.
  if (unclaimedCommonIndex(state, 'DADO_TORPEDO') !== null) {
    for (const seat of BOTH_SEATS) {
      const index = rng.nextInt(0, 3)
      // No owner to blame, so the seat about to be hit is also the seat that may have sponged.
      if (hasSponged(state, seat, 'DADO_TORPEDO')) {
        logs.push(
          `Dado Spugna di ${labelOf(seat)}: il Dado Torpedo tra i comuni non lo colpisce.`,
        )
        continue
      }
      const before = next[seat][index]!.value
      next = { ...next, [seat]: withZappedOwn(next[seat], index) }
      logs.push(
        `Dado Torpedo tra i comuni: il dado ${index + 1} di ${labelOf(seat)} scende da ${before} a ${next[seat][index]!.value}.`,
      )
    }
  }

  return { hands: next, logs }
}
