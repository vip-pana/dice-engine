import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * The panel that a die shows about itself: hover it with a mouse, or hold it down on a
 * touchscreen.
 *
 * This is the game's PRIMARY way of learning what a die does. It replaced a catalogue of every
 * ability in the sidebar, which had the rules text but not the die — you read "Stella
 * Essiccata: tira 3 dadi e tiene il più alto" in one column and then had to match 🌟 to it by
 * eye in another. Putting the same sentence on the die you are already looking at removes that
 * matching step entirely, which is the whole point.
 *
 * Two gestures, one panel:
 *   - mouse: pointerenter opens, pointerleave closes. A plain tooltip.
 *   - touch/pen: a HOLD of HOLD_MS opens it and it STAYS open until dismissed. Showing it only
 *     while the finger is down would be useless — the finger is on top of the die, and letting
 *     go is what you do to read. So a hold latches it, and the next tap anywhere (or Escape, or
 *     a scroll) puts it away.
 *
 * A hold on a die that is also clickable (a common die during the steal, one of yours during
 * the reroll selection) must NOT also act on the die: `consumeHold` is how the caller drops
 * the click that a long press produces.
 */

/** How long a touch must stay down before the panel latches open. */
const HOLD_MS = 400

/**
 * How far the finger may drift during those milliseconds. Past this the gesture is a scroll,
 * not a hold, and the pending panel is cancelled — otherwise flicking the page from a die
 * would pop a panel on the way past.
 */
const MOVE_TOLERANCE_PX = 12

/** Gap between the die and the panel, and the panel's minimum clearance from the viewport edge. */
const OFFSET_PX = 10
const VIEWPORT_MARGIN_PX = 8

/** Panel width. Fixed (not a max) so measuring its height before paint gives the real height. */
const PANEL_WIDTH_PX = 280

/** What a die has to say about itself. */
export interface DieInfo {
  /** The ability's badge glyph, when it carries one. */
  readonly icon?: string | undefined
  /** The die's name — an ability's name, or "Dado normale". */
  readonly name: string
  /** The rules text: one or two sentences, straight from the ability registry. */
  readonly description: string
  /**
   * Short qualifiers under the rules text: Bonus/Malus, the faces this roll produced, a note
   * that the face is hidden. Each is one line, in the order given.
   */
  readonly notes?: readonly string[] | undefined
  /** The die's accent colour, so the panel reads as belonging to the die it came from. */
  readonly accent: string
}

/** Props to spread on the element that the panel points at. */
export interface DieTooltipTrigger {
  readonly ref: (el: HTMLElement | null) => void
  readonly onPointerEnter: (e: ReactPointerEvent) => void
  readonly onPointerLeave: (e: ReactPointerEvent) => void
  readonly onPointerDown: (e: ReactPointerEvent) => void
  readonly onPointerMove: (e: ReactPointerEvent) => void
  readonly onPointerUp: (e: ReactPointerEvent) => void
  readonly onPointerCancel: () => void
  readonly onContextMenu: (e: { preventDefault: () => void }) => void
  readonly onFocus: (e: ReactFocusEvent) => void
  readonly onBlur: () => void
}

export interface DieTooltipHandle {
  /** Spread onto the die's box: `<div {...tip.trigger}>`. */
  readonly trigger: DieTooltipTrigger
  /** The panel itself. Render it anywhere in the tree — it portals to the body. */
  readonly panel: JSX.Element | null
  /** The panel's id while it is open, for `aria-describedby`. Undefined when closed. */
  readonly describedBy: string | undefined
  /**
   * Whether the click now being handled is the tail of a hold that opened the panel, in which
   * case the die must not act on it. Call it FIRST in the die's own onClick, and return early
   * when it is true. Clears the flag.
   */
  readonly consumeHold: () => boolean
}

