import type { JSX } from 'react'
import type { GameState } from '../../engine'
import { useIsPhone } from '../responsive'

export function ScoreBar({ state }: { state: GameState }): JSX.Element {
  const phone = useIsPhone()
  return (
    <section
      style={{
        // A grid, not a `space-between` flex row. Five stats whose labels total ~270px of text
        // cannot share a 300px phone row: they used to survive only by breaking every label onto
        // two or three lines and leaving the values on a ragged baseline. auto-fit reflows them
        // into as many rows as the width needs, with no breakpoint.
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(74px, 1fr))',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 10,
        background: '#1e293b',
        marginBottom: 16,
      }}
    >
      <Stat label="Mano" value={`${state.handNumber}`} />
      {/* "(Bo3)" is 30px of label that wraps onto a second line in a phone-width track, which
          drops this stat's value below its neighbours' and makes the whole strip look broken.
          The match format is stated on the setup screen; the live number does not need it. */}
      <Stat
        label={phone ? 'Punteggio' : 'Punteggio (Bo3)'}
        value={`${state.score.human} - ${state.score.bot}`}
      />
      <Stat label="Tu (monete)" value={`${state.bankroll.human}`} />
      <Stat label="Bot (monete)" value={`${state.bankroll.bot}`} />
      <Stat label="Piatto" value={`${state.pot}`} highlight />
    </section>
  )
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}): JSX.Element {
  return (
    <div style={{ textAlign: 'center', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: highlight ? '#fbbf24' : '#e2e8f0' }}>
        {value}
      </div>
    </div>
  )
}
