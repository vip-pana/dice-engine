import type { JSX } from 'react'
import type { GameState } from '../../../engine'
import { playerLabel } from '../../labels'
import { DieView } from '../../components/DieView'
import { Placeholder, useDieSize } from './shared'

export function RollOffView({ state }: { state: GameState }): JSX.Element | null {
  const dieSize = useDieSize()

  if (state.rollOff === null && state.phase !== 'ROLL_OFF') {
    return null
  }

  // Once the hand is under way the roll-off is only a memo of who won the right to
  // start, so it collapses to one line — the table below is what deserves the space.
  // The dice stay full-size only while the roll-off IS the current decision.
  const deciding = state.phase === 'ROLL_OFF'

  if (!deciding && state.rollOff !== null) {
    return (
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
        Tiro iniziale: {state.rollOff.human.value} — {state.rollOff.bot.value} · inizia{' '}
        <strong style={{ color: '#94a3b8' }}>{playerLabel(state.primary)}</strong>
      </p>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        // Centred like the three bands below it, so the roll-off does not sit off to one side of
        // the table it decides who starts.
        justifyContent: 'center',
        gap: 16,
        padding: '10px 14px',
        borderRadius: 10,
        background: '#0b1220',
        border: '1px solid #1e293b',
        marginBottom: 16,
      }}
    >
      <strong style={{ fontSize: 13 }}>Tiro per iniziare</strong>
      {state.rollOff === null ? (
        <Placeholder text="Premi «Tira il dado»" />
      ) : (
        <>
          <DieView value={state.rollOff.human.value} caption="tu" size={dieSize} />
          <span style={{ color: '#64748b' }}>vs</span>
          <DieView value={state.rollOff.bot.value} caption="bot" size={dieSize} />
        </>
      )}
    </div>
  )
}