export function useDieTooltip(info: DieInfo): DieTooltipHandle {
  const id = useId()
  const anchorEl = useRef<HTMLElement | null>(null)
  const holdTimer = useRef<number | null>(null)
  const holdOrigin = useRef<{ readonly x: number; readonly y: number } | null>(null)
  /** Set when a hold opened the panel; read (and cleared) by the click that follows. */
  const heldOpen = useRef(false)

  /**
   * The die's box at the moment the panel opened, in viewport coordinates. Non-null means open.
   *
   * A snapshot rather than a live measurement: the panel is `position: fixed` in a portal, so
   * it is placed against the viewport once and any movement of the die invalidates it — which
   * is why scroll and resize close it rather than trying to follow.
   */
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  /** Opened by a hold, so it survives the finger lifting and needs an explicit dismissal. */
  const [latched, setLatched] = useState(false)

  const open = useCallback((persistent: boolean): void => {
    const el = anchorEl.current
    if (el === null) {
      return
    }
    setAnchor(el.getBoundingClientRect())
    setLatched(persistent)
  }, [])

  const close = useCallback((): void => {
    setAnchor(null)
    setLatched(false)
  }, [])

  const cancelHold = useCallback((): void => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    holdOrigin.current = null
  }, [])

  // Anything that moves the die under the panel closes it: the anchor rect is a snapshot, so a
  // panel that stayed would be pointing at empty felt. Escape closes it too, which is the one
  // dismissal a keyboard user has.
  useEffect(() => {
    if (anchor === null) {
      return
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        close()
      }
    }
    // Capture on scroll: the page is not the only scroller (the felt scrolls on a narrow
    // screen, the sidebar panels scroll on a short one), and scroll events from those do not
    // reach the window on the bubble phase.
    window.addEventListener('scroll', close, { capture: true, passive: true })
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', close, { capture: true })
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [anchor, close])

  // A latched panel outlives the gesture that opened it, so the next press anywhere else puts
  // it away. Registered only while latched — a hover panel closes on pointerleave and must not
  // pay for a document-wide listener.
  useEffect(() => {
    if (!latched) {
      return
    }
    const onDown = (e: Event): void => {
      const target = e.target
      // A press on the die itself is handled by the die's own pointerup (a tap toggles the
      // panel shut, a second hold keeps it open), not here.
      if (target instanceof Node && anchorEl.current?.contains(target) === true) {
        return
      }
      close()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [latched, close])

  // A die can unmount mid-hold — the hand is rerolled, the phase advances — and a timer that
  // fires afterwards would call setState on a dead component.
  useEffect(() => cancelHold, [cancelHold])

  const trigger: DieTooltipTrigger = {
    ref: (el) => {
      anchorEl.current = el
    },
    onPointerEnter: (e) => {
      if (e.pointerType !== 'mouse') {
        return
      }
      open(false)
    },
    onPointerLeave: (e) => {
      cancelHold()
      // Touch fires pointerleave on release, which is exactly when a latched panel must stay.
      if (e.pointerType === 'mouse') {
        close()
      }
    },
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse') {
        return
      }
      cancelHold()
      heldOpen.current = false
      holdOrigin.current = { x: e.clientX, y: e.clientY }
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null
        heldOpen.current = true
        open(true)
      }, HOLD_MS)
    },
    onPointerMove: (e) => {
      const origin = holdOrigin.current
      if (origin === null) {
        return
      }
      if (
        Math.abs(e.clientX - origin.x) > MOVE_TOLERANCE_PX ||
        Math.abs(e.clientY - origin.y) > MOVE_TOLERANCE_PX
      ) {
        cancelHold()
      }
    },
    onPointerUp: (e) => {
      const wasHold = heldOpen.current
      cancelHold()
      // A short tap on a die whose panel is open is the obvious way to dismiss it, and it works
      // on the non-clickable dice too — most of the table, where there is no click to piggyback.
      if (e.pointerType !== 'mouse' && !wasHold && latched) {
        close()
      }
    },
    onPointerCancel: cancelHold,
    // Android pops a text-selection menu on a long press and desktop pops the context menu on
    // right-click; both land on top of the panel we are opening. There is nothing on a die to
    // select or to copy, so neither menu is a loss.
    onContextMenu: (e) => e.preventDefault(),
    onFocus: (e) => {
      // Keyboard focus only. A tap on a clickable die focuses it too, and opening the panel
      // there would fire on every steal and every reroll pick.
      const el = e.target
      if (el instanceof Element && el.matches(':focus-visible')) {
        open(false)
      }
    },
    onBlur: close,
  }

  return {
    trigger,
    panel: anchor === null ? null : <DieTooltipPanel id={id} anchor={anchor} info={info} />,
    describedBy: anchor === null ? undefined : id,
    consumeHold: () => {
      const held = heldOpen.current
      heldOpen.current = false
      return held
    },
  }
}

