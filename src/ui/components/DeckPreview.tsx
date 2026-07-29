import type { JSX } from 'react'
import { abilitySpec, type Deck } from '../../engine'
import { useIsPhone } from '../responsive'
import { accentForAbility } from './DieView'

/**
 * Slots per row: DECK_SIZE laid out as two tidy rows of six, or three rows of four on a phone.
 *
 * Six 52px slots plus their gaps come to 362px, which is wider than a small phone's viewport.
 * That is not a cosmetic overflow: content wider than the viewport makes a mobile browser widen
 * the layout viewport and scale the whole page down, so this one grid was zooming out the entire
 * app (window.innerWidth read 386 on a 320px device). Four columns keeps the block inside the
 * screen, and twelve still divides evenly so the deck stays one recognisable rectangle.
 */
const DECK_COLUMNS = { phone: 4, default: 6 } as const

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
  const phone = useIsPhone()
  const size = SLOT_SIZE[variant]
  const gap = variant === 'full' ? 10 : 6
  const columns = phone ? DECK_COLUMNS.phone : DECK_COLUMNS.default

  return (
    <div
      style={{
        display: 'grid',
        // `minmax(0, 1fr)`, not `1fr`. A bare `1fr` is `minmax(auto, 1fr)`, and the auto minimum
        // is the slot's intrinsic width — so with a fixed-width slot inside, the tracks could
        // not shrink at all and the grid overflowed its own container while `maxWidth` sat there
        // looking like it was handling the narrow case. The floor of 0 is what lets it shrink;
        // the slots below cap their own growth instead.
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap,
        // Keeps the grid from stretching the slots apart on a wide screen. Growth only — the
        // shrinking is the tracks' job, above.
        maxWidth: columns * size + (columns - 1) * gap,
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
          // Fills its track but never grows past its nominal size, and stays square via
          // aspect-ratio. The old `width: size` + `flexShrink: 0` made the slot an immovable
          // floor under the grid track, which is what pushed the grid wider than the screen.
          width: '100%',
          maxWidth: size,
          aspectRatio: '1 / 1',
          // Derived from `size` rather than switched on a magic `size > 40`, which any new
          // intermediate size would land on the wrong side of.
          borderRadius: Math.max(7, Math.round(size * 0.19)),
          border: accent === null ? '2px solid #334155' : `3px solid ${accent}`,
          background: '#111c31',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: Math.round(size * 0.42),
          boxShadow: accent === null ? undefined : `0 0 10px ${accent}44`,
        }}
      >
        {icon ?? ''}
      </div>
      {showLabel && (
        <span
          style={{
            fontSize: 11,
            color: accent === null ? '#64748b' : '#94a3b8',
            // The track, not a fixed 62px that overflowed a 52px column by 10px.
            maxWidth: '100%',
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
