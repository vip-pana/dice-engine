import type { JSX, ReactNode } from 'react'

/**
 * The reference column: side by side with the game on a wide screen, folded behind one tap on a
 * phone.
 *
 * Stacking the column under the game (which is what the single-column grid does) is right for a
 * tablet and wrong for a phone: the deck, the bot's deck and the ranking ladder come to well
 * over 2000px of material that the player has to scroll PAST to reach nothing, because the game
 * itself is already above it. Folded, the first screenful is the game and the reference is one
 * tap away.
 *
 * A native `<details>` rather than a useState toggle: it is a disclosure widget with keyboard
 * and screen-reader behaviour already correct, and the browser keeps the open/closed state
 * across re-renders without this component holding any.
 */
export function ReferenceStack({
  phone,
  children,
}: {
  phone: boolean
  children: ReactNode
}): JSX.Element {
  const stack = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        minWidth: 0,
        // Fill the column (the aside is a stretched grid item) rather than sizing to content.
        // Without this the panels inside cannot grow either — their `flex: 1` resolves against
        // a container that is already exactly as tall as they are — and the sidebar ends in dead
        // space below the last panel. The folded phone layout has no column height to fill, so
        // it opts out.
        ...(phone ? null : { flex: '1 1 auto', minHeight: 0 }),
      }}
    >
      {children}
    </div>
  )
  if (!phone) {
    return stack
  }
  return (
    <details style={{ background: '#111c31', border: '1px solid #1e293b', borderRadius: 12 }}>
      <summary
        style={{
          padding: '14px 16px',
          minHeight: 44,
          fontSize: 15,
          fontWeight: 700,
          color: '#e2e8f0',
          cursor: 'pointer',
          // The marker is kept (it is the affordance that this opens) but the row reads as a
          // button, so the label carries the weight rather than the triangle.
          listStyle: 'revert',
        }}
      >
        Mazzo e regole
      </summary>
      <div style={{ padding: '0 12px 12px' }}>{stack}</div>
    </details>
  )
}
