import { useEffect, useRef, type JSX } from 'react'
import type { GameState } from '../../engine'
import { PrimaryButton, SecondaryButton } from '../components/Buttons'
import { heldActionableAbilities, usableAbilities } from '../handState'
import type { AbilityFocus } from './AbilityModal'

/**
 * The one way in: «Usa abilità».
 *
 * Lives HERE, under the felt, and not in Controls — that component replaces itself with "In
 * attesa del Bot…" whenever `toAct !== 'human'`, which is exactly the window the Dado Lanterna
 * exists for. That early return is why the Lanterna used to be exiled to the sidebar; putting
 * the trigger behind it again would recreate the problem. Not in the sidebar either: on a phone
 * that folds behind a `<details>`, and a primary action must not be one tap from invisible.
 */
export function AbilityBar({
  state,
  onOpen,
}: {
  state: GameState
  onOpen: (focus: AbilityFocus) => void
}): JSX.Element | null {
  const held = heldActionableAbilities(state)
  const usable = usableAbilities(held)

  // MULINELLO_SELECT and PAGURO_SELECT exist ONLY because a seat has that decision to make, so
  // opening the modal on arrival is not an interruption — it is the phase's content. The ref
  // stops a dismissal from immediately re-opening: one auto-open per hand per phase.
  const autoOpened = useRef<string | null>(null)
  useEffect(() => {
    const key = `${state.handNumber}:${state.phase}`
    if (autoOpened.current === key || state.toAct !== 'human') {
      return
    }
    if (state.phase === 'MULINELLO_SELECT') {
      autoOpened.current = key
      onOpen('MULINELLO')
    } else if (state.phase === 'PAGURO_SELECT') {
      autoOpened.current = key
      onOpen('DADO_PAGURO')
    }
  }, [state.phase, state.handNumber, state.toAct, onOpen])

  // No ability in hand at all: there is nothing a menu could even explain, and a permanently
  // dead button is chrome.
  if (held.length === 0) {
    return null
  }

  const row = { display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' as const }

  // Held but none usable yet: a muted button that STILL OPENS, plus the reason inline.
  //
  // Not disabled, deliberately. The explanations of why each ability is waiting live inside the
  // menu, so a disabled button would lock the player out of the very answer they want — they can
  // see a special die on the felt and have no way to ask what it is waiting for. Muted says
  // "nothing to press yet"; opening it says why.
  if (usable.length === 0) {
    return (
      <div style={row}>
        <SecondaryButton onClick={() => onOpen('list')}>Usa abilità</SecondaryButton>
        <span style={{ fontSize: 12, color: '#64748b' }}>{held[0]!.note}</span>
      </div>
    )
  }

  return (
    <div style={row}>
      <PrimaryButton onClick={() => onOpen(usable.length === 1 ? usable[0]!.id : 'list')}>
        Usa abilità
        {/* The count is of the USABLE ones, not the held ones: a "3" while only one thing can be
            pressed is the same confusion this menu exists to end. */}
        <span
          style={{
            marginLeft: 8,
            padding: '1px 7px',
            borderRadius: 999,
            background: '#0b122099',
            fontSize: 13,
          }}
        >
          {usable.length}
        </span>
      </PrimaryButton>
    </div>
  )
}
