import type { JSX } from 'react'
import { abilitySpec, type AbilityId, type DieValue } from '../../engine'

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
  /** Ability carried by this physical die, if any. Draws a badge and a gold frame. */
  readonly ability?: AbilityId | undefined
  /** The individual faces an ability produced, shown as mini-dice under the result. */
  readonly rolls?: readonly DieValue[] | undefined
  /**
   * The viewer is not allowed to know this die's face (hidden by a Nero di Seppia).
   * `value` is then a placeholder and must NOT be drawn — the die renders as "?".
   */
  readonly concealed?: boolean | undefined
  /**
   * The OPPONENT cannot see this die, but the viewer can — the mirror of `concealed`,
   * used on the opponent's row so a landed Nero di Seppia is visibly doing something.
   * The face is drawn normally; only a marker is added.
   */
  readonly blindedToOpponent?: boolean | undefined
  /**
   * Edge of the die in px. Defaults to 52 (the desktop size); phones pass 44 so a full row of
   * five fits without the page having to zoom out (see DIE_SIZE in responsive.ts).
   *
   * Only the die box scales — padding, corner radius and the concealed "?" derive from it. The
   * corner badges deliberately do NOT: they are anchored to the box's corner by fixed negative
   * offsets that are correct for the badge's own 18px size at any die size, so scaling them
   * would need the offsets and their line-heights changed in lockstep for no visual gain.
   */
  readonly size?: number | undefined
}

/** Ink-dark accent for a die whose face is hidden from the viewer. */
const CONCEALED_ACCENT = '#7c3aed'

/**
 * Accent per ability kind: gold for a buff, violet for a malus. A malus die must not read
 * as a reward at a glance, so the two never share a colour.
 */
export const ACCENT_BY_KIND = { buff: '#facc15', malus: '#a78bfa' } as const

/** Default accent for ability chrome that is not tied to one specific die. */
export const ABILITY_ACCENT = ACCENT_BY_KIND.buff

/**
 * Per-ability accent overrides, applied on top of the kind default.
 *
 * Only for abilities whose identity IS a colour — a "Dado d'Oro" that renders in the same
 * yellow as every other buff defeats its own name. Keep this table small: the kind default
 * is what makes buff-vs-malus readable at a glance, and every override erodes that signal.
 */
/** The Dado d'Oro's amber, deeper than the buff yellow so the two never read as one. */
export const GOLD_ACCENT = '#f59e0b'

const ACCENT_BY_ABILITY: Partial<Record<AbilityId, string>> = {
  DADO_D_ORO: GOLD_ACCENT,
}

/** The accent for a die carrying `ability`: its override if it has one, else its kind. */
export function accentForAbility(ability: AbilityId | null | undefined): string {
  const spec = abilitySpec(ability)
  if (spec === null) {
    return ABILITY_ACCENT
  }
  return ACCENT_BY_ABILITY[spec.id] ?? ACCENT_BY_KIND[spec.kind]
}

