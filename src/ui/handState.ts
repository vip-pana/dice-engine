import {
  ALL_ABILITY_IDS,
  isSpongeable,
  type AbilityId,
  type GameState,
  type Hand,
  type PlayerHandState,
} from '../engine'
import type { useGame } from './useGame'

/** The dispatch every component that can act on the match receives. */
export type UseGameDispatch = ReturnType<typeof useGame>['dispatch']

/** Whether the human holds `ability`, among their own dice or as their stolen die. */
export function humanHolds(state: GameState, ability: AbilityId): boolean {
  const hand = state.hands.human
  return (hand.own ?? []).some((d) => d.ability === ability) || hand.stolen?.ability === ability
}

/**
 * Mirrors the reducer's `seatHolds`, which is the authority: this only decides whether to
 * OFFER the aiming UI. The engine asserts the rule regardless of what the UI does.
 */
export function humanHoldsTorpedo(state: GameState): boolean {
  return humanHolds(state, 'DADO_TORPEDO')
}

/**
 * The spongeable abilities actually threatening the human right now — the only ones worth
 * offering as Spugna targets.
 *
 * Empty when the human holds no Spugna, so the picker disappears rather than presenting a
 * choice with no effect. That also covers the "unstolen among the commons" case, where the
 * engine ignores the target anyway.
 *
 * An ability threatens us if the Bot holds it OR it sits unstolen among the commons, since
 * several table effects hit both seats. Presentation only: the reducer decides what a sponge
 * actually does, and rejects a non-spongeable target regardless of what this offers.
 */
export function spongeableThreats(state: GameState): readonly AbilityId[] {
  if (!humanHolds(state, 'DADO_SPUGNA')) {
    return []
  }
  const bot = state.hands.bot
  return ALL_ABILITY_IDS.filter((id) => {
    // isSpongeable, not a local list: what a sponge can absorb is a RULE, and the engine owns
    // it. A copy here would drift the moment an ability's spec changes.
    if (id === 'DADO_SPUGNA' || !isSpongeable(id)) {
      return false
    }
    const botHolds = (bot.own ?? []).some((d) => d.ability === id) || bot.stolen?.ability === id
    const onTable = (state.common ?? []).some(
      (d, i) => d.ability === id && !state.stolenCommonIndices.includes(i),
    )
    return botHolds || onTable
  })
}

/** A seat's provisional 5-die hand (own4 + stolen), or null while it is still incomplete. */
export function liveFinalHand(hand: PlayerHandState): Hand | null {
  if (hand.own === null || hand.stolen === null) return null
  return [hand.own[0], hand.own[1], hand.own[2], hand.own[3], hand.stolen]
}
