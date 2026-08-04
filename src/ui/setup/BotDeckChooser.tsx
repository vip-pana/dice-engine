import { useState, type JSX } from 'react'
import { ALL_DIFFICULTIES, type Deck, type Difficulty } from '../../engine'
import { difficultyBlurb, difficultyLabel } from '../labels'
import { useIsPhone } from '../responsive'
import { DeckBuilder } from '../components/DeckBuilder'
import type { BotDeckMode } from './setup'

/**
 * Second setup screen: the difficulty, and how the bot's deck is generated.
 *
 * Its own screen rather than a control inside the deck builder, because 'custom' has to open
 * the builder again — nesting one builder inside another would be a worse shape than
 * sequencing them.
 *
 * The difficulty sits ABOVE the three deck-mode buttons, which are still what confirms and
 * starts the match. So the flow is unchanged for anyone who does not care: 'Normale' is
 * preselected and one click still starts a game.
 */
export function BotDeckChooser({
  onConfirm,
  onBack,
}: {
  onConfirm: (mode: BotDeckMode, deck: Deck | null, difficulty: Difficulty) => void
  onBack: () => void
}): JSX.Element {
  const [composing, setComposing] = useState(false)
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const phone = useIsPhone()

  if (composing) {
    return (
      <DeckBuilder
        title="Componi il mazzo del Bot"
        confirmLabel="Gioca contro questo mazzo"
        // No mention of how the bot's deck is generated: you ARE generating it. It also says
        // the level leaves this deck alone, because everywhere else the level adjusts it.
        note={`Non lo vedrai in partita: solo una 🏮 Lanterna può darti una sbirciata, una volta per mano. È così che puoi verificare che l'abilità dica il vero. Il livello ${difficultyLabel(difficulty)} non tocca questo mazzo: lo componi tu.`}
        // `composing` is state in THIS component, so the chosen difficulty survives the
        // detour through the builder and is still here to be confirmed with the deck.
        onConfirm={(deck) => onConfirm('custom', deck, difficulty)}
      />
    )
  }

  const option = (label: string, description: string, onClick: () => void): JSX.Element => (
    <button
      type="button"
      key={label}
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '14px 16px',
        marginBottom: 10,
        borderRadius: 10,
        border: '1px solid #1e293b',
        background: '#0b1220',
        color: '#e2e8f0',
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <strong style={{ fontSize: 15 }}>{label}</strong>
      <span style={{ display: 'block', color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
        {description}
      </span>
    </button>
  )

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        color: '#e2e8f0',
        maxWidth: 620,
        margin: '0 auto',
        padding: phone ? '1.25rem 0.75rem 2rem' : '2rem 1.5rem',
      }}
    >
      <h1 style={{ marginTop: 0, marginBottom: 6, fontSize: phone ? '1.5rem' : undefined }}>
        L'avversario
      </h1>

      <DifficultyPicker value={difficulty} onChange={setDifficulty} />

      <h2 style={{ fontSize: 14, color: '#94a3b8', marginBottom: 6, marginTop: 24 }}>
        Come nasce il suo mazzo
      </h2>
      <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
        Il suo mazzo resta nascosto durante la partita: solo una <strong>🏮 Lanterna</strong>{' '}
        può darti una sbirciata, una volta per mano.
      </p>

      {option(
        'Specchiato',
        'Stesso numero di speciali del tuo mazzo, ma scelti a caso. È il comportamento di sempre.',
        () => onConfirm('mirrored', null, difficulty),
      )}
      {option(
        'Casuale',
        'Anche il numero di speciali è casuale: non sai né quanti né quali. Qui la Lanterna vale di più.',
        () => onConfirm('random', null, difficulty),
      )}
      {option('Lo compongo io', 'Scegli tu i suoi speciali — utile per provare le abilità.', () =>
        setComposing(true),
      )}

      <button
        type="button"
        onClick={onBack}
        style={{
          marginTop: 10,
          padding: '8px 14px',
          minHeight: 44,
          borderRadius: 8,
          border: '1px solid #1e293b',
          background: 'transparent',
          color: '#94a3b8',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        ← Cambia il tuo mazzo
      </button>
      {/* The level resets to Normale on a round trip through the deck builder, exactly as the
          deck mode already does — this screen owns both, and going back unmounts it. */}
    </main>
  )
}

/**
 * The three difficulty levels, as a radio group.
 *
 * A GRID of three equal columns rather than a flex row: the three Italian labels must fit a
 * 320px screen without depending on a breakpoint.
 *
 * The blurb under the row is not decoration — it is where the level states its consequences,
 * including the two that bind the HUMAN (the minimum bet and the raise cap). Without it, the
 * raise button greying out sooner on Facile reads as a bug rather than as the level.
 */
function DifficultyPicker({
  value,
  onChange,
}: {
  value: Difficulty
  onChange: (d: Difficulty) => void
}): JSX.Element {
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Livello di difficoltà"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}
      >
        {ALL_DIFFICULTIES.map((id) => {
          const active = id === value
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(id)}
              style={{
                padding: '10px 8px',
                // Thumb-sized, like every other control on the setup screens.
                minHeight: 44,
                borderRadius: 10,
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 15,
                fontWeight: active ? 700 : 400,
                // Same two-tone palette as the deck-mode buttons below, so the two rows read as
                // one screen; only the accent border says which one is chosen.
                background: active ? '#1e293b' : '#0b1220',
                border: `1px solid ${active ? '#38bdf8' : '#1e293b'}`,
                color: active ? '#e2e8f0' : '#94a3b8',
              }}
            >
              {difficultyLabel(id)}
            </button>
          )
        })}
      </div>
      <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6, margin: '10px 0 0' }}>
        {difficultyBlurb(value)}
      </p>
    </div>
  )
}