export function DieView(props: DieViewProps): JSX.Element {
  const {
    value,
    selected = false,
    onClick,
    dimmed = false,
    caption,
    ability,
    rolls,
    concealed = false,
    blindedToOpponent = false,
    size = 52,
  } = props
  // Derived from `size` so one number moves the whole die coherently. Ratios taken from the
  // original 52px die (6/52 padding, 10/52 radius, 24/52 glyph) so the default is unchanged.
  const padding = Math.max(4, Math.round(size * 0.115))
  const radius = Math.max(7, Math.round(size * 0.19))
  const concealedGlyph = Math.round(size * 0.46)
  const clickable = onClick !== undefined
  const spec = abilitySpec(ability)
  // A concealed die shows neither pips nor split: its `value` is a placeholder, and the
  // split would spell out the very face being hidden.
  //
  // Not gated on having an ability: a PLAIN die rolled in fog (an opponent's Dado Brumeggio)
  // carries two faces and no ability of its own, and showing "5 2" with the kept one lit is
  // the clearest way the fog reads as a rule. A clear plain die has no `rolls`, so it is
  // unaffected.
  const split = !concealed && rolls !== undefined && rolls.length > 1 ? rolls : null
  const accent = concealed ? CONCEALED_ACCENT : accentForAbility(ability)

  const border = selected
    ? '3px solid #d97706'
    : concealed || spec !== null
      ? `3px solid ${accent}`
      : '2px solid #334155'

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}
    >
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={onClick}
          disabled={!clickable}
          title={
            concealed
              ? 'Dado nascosto dal Nero di Seppia — lo vedrai allo showdown'
              : blindedToOpponent
                ? 'Il tuo Nero di Seppia acceca questo dado: il Bot non ne conosce il valore'
                : spec !== null
                  ? `${spec.name} — ${spec.description}`
                  : undefined
          }
          aria-label={
            (concealed ? 'Dado nascosto' : `Dado ${value}`) +
            (!concealed && spec !== null ? `, abilità ${spec.name}` : '') +
            (blindedToOpponent ? ', nascosto al Bot' : '') +
            (split !== null ? `, tirati ${split.join(' ')}` : '') +
            (selected ? ', selezionato' : '')
          }
          style={{
            width: size,
            height: size,
            // The die must never be squeezed by a crowded row: the pips are percentage-sized
            // cells of a square 3x3 grid, so a shrunken box renders every pip as an ellipse —
            // the die would visibly deform rather than just get small. Rows wrap instead.
            flexShrink: 0,
            padding,
            borderRadius: radius,
            border,
            background: concealed ? '#241b3d' : dimmed ? '#1e293b' : '#f8fafc',
            opacity: dimmed ? 0.4 : 1,
            cursor: clickable ? 'pointer' : 'default',
            display: concealed ? 'flex' : 'grid',
            alignItems: 'center',
            justifyContent: 'center',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gridTemplateRows: 'repeat(3, 1fr)',
            gap: 2,
            boxShadow: (concealed || spec !== null) && !dimmed ? `0 0 10px ${accent}55` : undefined,
          }}
        >
          {concealed && (
            <span style={{ fontSize: concealedGlyph, fontWeight: 800, color: '#c4b5fd' }}>?</span>
          )}
          {!concealed && Array.from({ length: 9 }, (_, cell) => {
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

        {spec !== null && (
          // The ability stays public even on a concealed die — you may know a hidden die
          // is a D4, just not its face. But it is drawn muted there, so "hidden" stays the
          // dominant reading and the badge is not mistaken for a live effect.
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: -7,
              right: -7,
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: concealed ? '#3b2f63' : accent,
              color: concealed ? '#a78bfa' : '#0f172a',
              fontSize: 11,
              fontWeight: 800,
              lineHeight: '18px',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            {spec.icon}
          </span>
        )}

        {blindedToOpponent && (
          // Ink smudge: the face stays readable to us, but the die is visibly marked as
          // one the opponent is blind to. Bottom-left, so it never collides with the
          // ability badge in the top-right.
          <span
            aria-hidden
            style={{
              position: 'absolute',
              bottom: -6,
              left: -6,
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: CONCEALED_ACCENT,
              color: '#ede9fe',
              fontSize: 10,
              lineHeight: '18px',
              textAlign: 'center',
              pointerEvents: 'none',
              boxShadow: `0 0 8px ${CONCEALED_ACCENT}aa`,
            }}
          >
            🦑
          </span>
        )}
      </div>

      {split !== null && <SplitRolls rolls={split} kept={value} accent={accent} />}

      {caption !== undefined && (
        // Capped and centred rather than free-flowing: a caption is the widest thing a die can
        // carry ("scegli al buio 🦀" runs ~90px against a 44px die), and since this column is a
        // flex item an uncapped caption stretches the die's cell and pushes the row over the
        // viewport. Wrapping to a second line costs a few px of height and nothing else.
        <span
          style={{
            fontSize: 11,
            color: '#94a3b8',
            maxWidth: size + 24,
            textAlign: 'center',
            lineHeight: 1.25,
          }}
        >
          {caption}
        </span>
      )}
    </div>
  )
}

/**
 * The faces an ability rolled, as tiny numbered chips. The kept face is highlighted, so a
 * Stella Essiccata visibly reads as "rolled 2/6/3, kept 6".
 *
 * When the ability rolls duplicates of the kept value, only the first is highlighted —
 * highlighting all of them would suggest more than one die was kept.
 */
function SplitRolls({
  rolls,
  kept,
  accent,
}: {
  rolls: readonly DieValue[]
  kept: DieValue
  accent: string
}): JSX.Element {
  const keptIndex = rolls.indexOf(kept)
  return (
    <div style={{ display: 'flex', gap: 3 }} aria-hidden>
      {rolls.map((face, i) => {
        const isKept = i === keptIndex
        return (
          <span
            key={i}
            style={{
              // 15/10 rather than 14/9: a 9px digit on a phone is at the edge of legibility, and
              // these chips are how the Stella's "rolled 2/6/3, kept 6" is read at all.
              width: 15,
              height: 15,
              borderRadius: 3,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: '15px',
              textAlign: 'center',
              background: isKept ? accent : '#334155',
              color: isKept ? '#0f172a' : '#94a3b8',
            }}
          >
            {face}
          </span>
        )
      })}
    </div>
  )
}
