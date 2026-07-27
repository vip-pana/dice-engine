import type { JSX } from 'react'
import { abilitySpec, type AbilityId } from '../../engine'
import { accentForAbility } from './DieView'

/**
 * One ability presented as a card: icon, name, rules text, Bonus/Malus.
 *
 * Shared by the read-only sidebar catalogue and the deck builder's picker, so an ability
 * looks the same wherever it appears. `onToggle` turns it into a button; without it the
 * card is inert.
 */
export interface AbilityCardProps {
  readonly id: AbilityId
  /** Whether the ability is in play (sidebar) or selected (builder). Dimmed when false. */
  readonly active: boolean
  /** Makes the card interactive. Omit for a read-only card. */
  readonly onToggle?: (() => void) | undefined
  /** Replaces the default "non in gioco" hint under the name. */
  readonly inactiveNote?: string | undefined
}

export function AbilityCard(props: AbilityCardProps): JSX.Element | null {
  const { id, active, onToggle, inactiveNote = 'non in gioco' } = props
  const spec = abilitySpec(id)
  if (spec === null) {
    return null
  }
  const accent = accentForAbility(spec.id)
  const clickable = onToggle !== undefined

  const body = (
    <>
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: accent,
          color: '#0f172a',
          fontSize: 15,
          fontWeight: 800,
          lineHeight: '26px',
          textAlign: 'center',
        }}
      >
        {spec.icon}
      </span>
      <div style={{ minWidth: 0, textAlign: 'left' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{spec.name}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.45 }}>{spec.description}</div>
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>
          {spec.kind === 'malus' ? 'Malus' : 'Bonus'}
          {active ? '' : ` — ${inactiveNote}`}
        </div>
      </div>
    </>
  )

  const style = {
    display: 'flex',
    gap: 10,
    padding: '9px 10px',
    borderRadius: 9,
    // Relies on the global border-box in index.html: with content-box this 100% plus the
    // padding and border would overflow the sidebar panel.
    width: '100%',
    // Long ability text must wrap inside the narrow sidebar rather than widen the card.
    minWidth: 0,
    background: '#111c31',
    border: `1px solid ${active ? `${accent}33` : '#1e293b'}`,
    opacity: active ? 1 : 0.45,
    cursor: clickable ? 'pointer' : 'default',
    // A selected card in the builder needs to read as chosen at a glance, not just as
    // slightly less faded than its neighbours.
    boxShadow: clickable && active ? `0 0 0 1px ${accent}66` : undefined,
  } as const

  if (!clickable) {
    return (
      <div style={style} title={active ? spec.description : `${spec.description} (${inactiveNote})`}>
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      title={spec.description}
      style={{ ...style, font: 'inherit', textAlign: 'left' }}
    >
      {body}
    </button>
  )
}
