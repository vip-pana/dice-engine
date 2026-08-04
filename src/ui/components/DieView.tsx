import type { JSX } from 'react'
import { abilitySpec, type AbilityId, type AbilitySpec, type DieValue } from '../../engine'
import { useDieTooltip, type DieInfo } from './DieTooltip'

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
  /**
   * Whether the die explains itself on hover / long press. Defaults to true.
   *
   * Pass false for a die rendered INSIDE an overlay. The tooltip is a portal at zIndex 100 (see
   * DieTooltip), so from inside a dialog stacked above it the panel would open underneath the
   * dialog — a rules panel you cannot read. Callers that opt out are expected to carry the rules
   * text themselves; the ability modal does, at 13px, right above the dice.
   */
  readonly explain?: boolean | undefined
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
    explain = true,
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

  // Hover it, or hold it down on a phone, and the die says what it is. This replaced the `title`
  // attribute that used to carry the same text: a native tooltip is mouse-only (a phone never
  // shows one at all), it truncates, and it cannot be styled to look like it belongs to the die.
  // Called unconditionally — hook rules. `explain: false` gates what is USED, not the call: the
  // trigger handlers, the aria link and the panel are all dropped, so an opted-out die never
  // opens a panel it would render underneath its own dialog.
  const live = useDieTooltip(dieInfo({ spec, value, concealed, blindedToOpponent, split, accent }))
  const tip = explain
    ? live
    : { trigger: {}, panel: null, describedBy: undefined, consumeHold: () => false }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}
    >
      <div
        {...tip.trigger}
        style={{
          position: 'relative',
          // `manipulation` (not `none`) so the page still scrolls from a die: it only drops the
          // double-tap zoom, whose 300ms wait competes with the hold gesture.
          touchAction: 'manipulation',
          // A hold on selectable text is a "select word" gesture on both mobile platforms, and
          // the selection highlight would appear under our panel.
          userSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      >
        <button
          type="button"
          onClick={
            clickable
              ? () => {
                  // A hold that opened the panel still ends in a click. Stealing a die because
                  // the player asked what it does would be the worst possible reading of it.
                  if (tip.consumeHold()) {
                    return
                  }
                  onClick?.()
                }
              : undefined
          }
          disabled={!clickable}
          aria-describedby={tip.describedBy}
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
            // MOST dice on the table are not clickable, and a disabled button receives no
            // pointer events at all — nor do they bubble out of it — so the hover and the hold
            // would only work on the two or three dice that happen to be actionable. Letting
            // them through hands every event to the wrapper above, which is where the gesture
            // is handled. `disabled` stays: it is what tells a screen reader the die is inert.
            pointerEvents: clickable ? undefined : 'none',
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

        {tip.panel}
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

/** What a plain d6 says about itself when there is no ability to describe. */
const PLAIN_DIE = {
  name: 'Dado normale',
  description: 'Un dado a sei facce, senza abilità: vale la faccia che mostra.',
} as const

/**
 * Everything this die can tell the player, assembled for the tooltip.
 *
 * The rules text is the ability registry's own `description` — never a second wording of it
 * here — so a rebalanced ability explains itself correctly without a UI edit. What this adds is
 * the part that is not in the registry because it is about THIS die right now: whether it is a
 * bonus or a malus, that its face is hidden (or hidden from the Bot), and which faces the roll
 * actually produced.
 */
function dieInfo({
  spec,
  value,
  concealed,
  blindedToOpponent,
  split,
  accent,
}: {
  spec: AbilitySpec | null
  value: DieValue
  concealed: boolean
  blindedToOpponent: boolean
  split: readonly DieValue[] | null
  accent: string
}): DieInfo {
  const notes: string[] = []
  if (spec !== null) {
    notes.push(spec.kind === 'malus' ? 'Malus' : 'Bonus')
  }
  if (concealed) {
    notes.push('🦑 Nascosto dal Nero di Seppia del Bot: vedrai la faccia allo showdown.')
  }
  if (blindedToOpponent) {
    notes.push('🦑 Il tuo Nero di Seppia lo acceca: il Bot non ne conosce il valore.')
  }
  // Spells out the mini-chips under the die, which are otherwise a row of numbers you have to
  // guess the meaning of — and it is the only place the fog on a PLAIN die is ever explained,
  // since a fogged die carries two faces and no ability of its own to describe.
  if (split !== null && !concealed) {
    notes.push(`Tirati ${split.join(' · ')} — tenuto ${value}.`)
  }

  return {
    icon: concealed && spec === null ? '?' : spec?.icon,
    name: spec?.name ?? (concealed ? 'Dado nascosto' : PLAIN_DIE.name),
    description:
      spec?.description ??
      (concealed ? 'Un dado normale, ma non sai che faccia mostra.' : PLAIN_DIE.description),
    notes,
    accent,
  }
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
