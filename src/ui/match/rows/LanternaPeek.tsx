import { useState, type JSX } from 'react'
import { DECK_SIZE, type GameState } from '../../../engine'
import { DeckPreview } from '../../components/DeckPreview'
import { Hint, SecondaryButton } from '../../components/Buttons'
import type { UseGameDispatch } from '../../handState'

/**
 * The Lanterna's one look at the Bot's deck.
 *
 * A GLANCE, NOT A NOTE, and three things keep it that way:
 *  - dispatch FIRST, reveal second — the reducer owns "once per hand", and revealing before
 *    recording would hand back a look already spent.
 *  - nothing is snapshotted: the deck is read from `state.decks.bot` on every render.
 *  - once spent there is no button; the row is inert with "Hai già sbirciato" (see the selector).
 *
 * Deliberately NOT closed when the phase advances — the Bot acting while you read is the normal
 * case, and a panel vanishing mid-read would look like a glitch.
 */
export function LanternaPeek({
  state,
  dispatch,
}: {
  state: GameState
  dispatch: UseGameDispatch
}): JSX.Element {
  const [revealed, setRevealed] = useState(false)
  const deck = state.decks.bot

  if (revealed && deck !== null) {
    return (
      <div>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
          Tutti i {DECK_SIZE} dadi del suo mazzo. Quando chiudi, non li rivedi più.
        </p>
        <DeckPreview deck={deck} variant="compact" explain={false} />
      </div>
    )
  }
  return (
    <div>
      <Hint text="🏮 Puoi dare una sbirciata al mazzo del Bot: una volta per mano." />
      <div style={{ marginTop: 8 }}>
        <SecondaryButton
          onClick={() => {
            dispatch({ type: 'LANTERNA_PEEK', player: 'human' })
            setRevealed(true)
          }}
        >
          Sbircia il mazzo
        </SecondaryButton>
      </div>
    </div>
  )
}
