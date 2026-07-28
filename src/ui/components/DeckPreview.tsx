import type { JSX } from 'react'
import { abilitySpec, type Deck } from '../../engine'
import { accentForAbility } from './DieView'

/** Slots per row: DECK_SIZE laid out as two tidy rows of six. */
const DECK_COLUMNS = 6

/** Die box size, per variant. The sidebar has far less room than the builder. */
const SLOT_SIZE = { full: 52, compact: 32 } as const

export interface DeckPreviewProps {
  readonly deck: Deck
  /**
   * `full` for the builder (labelled dice), `compact` for the in-match sidebar, where the
   * names would not fit and the icons alone carry the meaning.
   */
  readonly variant?: 'full' | 'compact'
}

/**
 * A deck rendered as its twelve dice, so it reads as physical dice rather than a list of
 * names.
 *
 * A fixed 6x2 GRID rather than a wrapping flexbox: wrapping depends on available width, so
 * the last slot would orphan itself onto its own row (and the shape would change with the
 * window). An explicit column count keeps the deck one recognisable block at any width.
 *
 * A deck die has NO FACE yet — it has not been rolled — so no slot shows pips. Drawing a
 * value here would imply the deck is pre-rolled. (DieView's `concealed` mode would give a
 * "?" but labels it as hidden by a Nero di Seppia, which is a different thing entirely, so
 * these slots are rendered here instead.)
 */
export function DeckPreview({ deck, variant = 'full' }: DeckPreviewProps): JSX.Element {
  const size = SLOT_SIZE[variant]
  const gap = variant === 'full' ? 10 : 6

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${DECK_COLUMNS}, 1fr)`,
        gap,
        // Five dice plus gaps: keeps the grid from stretching the slots apart on a wide
        // screen while still shrinking on a narrow one.
        maxWidth: DECK_COLUMNS * size + (DECK_COLUMNS - 1) * gap,
      }}
    >
      {deck.map((id, i) => {
        const spec = abilitySpec(id)
        // Slot index is the identity: the same ability never appears twice, and plain slots
        // are interchangeable.
        return (
          <DeckSlot
            key={i}
            icon={spec?.icon}
            accent={spec === null ? null : accentForAbility(spec.id)}
            label={spec?.name ?? 'normale'}
            size={size}
            showLabel={variant === 'full'}
          />
        )
      })}
    </div>
  )
}

/** One unrolled die in the deck: its badge if special, an empty face either way. */
function DeckSlot({
  icon,
  accent,
  label,
  size,
  showLabel,
}: {
  icon: string | undefined
  accent: string | null
  label: string
  size: number
  showLabel: boolean
}): JSX.Element {
  return (
    // `alignSelf: start` so a two-line label (e.g. "Stella Essiccata") does not push its
    // grid row taller than the others and knock the two rows out of alignment.
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        alignSelf: 'start',
        gap: 4,
      }}
    >
      <div
        aria-label={`Dado ${label}`}
        // The name is the tooltip in compact mode, where it is not printed.
        title={showLabel ? undefined : label}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: size > 40 ? 10 : 7,
          border: accent === null ? '2px solid #334155' : `3px solid ${accent}`,
          background: '#111c31',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size > 40 ? 22 : 14,
          boxShadow: accent === null ? undefined : `0 0 10px ${accent}44`,
        }}
      >
        {icon ?? ''}
      </div>
      {showLabel && (
        <span
          style={{
            fontSize: 10,
            color: accent === null ? '#64748b' : '#94a3b8',
            maxWidth: 62,
            textAlign: 'center',
            lineHeight: 1.3,
          }}
        >
          {label}
        </span>
      )}
    </div>
  )
}
