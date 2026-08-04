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
 */
export function diceRowStyle(phone: boolean): CSSProperties {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
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

export function HandBadge({
  label,
  live = false,
  ownLine = false,
}: {
  label: string
  live?: boolean
  /**
   * Put the badge on its own line below the dice instead of at the end of their row.
   *
   * Used on phones. The badge's text is the longest thing in the row — "Mano incerta — un dado è
   * nascosto" runs ~250px — so beside the dice it either wraps into a tall blob or pushes the row
   * past the screen. A `flexBasis: 100%` item takes a full flex line, which is how it drops below
   * without either row needing a different structure.
   */
  ownLine?: boolean
}): JSX.Element {
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
  if (ownLine) {
    // The wrapper takes the line; the pill inside keeps hugging its text rather than stretching
    // into a full-width bar.
    return <div style={{ flexBasis: '100%', minWidth: 0 }}>{pill}</div>
  }
  return <span style={{ marginLeft: 8 }}>{pill}</span>
}
