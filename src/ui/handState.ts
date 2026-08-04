import {
  ALL_ABILITY_IDS,
  inPeekablePhase,
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

/**
 * The abilities a player DOES something with. The other five resolve on their own.
 *
 * Stella, D4, Nero di Seppia, Dado d'Oro and Brumeggio are applied by the reducer with no input,
 * so an ability menu could only explain them — and the die already explains itself on hover (see
 * DieTooltip). Listing them beside five that DO something would be the "too many things at once"
 * confusion restated.
 */
export type ActionableAbilityId =
  | 'DADO_TORPEDO'
  | 'DADO_SPUGNA'
  | 'MULINELLO'
  | 'DADO_PAGURO'
  | 'DADO_LANTERNA'

/** Why a held ability cannot be used right now. */
export type AbilityBlock =
  /** Already spent this hand. */
  | 'spent'
  /** Its moment has not arrived, or has passed. */
  | 'wrong-phase'
  /** Right phase, but the Bot is acting in it. */
  | 'not-your-turn'
  /** Held and in phase, but there is nothing for it to act on. */
  | 'no-target'

export interface HeldAbility {
  readonly id: ActionableAbilityId
  /** Whether a control may be offered for it right now. */
  readonly actionable: boolean
  /** null if and only if `actionable`. */
  readonly block: AbilityBlock | null
  /** Sentence for the card's `inactiveNote`. Empty when actionable. */
  readonly note: string
}

const ACTIONABLE_IDS: readonly ActionableAbilityId[] = [
  'DADO_TORPEDO',
  'DADO_SPUGNA',
  'MULINELLO',
  'DADO_PAGURO',
  'DADO_LANTERNA',
]

/**
 * Every actionable ability the human holds, each tagged with whether it can be used right now
 * and why not.
 *
 * Held-but-not-now entries are RETURNED, not filtered out: a menu that silently omits the die
 * you are looking at on the felt reads as a bug, and the note is what turns "nothing happens"
 * into "not yet".
 *
 * TWO THINGS THAT LOOK WRONG AND ARE NOT:
 *
 * - The Lanterna does NOT check `toAct`. The reducer deliberately does not gate it (see
 *   LanternPeekAction in actions.ts, and the test pinning it): STEAL, REROLL_SELECT and
 *   MULINELLO_SELECT are all sequential, so a player must be able to peek while waiting. It is
 *   the only ability usable while the Bot is thinking.
 * - Mulinello and Paguro read `state.phase` directly, and that is NOT a copy of an engine rule.
 *   MULINELLO_SELECT and PAGURO_SELECT are entered ONLY when a seat can act in them (see
 *   afterRerollResolved / enterPaguroSelectOrShowdown in game.ts), so being in one IS the engine
 *   saying the ability is live — `canUseMulinello` is private precisely because the phase already
 *   carries its answer. The Lanterna, whose legality spans five phases, asks the exported
 *   `inPeekablePhase` instead; never a phase list written here.
 *
 * Presentation only. Everything marked actionable is still validated by the reducer.
 */
export function heldActionableAbilities(state: GameState): readonly HeldAbility[] {
  return ACTIONABLE_IDS.filter((id) => humanHolds(state, id)).map((id) => describe(state, id))
}

/** The subset a player can act on right now — what the trigger button counts. */
export function usableAbilities(held: readonly HeldAbility[]): readonly HeldAbility[] {
  return held.filter((a) => a.actionable)
}

const NOTES: Record<AbilityBlock, string> = {
  spent: 'Hai già usato questa abilità in questa mano.',
  'wrong-phase': 'Non è il momento di usarla.',
  'not-your-turn': 'Tocca al Bot: aspetta il tuo turno.',
  'no-target': 'Non c’è nulla su cui usarla in questa mano.',
}

function describe(state: GameState, id: ActionableAbilityId): HeldAbility {
  const block = blockFor(state, id)
  if (block === null) {
    return { id, actionable: true, block: null, note: '' }
  }
  return { id, actionable: false, block, note: noteFor(id, block) }
}

function blockFor(state: GameState, id: ActionableAbilityId): AbilityBlock | null {
  const hand = state.hands.human
  switch (id) {
    case 'DADO_TORPEDO':
      return inRerollWindow(state)
    case 'DADO_SPUGNA': {
      const window = inRerollWindow(state)
      if (window !== null) {
        return window
      }
      // A Spugna with nothing to absorb is held-but-useless, and saying so beats an empty picker.
      return spongeableThreats(state).length === 0 ? 'no-target' : null
    }
    case 'MULINELLO':
      if (hand.mulinelloUsed) return 'spent'
      return phaseTurn(state, 'MULINELLO_SELECT')
    case 'DADO_PAGURO':
      if (hand.paguroChosen) return 'spent'
      return phaseTurn(state, 'PAGURO_SELECT')
    case 'DADO_LANTERNA':
      if (hand.lanternaUsed) return 'spent'
      // A drops- or pinned-mode opponent has no deck to look at; the reducer rejects the peek.
      if (state.decks.bot === null) return 'no-target'
      // No `toAct` check — see the doc comment above.
      return inPeekablePhase(state) ? null : 'wrong-phase'
  }
}

/** The window where the two REROLL-borne abilities are staged. */
function inRerollWindow(state: GameState): AbilityBlock | null {
  return phaseTurn(state, 'REROLL_SELECT')
}

function phaseTurn(state: GameState, phase: GameState['phase']): AbilityBlock | null {
  if (state.phase !== phase) return 'wrong-phase'
  return state.toAct === 'human' ? null : 'not-your-turn'
}

/** The generic note, unless the ability has wording of its own worth keeping. */
function noteFor(id: ActionableAbilityId, block: AbilityBlock): string {
  if (id === 'DADO_LANTERNA') {
    // Kept verbatim from the old sidebar panel: these two lines say what the Lanterna is.
    if (block === 'spent') return 'Hai già sbirciato in questa mano.'
    if (block === 'wrong-phase') return 'Potrai sbirciare appena i dadi sono in tavola.'
  }
  return NOTES[block]
}
