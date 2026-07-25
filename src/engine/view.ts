// Per-player VIEWS of the game state.
//
// The reducer keeps one true state, with every die's real value in it. That is the right
// shape for a rules engine, but it means any consumer could read a value its owner is not
// supposed to know — the Nero di Seppia hides a die from its owner, and a bot reading
// `state.hands.bot.own[i].value` directly would simply cheat.
//
// So knowledge is enforced HERE, at the boundary: `viewFor(state, seat)` returns the same
// GameState with anything `seat` may not see replaced by a placeholder. The UI renders a
// view; the bot decides on a view. Neither can peek, because neither is handed the truth.
//
// Design note: a view is a GameState, not a new type. That keeps every existing consumer
// (evaluateHand, chooseAction, the React components) working unchanged — they cannot tell
// a filtered state from a real one, which is exactly the point.

import type { Die } from './types'
import type { GameState, PlayerId, PlayerHandState } from './gameTypes'
import type { OwnDice } from './strategy'

/**
 * The face shown in place of a concealed die.
 *
 * A real DieValue is required by the type, so concealment cannot be represented as
 * "absent" without widening Die everywhere. 1 is deliberate: it is the WEAKEST face, so a
 * viewer that ignores `concealed` and reads the value anyway gets a pessimistic estimate
 * rather than a flattering one. Never let this leak into evaluation of the true hand.
 */
const HIDDEN_PLACEHOLDER_VALUE = 1

/** A die as seen by someone not allowed to know its value. */
function maskDie(die: Die): Die {
  return {
    value: HIDDEN_PLACEHOLDER_VALUE,
    // The ability is still public — you can SEE that a die is special, you just cannot
    // read its face. Dropping it would also hide that a die is, say, a D4.
    ability: die.ability,
    // `rolls` would spell out the hidden face, so it never survives masking.
    rolls: undefined,
    concealed: true,
  }
}

/** Masks the dice of `hand` that its owner may not see. */
function maskHand(hand: PlayerHandState): PlayerHandState {
  if (hand.own === null || hand.concealedIndices.length === 0) {
    return hand
  }
  const hidden = new Set(hand.concealedIndices)
  const own = hand.own.map((die, i) => (hidden.has(i) ? maskDie(die) : die)) as unknown as OwnDice
  return { ...hand, own }
}

/**
 * The state as `seat` is allowed to perceive it.
 *
 * Only that seat's OWN concealed dice are masked. The opponent's dice are open
 * information in this game and stay fully visible — including a die the opponent cannot
 * see themselves, which is precisely the advantage a Nero di Seppia buys.
 */
export function viewFor(state: GameState, seat: PlayerId): GameState {
  const hand = state.hands[seat]
  if (hand.own === null || hand.concealedIndices.length === 0) {
    return state
  }
  return { ...state, hands: { ...state.hands, [seat]: maskHand(hand) } }
}

/** True when `seat` cannot see own die `index` this hand. */
export function isConcealedFor(state: GameState, seat: PlayerId, index: number): boolean {
  return state.hands[seat].concealedIndices.includes(index)
}
