// How dice and showdowns are worded for the action log. The log is written for the HUMAN, which
// is why handStr masks and the rest do not.

import { abilitySpec } from './abilities'
import { labelOf } from './stateOps'
import type { GameState, HandOutcome, PlayerId, ShowdownInfo } from './gameTypes'
import type { Die } from './types'

/** Formats a seat's own dice for the log, masking the ones that seat cannot see. */
export function handStr(state: GameState, seat: PlayerId): string {
  const hand = state.hands[seat]
  const own = hand.own
  if (own === null) {
    return '—'
  }
  const concealed = new Set(hand.concealedIndices)
  return own
    .map((die, i) => {
      if (concealed.has(i)) {
        return '?'
      }
      // A Paguro not yet picked is covered: printing its value/split would spoil the blind
      // choice in the log (this runs at "Dopo il rilancio", before PAGURO_SELECT).
      if (die.ability === 'DADO_PAGURO' && !hand.paguroChosen) {
        return `${abilitySpec(die.ability)?.icon}?`
      }
      return dieStr(die)
    })
    .join(', ')
}

/**
 * Formats a list of dice as their values, e.g. "3, 5, 5, 1".
 * A die with an ability shows what it rolled and what it kept, e.g. "☘6 (2/6/3)", so the
 * log makes the ability's effect visible rather than silent.
 */
export function diceStr(dice: readonly Die[]): string {
  return dice.map(dieStr).join(', ')
}

/** Formats one die, annotating an ability roll with its icon and the faces it produced. */
export function dieStr(die: Die): string {
  const spec = abilitySpec(die.ability)
  // Only a multi-face roll has a split worth spelling out; a single-face ability (the D4)
  // still gets its icon, so the log never hides which die produced the value.
  //
  // Gated on `rolls` alone rather than on having an ability: a PLAIN die rolled in fog has two
  // faces and no ability of its own, and printing "2 (5/2)" is the clearest way the fog reads
  // as a rule rather than as bad luck. A clear plain die still has no `rolls` at all, so it
  // stays the bare value it always was.
  const split = die.rolls !== undefined && die.rolls.length > 1 ? ` (${die.rolls.join('/')})` : ''
  if (spec === null) {
    return `${die.value}${split}`
  }
  return `${spec.icon}${die.value}${split}`
}

export function describeShowdown(
  human: ShowdownInfo['human'],
  bot: ShowdownInfo['bot'],
  outcome: HandOutcome,
): string {
  const h = human.values.join('')
  const b = bot.values.join('')
  if (outcome.kind === 'tie') {
    return `Showdown: Tu [${h}] vs Bot [${b}] — pareggio, si rigioca.`
  }
  return `Showdown: Tu [${h}] vs Bot [${b}] — vince ${labelOf(outcome.winner)}.`
}
