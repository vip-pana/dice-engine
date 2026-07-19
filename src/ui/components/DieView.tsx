import type { JSX } from 'react'
import type { DieValue } from '../../engine'

// Placeholder die rendering: pips drawn with CSS, no assets. Standard d6 pip layout.

// Which of a 3x3 grid's 9 cells are filled for each face value.
const PIP_LAYOUT: Record<DieValue, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

export interface DieViewProps {
  readonly value: DieValue
  /** Whether the die is currently selected for reroll (shows a highlight). */
  readonly selected?: boolean | undefined
  /** Whether the die is clickable (reroll selection phase). */
  readonly onClick?: (() => void) | undefined
  /** Dim the die (e.g. a common die that was already stolen). */
  readonly dimmed?: boolean | undefined
  /** Small caption under the die (e.g. "rubato"). */
  readonly caption?: string | undefined
}

export function DieView(props: DieViewProps): JSX.Element {
  const { value, selected = false, onClick, dimmed = false, caption } = props
  const clickable = onClick !== undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={!clickable}
        aria-label={`Dado ${value}${selected ? ', selezionato' : ''}`}
        style={{
          width: 52,
          height: 52,
          padding: 6,
          borderRadius: 10,
          border: selected ? '3px solid #d97706' : '2px solid #334155',
          background: dimmed ? '#1e293b' : '#f8fafc',
          opacity: dimmed ? 0.4 : 1,
          cursor: clickable ? 'pointer' : 'default',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(3, 1fr)',
          gap: 2,
        }}
      >
        {Array.from({ length: 9 }, (_, cell) => {
          const on = PIP_LAYOUT[value].includes(cell)
          return (
            <span
              key={cell}
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                background: on ? '#0f172a' : 'transparent',
                justifySelf: 'center',
                alignSelf: 'center',
              }}
            />
          )
        })}
      </button>
      {caption !== undefined && (
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{caption}</span>
      )}
    </div>
  )
}
