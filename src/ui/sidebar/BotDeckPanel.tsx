import { useState, type JSX } from 'react'
import { DECK_SIZE, abilitySpec, inPeekablePhase, type GameState } from '../../engine'
import { DeckPreview } from '../components/DeckPreview'
import { ABILITY_ACCENT } from '../components/DieView'
import { SecondaryButton } from '../components/Buttons'
import { humanHolds, type UseGameDispatch } from '../handState'

/**
 * The Dado Lanterna's one look at the bot's 12-die deck.
 *
 * Lives in the SIDEBAR, not in Controls, and that is forced rather than chosen: Controls
 * replaces itself with "In attesa del Bot…" whenever `toAct !== 'human'`, which is exactly when
 * a player most wants to peek. The sidebar renders in every phase.
 *
 * Nothing is remembered. The panel reads `state.decks.bot` live while open, and once closed
 * there is nothing to reopen — the engine's per-hand flag is spent. That is the ability: a
 * glance, not a note. Deliberately NOT auto-closed when the phase advances: the rule the engine
 * enforces is one peek per hand, and a panel vanishing while you are still reading it would
 * read as a glitch.
 */
export function BotDeckPanel({
  state,
  dispatch,
}: {
  state: GameState
  dispatch: UseGameDispatch
}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const botDeck = state.decks.bot
  const used = state.hands.human.lanternaUsed

  // No lantern, no panel at all — rather than an empty box hinting at an ability you lack.
  if (!humanHolds(state, 'DADO_LANTERNA') || botDeck === null) {
    return null
  }
  // inPeekablePhase comes from the engine: which phases allow a peek is a RULE, and a copy of
  // the phase list here would drift the moment the reducer's changed.
  const canPeek = !used && inPeekablePhase(state)

  return (
    <section
      style={{
        padding: 14,
        borderRadius: 12,
        background: '#0b1220',
        border: `1px solid ${open ? ABILITY_ACCENT : '#1e293b'}`,
        minWidth: 0,
      }}
    >
      <h2 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>
        {abilitySpec('DADO_LANTERNA')?.icon} Mazzo del Bot
      </h2>

      {open ? (
        <>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
            Tutti i {DECK_SIZE} dadi del suo mazzo. Quando chiudi, non li rivedi più.
          </p>
          {/* DeckPreview unchanged, because the whole bag is the point — specials and plain
              slots alike. */}
          <DeckPreview deck={botDeck} variant="compact" />
          <div style={{ marginTop: 10 }}>
            <SecondaryButton onClick={() => setOpen(false)}>Chiudi</SecondaryButton>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
            {used
              ? 'Hai già sbirciato in questa mano.'
              : canPeek
                ? 'Puoi dare una sbirciata al suo mazzo: una volta per mano.'
                : 'Potrai sbirciare appena i dadi sono in tavola.'}
          </p>
          {canPeek && (
            <SecondaryButton
              onClick={() => {
                // Engine first, then open: the reducer owns "once per hand", and opening the
                // panel without recording the peek would hand back a look already spent.
                dispatch({ type: 'LANTERNA_PEEK', player: 'human' })
                setOpen(true)
              }}
            >
              Sbircia il mazzo
            </SecondaryButton>
          )}
        </>
      )}
    </section>
  )
}
