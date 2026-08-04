import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import type { GameState } from '../../engine'
import { categoryLabel, playerLabel } from '../labels'
import { usePrefersReducedMotion } from '../responsive'
import { ACCENT_BY_KIND, GOLD_ACCENT } from '../components/DieView'
import { PrimaryButton, SecondaryButton } from '../components/Buttons'
import type { UseGameDispatch } from '../handState'

/**
 * The result of the hand, as an overlay that WAITS.
 *
 * The one banner that does not fade: there are two hands to read, plus whatever a Torpedo or a
 * Dado d'Oro did to them, and a second is not enough for any of that. It closes on the button
 * that also advances the game — one click instead of two, which is why the "Mano successiva" /
 * "Nuova partita" buttons live here rather than in Controls.
 */
export function OutcomeBanner({
  state,
  dispatch,
  open,
  onDismiss,
  onNewMatch,
  onRebuildDeck,
}: {
  state: GameState
  dispatch: UseGameDispatch
  /** Whether the result is currently on screen. Owned by Match — see `outcomeShowing` there. */
  open: boolean
  onDismiss: () => void
  onNewMatch: () => void
  onRebuildDeck: () => void
}): JSX.Element | null {
  const reducedMotion = usePrefersReducedMotion()

  if (!open || state.lastShowdown === null) {
    return null
  }

  const sd = state.lastShowdown
  const isTie = sd.outcome.kind === 'tie'
  const winner = sd.outcome.kind === 'win' ? sd.outcome.winner : null
  const goldenNote = goldenPayoutNote(state)

  // Color: green if you won the hand, red if the bot did, amber on a tie.
  const bg = isTie ? '#78350f' : winner === 'human' ? '#14532d' : '#7f1d1d'
  const border = isTie ? '#f59e0b' : winner === 'human' ? '#22c55e' : '#ef4444'

  const headline =
    state.phase === 'MATCH_OVER'
      ? `${playerLabel(state.matchWinner!)} vince il match ${state.score.human}-${state.score.bot}!`
      : isTie
        ? 'Pareggio: piatto diviso, si rigioca.'
        : `${playerLabel(winner!)} ${winner === 'human' ? 'hai' : 'ha'} vinto la mano!`

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: '#020617bb',
        // Above the phase banner (150), below the log drawer (200) — reading the history of the
        // hand you just lost is a reasonable thing to want on top of the result.
        zIndex: 160,
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Esito della mano"
        style={{
          maxWidth: 'min(92vw, 520px)',
          maxHeight: '86vh',
          overflowY: 'auto',
          padding: '18px 20px',
          borderRadius: 12,
          background: bg,
          border: `2px solid ${border}`,
          boxShadow: '0 24px 60px #020617cc',
          animation: reducedMotion ? undefined : 'phaseIn 220ms ease-out',
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 800 }}>{headline}</div>
        <div style={{ marginTop: 6, fontSize: 14, color: '#e2e8f0' }}>
          Tu: <strong>{categoryLabel(sd.human)}</strong> [{sd.human.values.join(' ')}] · Bot:{' '}
          <strong>{categoryLabel(sd.bot)}</strong> [{sd.bot.values.join(' ')}]
        </div>
        {torpedoNotes(state).map((line) => (
          // A face that differs from what was on the table a second ago is the single most
          // confusing thing the showdown can show. Say why, where it cannot be missed.
          <div
            key={line}
            style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: ACCENT_BY_KIND.malus }}
          >
            ⚡ {line}
          </div>
        ))}
        {goldenNote !== null && (
          // A doubled pot is the most surprising thing that can happen to the bankroll, and
          // the log line explaining it scrolls away. Repeat it where it cannot be missed.
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: GOLD_ACCENT }}>
            🪙 {goldenNote}
          </div>
        )}

        {/*
          The way on, in the banner rather than under it: the click that closes this is the click
          that continues, so reading the result costs no extra step. SHOWDOWN gets no button
          because the reducer moves straight to HAND_COMPLETE — there is nothing to advance yet,
          and offering a dead button would read as a stuck game.
        */}
        <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {state.phase === 'HAND_COMPLETE' && (
            <PrimaryButton onClick={() => dispatch({ type: 'NEXT_HAND' })}>
              Mano successiva
            </PrimaryButton>
          )}
          {state.phase === 'MATCH_OVER' && (
            <>
              <PrimaryButton onClick={onNewMatch}>Nuova partita</PrimaryButton>
              <SecondaryButton onClick={onRebuildDeck}>Cambia mazzo</SecondaryButton>
            </>
          )}
          {state.phase !== 'SHOWDOWN' && (
            // An escape hatch that does NOT advance the hand, for looking at the final dice. The
            // same buttons then appear under the felt (see Controls), which is why they are
            // hidden there while this is open — otherwise "Mano successiva" is on screen twice.
            <SecondaryButton onClick={onDismiss}>Guarda il tavolo</SecondaryButton>
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}

/**
 * The engine's own Dado Torpedo lines for the hand just finished.
 *
 * Reads the log for the same reason goldenPayoutNote does — the reducer already worded what
 * it did, and recomputing here could disagree with the values actually shown.
 *
 * A wider window than the payout note: the zap lines are emitted BEFORE the post-reroll dice
 * line, the showdown line, and possibly a payout and a match-over line, so they sit further
 * back. Returns every match, since two Torpedoes (or an electrified field) produce more than
 * one line.
 */
const TORPEDO_LOG_WINDOW = 8

function torpedoNotes(state: GameState): readonly string[] {
  // Matches the RESULT lines only. The aim line from REROLL_SELECT ("punta il Dado Torpedo
  // sul dado N") also mentions the ability and sits within this window, but it describes an
  // intention, not damage — showing it in the outcome banner would double-report the effect.
  return state.log
    .slice(-TORPEDO_LOG_WINDOW)
    .filter((l) => /Dado Torpedo (di|tra i comuni)|Campo elettrizzato/.test(l))
}

/**
 * The engine's own "payout doubled" log line for the hand just finished, or null.
 *
 * Scans the last few lines, not just the last one: on a match-winning hand resolveHand
 * appends "vince il match" AFTER the payout line, so checking only the tail would drop the
 * note exactly when the match ends. The window is small enough that a previous hand's line
 * can never reach it — a hand always logs its own showdown lines in between.
 */
const GOLDEN_LOG_WINDOW = 3

function goldenPayoutNote(state: GameState): string | null {
  const tail = state.log.slice(-GOLDEN_LOG_WINDOW)
  return tail.find((l) => l.includes("Dado d'Oro (")) ?? null
}
