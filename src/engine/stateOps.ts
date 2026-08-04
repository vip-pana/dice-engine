// The substrate every reducer step is built from: naming a player, appending a log line,
// moving chips, patching one seat's hand, and failing loudly. All pure — each returns a fresh
// GameState and never mutates its input.

import type { GameState, PlayerHandState, PlayerId } from './gameTypes'

/** The two seats, in a fixed order, for the many effects that touch both. */
export const BOTH_SEATS: readonly PlayerId[] = ['human', 'bot']

export function labelOf(p: PlayerId): string {
  return p === 'human' ? 'Tu' : 'Bot'
}

export function withLog(state: GameState, message: string): GameState {
  return { ...state, log: [...state.log, message] }
}

/** Moves `amount` from a player's bankroll into the pot, tracking their commitment. */
export function commit(state: GameState, player: PlayerId, amount: number): GameState {
  const hand = state.hands[player]
  return {
    ...state,
    bankroll: { ...state.bankroll, [player]: state.bankroll[player] - amount },
    pot: state.pot + amount,
    hands: {
      ...state.hands,
      [player]: { ...hand, committed: hand.committed + amount },
    },
  }
}

export function setHand(
  state: GameState,
  player: PlayerId,
  patch: Partial<PlayerHandState>,
): GameState {
  return {
    ...state,
    hands: { ...state.hands, [player]: { ...state.hands[player], ...patch } },
  }
}

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[game] ${message}`)
  }
}
