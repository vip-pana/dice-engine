import { useEffect, useRef, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useIsPhone, usePrefersReducedMotion } from '../responsive'

/**
 * The whole match history, in a drawer that slides in from the right.
 *
 * What stays on screen is the NEWEST line only (see LastMove), because "what did the bot just
 * do?" is the one part of the log that is about the moment you are in. The rest is something you
 * consult and leave, which does not earn standing real estate next to the felt.
 *
 * Portalled to the body for the same reason DieTooltip is: the felt and the sidebar panels are
 * both `overflow: auto`, so a fixed panel rendered inside the tree gets clipped by an ancestor
 * exactly when it needs to escape one.
 *
 * Returns null when closed, so it costs no nodes and no listeners while it is not in use.
 */
export function LogDrawer({
  log,
  open,
  onClose,
}: {
  log: readonly string[]
  open: boolean
  onClose: () => void
}): JSX.Element | null {
  const phone = useIsPhone()
  const reducedMotion = usePrefersReducedMotion()
  const boxRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Opens already scrolled to the newest line. The log only grows, so the bottom is where the
  // interesting end is — and this is why the drawer does not need a "jump to latest".
  useEffect(() => {
    if (!open) {
      return
    }
    const box = boxRef.current
    if (box !== null) {
      box.scrollTop = box.scrollHeight
    }
  }, [open, log])

  // Focus lands on the close button, so a keyboard user has somewhere to be inside the dialog
  // rather than still standing on the page behind it.
  useEffect(() => {
    if (open) {
      closeRef.current?.focus()
    }
  }, [open])

  // Escape closes, the one dismissal a keyboard user has. Registered only while open — same
  // shape as DieTooltip's, which documents why this listener is worth its cost.
  useEffect(() => {
    if (!open) {
      return
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) {
    return null
  }

  return createPortal(
    <>
      {/* The scrim. A click here closes: an element, not a document-wide pointerdown listener,
          which is the simplification a modal gets over DieTooltip's latched panel. */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: '#020617cc',
          // Above DieTooltip's 100: a die's rules panel must not float over the drawer.
          zIndex: 200,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Registro della partita"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          // Full width on a phone, where 380px of a 390px viewport would leave a useless
          // 10px sliver of game behind it.
          width: phone ? '100%' : 380,
          maxWidth: '100%',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          background: '#0b1220',
          borderLeft: '1px solid #1e293b',
          boxShadow: '-16px 0 40px #020617aa',
          // Slides in from its own edge. Skipped entirely when the reader asked for less
          // motion — a panel flying across the screen is precisely what that setting means.
          animation: reducedMotion ? undefined : 'drawerIn 180ms ease-out',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 16px',
            borderBottom: '1px solid #1e293b',
            flexShrink: 0,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
            📜 Registro
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Chiudi il registro"
            style={{
              minWidth: 44,
              minHeight: 44,
              borderRadius: 8,
              border: '1px solid #334155',
              background: 'transparent',
              color: '#94a3b8',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </header>

        <div
          ref={boxRef}
          style={{
            // Fills the drawer and scrolls inside it. A fixed panel has its own bounded height,
            // so the list simply gets all of it — no height cap needed.
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '12px 16px 16px',
            // 13, not 12: this is running prose, and it is the only record of what the bot did.
            fontSize: 13,
            lineHeight: 1.6,
            // Long lines must wrap inside the drawer rather than widen it.
            overflowWrap: 'anywhere',
          }}
        >
          {log.length === 0 ? (
            <p style={{ margin: 0, color: '#64748b' }}>Ancora nessuna mossa.</p>
          ) : (
            log.map((line, i) => (
              <div
                key={i}
                style={{
                  color: i === log.length - 1 ? '#e2e8f0' : '#64748b',
                  fontWeight: i === log.length - 1 ? 600 : 400,
                  paddingBottom: 3,
                }}
              >
                {line}
              </div>
            ))
          )}
        </div>
      </aside>
    </>,
    document.body,
  )
}
