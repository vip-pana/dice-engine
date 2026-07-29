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
import { otherPlayer, type GameState, type PlayerId, type PlayerHandState } from './gameTypes'
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

/** True for an own die that is a Dado Paguro whose blind pick has not been made yet. */
function isPendingPaguro(hand: PlayerHandState, die: Die): boolean {
  return die.ability === 'DADO_PAGURO' && !hand.paguroChosen
}

/**
 * Masks the dice `hand`'s OWNER may not see: those hidden by an opponent's Nero di Seppia AND
 * any Dado Paguro still awaiting its blind pick. Returns the hand unchanged when nothing hides.
 */
function maskOwnHand(hand: PlayerHandState): PlayerHandState {
  if (hand.own === null) {
    return hand
  }
  const hidden = new Set(hand.concealedIndices)
  if (hidden.size === 0 && !hand.own.some((die) => isPendingPaguro(hand, die))) {
    return hand
  }
  const own = hand.own.map((die, i) =>
    hidden.has(i) || isPendingPaguro(hand, die) ? maskDie(die) : die,
  ) as unknown as OwnDice
  return { ...hand, own }
}

/**
 * Masks only what is unknown to EVERYONE in `hand`: a Dado Paguro whose face has not been
 * chosen yet. Used for the OPPONENT's hand, whose values are otherwise open information — a
 * pending Paguro is not "hidden from its owner", it is genuinely undecided, so nobody sees it.
 */
function maskPendingPaguro(hand: PlayerHandState): PlayerHandState {
  if (hand.own === null || !hand.own.some((die) => isPendingPaguro(hand, die))) {
    return hand
  }
  const own = hand.own.map((die) =>
    isPendingPaguro(hand, die) ? maskDie(die) : die,
  ) as unknown as OwnDice
  return { ...hand, own }
}

/**
 * The state as `seat` is allowed to perceive it.
 *
 * Two kinds of masking, deliberately asymmetric:
 *  - The seat's OWN concealed dice (a Nero di Seppia) are hidden from it. The opponent's dice
 *    are open information and stay fully visible — including a die the opponent cannot see
 *    themselves, which is precisely the advantage a Nero di Seppia buys.
 *  - A Dado Paguro awaiting its blind pick is covered on EITHER seat's dice: its face is not
 *    decided yet, so it is unknown to everyone, not merely hidden from its owner. Masking the
 *    seat's own pending Paguro is the whole point of "al buio"; masking the opponent's keeps
 *    the covered die honest on the human's screen too.
 */
export function viewFor(state: GameState, seat: PlayerId): GameState {
  const other = otherPlayer(seat)
  const ownMasked = maskOwnHand(state.hands[seat])
  const otherMasked = maskPendingPaguro(state.hands[other])
  if (ownMasked === state.hands[seat] && otherMasked === state.hands[other]) {
    return state
  }
  return {
    ...state,
    hands: { ...state.hands, [seat]: ownMasked, [other]: otherMasked },
  }
}

/** True when `seat` cannot see own die `index` this hand. */
export function isConcealedFor(state: GameState, seat: PlayerId, index: number): boolean {
  return state.hands[seat].concealedIndices.includes(index)
}
