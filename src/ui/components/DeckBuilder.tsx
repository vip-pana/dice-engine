import { useState, type JSX } from 'react'
import {
  ALL_ABILITY_IDS,
  DECK_SIZE,
  HAND_SIZE,
  buildDeck,
  validateDeck,
  type AbilityId,
  type Deck,
} from '../../engine'
import { AbilityCard } from './AbilityCard'
import { DeckPreview } from './DeckPreview'

/**
 * Pre-match screen: compose the 12-die deck you will play the whole match with.
 *
 * Each ability is a TOGGLE rather than a counter, so "at most one die of each special" is
 * structurally impossible to violate from here — `validateDeck` is only a backstop.
 *
 * The number that matters to the player is HAND_SIZE/DECK_SIZE: with 4 of 12 dice drawn
 * each hand, any special in the deck shows up in 33% of hands. Without that figure the
 * choice is unreadable, so it is stated prominently rather than left to be inferred.
 */
export function DeckBuilder({
  onConfirm,
  title = 'Componi il tuo mazzo',
  confirmLabel = 'Inizia la partita',
  note = 'Il Bot riceve un mazzo con lo stesso numero di dadi speciali, ma scelti a caso — al passo dopo puoi cambiare come nasce.',
}: {
  onConfirm: (deck: Deck) => void
  /**
   * Overridden when composing the BOT's deck instead of your own. Parametrised rather than
   * forked into a second component: everything else about the screen — the toggles, the
   * 12-slot preview, the draw-chance figure, the validation — is identical, and a copy would
   * drift the moment either one changed.
   */
  title?: string
  confirmLabel?: string
  /**
   * Trailing sentence of the rules blurb. Parametrised because the default one describes how
   * the BOT's deck is generated, which is a lie on the screen where you are building it.
   */
  note?: string
}): JSX.Element {
  const [selected, setSelected] = useState<readonly AbilityId[]>([])

  const deck = buildDeck(selected)
  const problems = validateDeck(deck)
  const drawChance = Math.round((HAND_SIZE / DECK_SIZE) * 100)

  const toggle = (id: AbilityId): void => {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        color: '#e2e8f0',
        maxWidth: 620,
        margin: '0 auto',
        padding: '2rem 1.5rem',
      }}
    >
      <h1 style={{ marginTop: 0, marginBottom: 6 }}>{title}</h1>
      <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
        Il mazzo ha <strong>{DECK_SIZE} dadi</strong> e resta lo stesso per tutta la partita.
        Ogni mano ne peschi <strong>{HAND_SIZE} a caso</strong>: un dado speciale nel mazzo
        esce quindi in circa <strong>{drawChance}%</strong> delle mani.
      </p>
      <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.6 }}>
        Puoi mettere al massimo un dado di ogni tipo speciale. Gli slot che restano sono dadi
        normali.{note !== undefined ? ` ${note}` : ''}
      </p>

      <h2 style={{ fontSize: 14, color: '#94a3b8', marginBottom: 8, marginTop: 24 }}>
        Dadi speciali disponibili
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ALL_ABILITY_IDS.map((id) => (
          <AbilityCard
            key={id}
            id={id}
            active={selected.includes(id)}
            onToggle={() => toggle(id)}
            inactiveNote="non nel mazzo"
          />
        ))}
      </div>

      <h2 style={{ fontSize: 14, color: '#94a3b8', marginBottom: 8, marginTop: 24 }}>
        Il tuo mazzo — {selected.length} speciali, {DECK_SIZE - selected.length} normali
      </h2>
      <DeckPreview deck={deck} />

      {problems.length > 0 && (
        <ul style={{ color: '#f87171', fontSize: 13, paddingLeft: 20 }}>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={problems.length > 0}
        onClick={() => onConfirm(deck)}
        style={{
          marginTop: 20,
          padding: '12px 22px',
          borderRadius: 8,
          border: 'none',
          fontSize: 16,
          fontWeight: 700,
          background: problems.length > 0 ? '#1e293b' : '#2563eb',
          color: problems.length > 0 ? '#64748b' : 'white',
          cursor: problems.length > 0 ? 'not-allowed' : 'pointer',
        }}
      >
        {confirmLabel}
      </button>
    </main>
  )
}