/**
 * The panel, portalled to the body and positioned against the viewport.
 *
 * A portal rather than an absolutely-positioned child of the die, and that is forced rather
 * than chosen: the felt and both sidebar panels are `overflow: auto`, so any panel rendered
 * inside the tree would be clipped by an ancestor exactly when it needs to escape one.
 */
function DieTooltipPanel({
  id,
  anchor,
  info,
}: {
  id: string
  anchor: DOMRect
  info: DieInfo
}): JSX.Element {
  const panelEl = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<{ readonly left: number; readonly top: number } | null>(
    null,
  )

  // Measured, not estimated: the rules texts run from one line to four, so the height needed to
  // decide "above or below" is not knowable in advance. In a layout effect the measurement and
  // the correction both land before paint, so the first frame the user sees is already placed —
  // hence `visibility: hidden` until then rather than a visible jump.
  useLayoutEffect(() => {
    const el = panelEl.current
    if (el === null) {
      return
    }
    const { width, height } = el.getBoundingClientRect()
    const fitsAbove = anchor.top - height - OFFSET_PX >= VIEWPORT_MARGIN_PX
    const top = fitsAbove
      ? anchor.top - height - OFFSET_PX
      : // Below, but never off the bottom edge: on a short screen a panel for a die in the
        // last row would otherwise be half off-screen with no way to scroll to it.
        Math.max(
          VIEWPORT_MARGIN_PX,
          Math.min(anchor.bottom + OFFSET_PX, window.innerHeight - height - VIEWPORT_MARGIN_PX),
        )
    const centred = anchor.left + anchor.width / 2 - width / 2
    const maxLeft = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - width - VIEWPORT_MARGIN_PX)
    setPlacement({ left: Math.max(VIEWPORT_MARGIN_PX, Math.min(centred, maxLeft)), top })
  }, [anchor])

  const style: CSSProperties = {
    position: 'fixed',
    left: placement?.left ?? 0,
    top: placement?.top ?? 0,
    visibility: placement === null ? 'hidden' : 'visible',
    // Narrower than PANEL_WIDTH_PX on a small phone, where 280 plus two margins overflows.
    width: Math.min(PANEL_WIDTH_PX, window.innerWidth - 2 * VIEWPORT_MARGIN_PX),
    padding: '10px 12px',
    borderRadius: 10,
    background: '#111c31',
    border: `1px solid ${info.accent}66`,
    // Stated, not inherited: the portal puts this panel under <body>, outside the screen root
    // that carries the app's font — so without this one line the whole panel renders in the
    // browser's default serif.
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 8px 24px rgba(2, 6, 23, 0.6)',
    // Above the felt, the sidebar and the sticky controls. Nothing else in the app stacks.
    zIndex: 100,
    // The panel is a label, not a surface: it must never swallow the tap that dismisses it,
    // nor the click on a die it happens to overlap.
    pointerEvents: 'none',
    display: 'flex',
    gap: 9,
    alignItems: 'flex-start',
    textAlign: 'left',
  }

  return createPortal(
    <div id={id} role="tooltip" style={style} ref={panelEl}>
      {info.icon !== undefined && (
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: info.accent,
            color: '#0f172a',
            fontSize: 14,
            fontWeight: 800,
            lineHeight: '24px',
            textAlign: 'center',
          }}
        >
          {info.icon}
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{info.name}</div>
        <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.45, marginTop: 2 }}>
          {info.description}
        </div>
        {(info.notes ?? []).map((note) => (
          <div key={note} style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4, marginTop: 4 }}>
            {note}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}
