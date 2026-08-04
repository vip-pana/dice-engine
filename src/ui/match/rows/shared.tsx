import type { JSX, CSSProperties } from 'react'
import { DIE_SIZE, useIsPhone } from '../../responsive'

/**
 * Shared layout for the three dice rows (commons, bot, you).
 *
 * WRAPPING is the load-bearing part. A row is five dice plus a stolen die plus a hand badge, and
 * at the desktop die size that is over 500px of content — against ~295px inside the felt on a
 * phone. Without `flexWrap` the excess pushes the page wider than the screen, and a mobile
 * browser answers that by scaling the whole app down. The phone die size (DIE_SIZE.phone) is
 * chosen so a full row still fits on one line at 320px anyway.
 *
 * CENTRED, so the three bands read as one table rather than as three left-aligned lists: the
 * commons sit between the two hands competing for them, and that only looks like a table if all
 * three share a middle. A wrapped second line centres too, which is what keeps a six-item row
 * from looking like a ragged paragraph.
 */
export function diceRowStyle(phone: boolean): CSSProperties {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'center',
    columnGap: phone ? 8 : 12,
    rowGap: phone ? 10 : 12,
  }
}

/** The die edge for the current layout. */
export function useDieSize(): number {
  return useIsPhone() ? DIE_SIZE.phone : DIE_SIZE.default
}

export function Placeholder({ text }: { text: string }): JSX.Element {
  return <span style={{ color: '#64748b', fontSize: 13, fontStyle: 'italic' }}>{text}</span>
}

/**
 * The empty stolen-die slot, exactly one die wide.
 *
 * The width is what makes it a SLOT rather than a caption. As free-flowing text "dado rubato" is
 * ~74px against a 52px die, and in a centred row that 22px of excess shifts every die in the row
 * off the felt's middle — so the human row drifted from the two rows above it purely because its
 * steal had not landed yet. Pinned to the die edge, the row centres on five equal positions
 * whether or not the die has arrived, and nothing moves when it does.
 */
export function EmptyDieSlot({ text, size }: { text: string; size: number }): JSX.Element {
  return (
    <span
      style={{
        width: size,
        display: 'inline-block',
        textAlign: 'center',
        color: '#64748b',
        fontSize: 13,
        fontStyle: 'italic',
        lineHeight: 1.3,
      }}
    >
      {text}
    </span>
  )
}

/**
 * The hand category pill, on its own line below the dice.
 *
 * ALWAYS its own line, at every viewport size, and that is what keeps the three bands sharing one
 * spine. The badge is the longest thing in a row — "Mano incerta — un dado è nascosto" runs
 * ~250px — so as a member of a centred row it shoves the dice left of the felt's middle by half
 * its own width. Only the bot and human rows carry one, so the two seats drifted while the
 * commons stayed put, and the table stopped reading as a table. Dropping it below leaves the
 * dice, and only the dice, deciding where the row centres.
 */
export function HandBadge({ label, live = false }: { label: string; live?: boolean }): JSX.Element {
  const pill = (
    <span
      style={{
        // inline-BLOCK, not inline: an inline span that has to wrap is split into two boxes, so
        // the rounded background tore into two half-pills mid-sentence. As a block the text wraps
        // inside one pill. Visible on the longest label, "Mano incerta — un dado è nascosto".
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        background: live ? '#164e63' : '#3f3f46',
        color: '#e2e8f0',
      }}
    >
      {live ? 'Mano attuale: ' : ''}
      {label}
    </span>
  )
  // `flexBasis: 100%` takes a whole flex line; the pill inside keeps hugging its text rather than
  // stretching into a full-width bar, and `textAlign` is what centres it — the row's
  // `justifyContent` only places this full-width wrapper, not the pill within it.
  return <div style={{ flexBasis: '100%', minWidth: 0, textAlign: 'center' }}>{pill}</div>
}
