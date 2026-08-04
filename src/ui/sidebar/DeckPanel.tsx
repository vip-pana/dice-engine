import { useState, type JSX } from 'react'
import { DECK_SIZE, HAND_SIZE, deckSpecials, type Deck } from '../../engine'
import { DeckPreview } from '../components/DeckPreview'
import { SecondaryButton } from '../components/Buttons'

/**
 * Your deck, always visible during the match.
 *
 * Unlike the ability catalogue this IS a per-seat inventory — and it can be, because a deck is
 * fixed for the whole match. It answers "what did I bring?" without having to remember the
 * builder screen.
 *
 * The rebuild button lives here rather than only in the end-of-match controls: composing a
 * deck is the one setup choice in the game, so the way back to it should always be at hand.
 */
export function DeckPanel({
  deck,
  onRebuildDeck,
  matchInProgress,
}: {
  deck: Deck
  onRebuildDeck: () => void
  /** Whether abandoning now would throw away a live match. */
  matchInProgress: boolean
}): JSX.Element {
  const specials = deckSpecials(deck)
  const drawChance = Math.round((HAND_SIZE / DECK_SIZE) * 100)
  // Two-step only while a match is live: rebuilding then discards real progress, and a
  // single mis-click in a sidebar button should not cost the player their game.
  const [confirming, setConfirming] = useState(false)

  return (
    <section
      style={{
        padding: 14,
        borderRadius: 12,
        background: '#0b1220',
        border: '1px solid #1e293b',
        minWidth: 0,
      }}
    >
      <h2
        style={{
          margin: '0 0 4px',
          fontSize: 14,
          fontWeight: 700,
          color: '#94a3b8',
          letterSpacing: 0.3,
        }}
      >
        Il tuo mazzo
      </h2>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
        {specials.length === 0
          ? `${DECK_SIZE} dadi normali. Peschi ${HAND_SIZE} dadi a ogni mano.`
          : `${specials.length} special${specials.length === 1 ? 'e' : 'i'} su ${DECK_SIZE} dadi — ognuno esce in circa ${drawChance}% delle mani.`}
      </p>

      <DeckPreview deck={deck} variant="compact" />

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {confirming ? (
          <>
            <SecondaryButton onClick={onRebuildDeck}>Sì, abbandona</SecondaryButton>
            <SecondaryButton onClick={() => setConfirming(false)}>Annulla</SecondaryButton>
          </>
        ) : (
          <SecondaryButton
            onClick={() => (matchInProgress ? setConfirming(true) : onRebuildDeck())}
          >
            Cambia mazzo
          </SecondaryButton>
        )}
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 10, color: '#475569', lineHeight: 1.4 }}>
        {confirming
          ? 'La partita in corso verrà abbandonata.'
          : 'Cambiare mazzo inizia una nuova partita.'}
      </p>
    </section>
  )
}
