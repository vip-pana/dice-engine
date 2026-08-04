import type { JSX } from 'react'

/**
 * The most recent log line, plus the way into the whole log.
 *
 * Shown at every viewport size: the full log lives in a drawer, so this is always the only thing
 * on screen that says what just happened.
 *
 * The newest line and the "read the rest" button belong together rather than in the controls row:
 * they are one idea — here is what happened, and here is where the history is — and the controls
 * row is for acting on the hand, not for looking things up.
 */
export function LastMove({
  log,
  onOpenLog,
}: {
  log: readonly string[]
  onOpenLog: () => void
}): JSX.Element | null {
  const last = log[log.length - 1]
  if (last === undefined) {
    return null
  }
  return (
    <div
      style={{
        margin: '14px 0 0',
        padding: '10px 12px',
        borderRadius: 10,
        background: '#111c31',
        border: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <p
        style={{
          margin: 0,
          // Takes the space and wraps; `minWidth: 0` is what lets it shrink below its text
          // width instead of pushing the button off the row.
          flex: 1,
          minWidth: 0,
          color: '#94a3b8',
          fontSize: 13,
          lineHeight: 1.45,
          overflowWrap: 'anywhere',
        }}
      >
        {last}
      </p>
      <button
        type="button"
        onClick={onOpenLog}
        style={{
          flexShrink: 0,
          minHeight: 36,
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid #334155',
          background: 'transparent',
          color: '#94a3b8',
          fontFamily: 'inherit',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        📜 Registro
      </button>
    </div>
  )
}
