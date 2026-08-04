import type { JSX } from 'react'
import { abilitySpec, type AbilityId, type GameState } from '../../../engine'
import { AbilityCard } from '../../components/AbilityCard'
import type { HeldAbility, UseGameDispatch } from '../../handState'
import { AbilityControl } from './AbilityControl'

/**
 * One held ability in the modal: the card, plus its own control when it is the focused row.
 *
 * The card itself is INERT (no `onToggle`) — this row is not a toggle, it is a thing you open.
 * `AbilityCard` already renders "held but not now" exactly as needed: dimmed, with the note
 * appended after Bonus/Malus. So a blocked ability still appears, with the reason, rather than
 * silently vanishing from the list.
 */
export function AbilityRow({
  ability,
  state,
  dispatch,
  focused,
  onFocus,
  onClose,
  torpedoTarget,
  onAimTorpedo,
  spongeTarget,
  onSponge,
}: {
  ability: HeldAbility
  state: GameState
  dispatch: UseGameDispatch
  focused: boolean
  onFocus: () => void
  /** Closes the whole modal — used by the two abilities whose dispatch ends their phase. */
  onClose: () => void
  torpedoTarget: number | null
  onAimTorpedo: (index: number) => void
  spongeTarget: AbilityId | null
  onSponge: (ability: AbilityId | null) => void
}): JSX.Element {
  const spec = abilitySpec(ability.id)

  return (
    <div style={{ minWidth: 0 }}>
      {ability.actionable ? (
        <button
          type="button"
          onClick={onFocus}
          aria-expanded={focused}
          style={{
            display: 'block',
            width: '100%',
            padding: 0,
            border: 'none',
            background: 'transparent',
            font: 'inherit',
            cursor: 'pointer',
            // The whole card is the hit area, so it clears 44px on its own content.
            textAlign: 'left',
          }}
        >
          <AbilityCard id={ability.id} active />
        </button>
      ) : (
        <AbilityCard id={ability.id} active={false} inactiveNote={ability.note} />
      )}

      {ability.actionable && focused && (
        <div style={{ padding: '10px 10px 2px' }}>
          <AbilityControl
            ability={ability}
            state={state}
            dispatch={dispatch}
            onClose={onClose}
            torpedoTarget={torpedoTarget}
            onAimTorpedo={onAimTorpedo}
            spongeTarget={spongeTarget}
            onSponge={onSponge}
          />
        </div>
      )}

      {/* The affordance: a card that looks the same whether or not it does something needs to say
          which one it is. Only on the closed row — once open, the control speaks for itself. */}
      {ability.actionable && !focused && spec !== null && (
        <p style={{ margin: '2px 10px 0', fontSize: 11, color: '#64748b' }}>
          {spec.icon} Tocca la carta per usarla.
        </p>
      )}
    </div>
  )
}

