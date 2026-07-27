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
  } = props
  const clickable = onClick !== undefined
  const spec = abilitySpec(ability)
  // A concealed die shows neither pips nor split: its `value` is a placeholder, and the
  // split would spell out the very face being hidden.
  const split = !concealed && spec !== null && rolls !== undefined && rolls.length > 1 ? rolls : null
  const accent = concealed ? CONCEALED_ACCENT : accentForAbility(ability)

  const border = selected
    ? '3px solid #d97706'
    : concealed || spec !== null
      ? `3px solid ${accent}`
      : '2px solid #334155'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
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
            width: 52,
            height: 52,
            padding: 6,
            borderRadius: 10,
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
            <span style={{ fontSize: 24, fontWeight: 800, color: '#c4b5fd' }}>?</span>
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
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{caption}</span>
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
              width: 14,
              height: 14,
              borderRadius: 3,
              fontSize: 9,
              fontWeight: 700,
              lineHeight: '14px',
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
