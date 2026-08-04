import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { GameState } from '../../engine'
import { usePrefersReducedMotion } from '../responsive'
import { ABILITY_ACCENT } from '../components/DieView'

/** How long a phase announcement stays up before fading out, in ms. */
const PHASE_BANNER_MS = 1100

/**
 * Announces every phase change with a banner across the field.
 *
 * The moment that matters is the CHANGE: it is when you have to notice that it is your turn and
 * what the turn is for. A line of small text above the felt, in a game with ten phases — several
 * of them named after abilities (Mulinello, Paguro) — went unread.
 *
 * NON-BLOCKING, and that is the load-bearing property. BotAutoPlayer acts on a 500ms timer, so a
 * modal banner would have the bot playing behind a curtain while the felt changed underneath it.
 * The container is `pointer-events: none` and only the banner itself takes clicks (to dismiss
 * early), so everything under it stays live while it is up. It also never gates a dispatch: it
 * reads `phase` and renders, and the game does not know it exists.
 *
 * The three outcome phases are suppressed here — they get OutcomeBanner instead, which waits for
 * a click because it has something to read.
 */
export function PhaseBanner({ phase }: { phase: GameState['phase'] }): JSX.Element | null {
  const reducedMotion = usePrefersReducedMotion()
  const [shown, setShown] = useState<GameState['phase'] | null>(null)
  // The phase we have already announced. A ref, not state: changing it must not re-render, and
  // it starts AT the mounting phase so opening a match does not announce "Tiro iniziale" — that
  // is the phase you arrived in, not a change, and announcing it is noise.
  const announced = useRef<GameState['phase']>(phase)

  useEffect(() => {
    if (phase === announced.current) {
      return
    }
    announced.current = phase
    // The outcome phases have their own banner; announcing them twice would collide with it.
    if (phase === 'SHOWDOWN' || phase === 'HAND_COMPLETE' || phase === 'MATCH_OVER') {
      setShown(null)
      return
    }
    setShown(phase)
    const id = setTimeout(() => setShown(null), PHASE_BANNER_MS)
    // Cleared on the next change: SHOWDOWN -> HAND_COMPLETE happens in one tick, and a stale
    // timer from the previous phase would otherwise switch off the banner that just appeared.
    return () => clearTimeout(id)
  }, [phase])

  if (shown === null) {
    return null
  }

  return createPortal(
    <div
      // Centred over the field, and TRANSPARENT to the pointer — see the note above.
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        // Above the felt, below the log drawer (200): a phase change while the drawer is open
        // must not print itself over what you opened the drawer to read.
        zIndex: 150,
        padding: 16,
      }}
    >
      <div
        role="status"
        aria-live="polite"
        onClick={() => setShown(null)}
        style={{
          // The one element that takes clicks, so tapping the banner skips the wait without
          // making the rest of the screen inert.
          pointerEvents: 'auto',
          cursor: 'pointer',
          maxWidth: 'min(92vw, 560px)',
          textAlign: 'center',
          padding: '18px 34px',
          borderRadius: 14,
          background: '#0b1220f2',
          border: `2px solid ${ABILITY_ACCENT}`,
          boxShadow: `0 0 40px #020617cc, 0 0 0 1px #0f172a`,
          animation: reducedMotion ? undefined : 'phaseIn 260ms ease-out',
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: ABILITY_ACCENT,
          }}
        >
          {phaseLabel(shown)}
        </div>
        <div style={{ marginTop: 6, fontSize: 15, color: '#e2e8f0', lineHeight: 1.4 }}>
          {PHASE_BLURB[shown]}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * One line saying what to DO in each phase.
 *
 * A total Record rather than a switch with a default: the eleventh phase then fails to compile
 * until someone writes its line. A default would silently announce a new phase with no
 * explanation.
 *
 * Worded as an instruction where there is something to do, and as a statement where there is
 * not (the three terminal phases). Kept short on purpose — this is a banner that shows for about
 * a second, not documentation.
 */
const PHASE_BLURB: Record<GameState['phase'], string> = {
  ROLL_OFF: 'Tira il dado: il più alto inizia la mano',
  INITIAL_BET: 'Punta prima di vedere i dadi',
  STEAL: 'Ruba un dado comune — il primario sceglie per primo',
  REROLL_SELECT: 'Scegli quali dadi rilanciare (il rubato resta fisso)',
  MULINELLO_SELECT: 'Puoi tirare il dado del Mulinello una terza volta',
  PAGURO_SELECT: 'Scegli un guscio, al buio',
  SECOND_BET: 'Punta di nuovo, ora che i dadi sono definitivi',
  SHOWDOWN: 'Si confrontano le mani',
  HAND_COMPLETE: 'Mano conclusa',
  MATCH_OVER: 'Partita conclusa',
}

function phaseLabel(phase: GameState['phase']): string {
  switch (phase) {
    case 'ROLL_OFF':
      return 'Tiro iniziale'
    case 'INITIAL_BET':
      return 'Scommessa iniziale'
    case 'STEAL':
      return 'Furto'
    case 'REROLL_SELECT':
      return 'Scelta rilancio'
    case 'MULINELLO_SELECT':
      return 'Mulinello'
    case 'PAGURO_SELECT':
      return 'Paguro'
    case 'SECOND_BET':
      return 'Seconda scommessa'
    case 'SHOWDOWN':
      return 'Showdown'
    case 'HAND_COMPLETE':
      return 'Mano conclusa'
    case 'MATCH_OVER':
      return 'Match concluso'
  }
}
