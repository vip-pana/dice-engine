import { useState, type JSX, type ReactNode } from 'react'
import {
  ALL_ABILITY_IDS,
  DECK_SIZE,
  HAND_SIZE,
  buildDeck,
  createRng,
  deckSpecials,
  rollRandomBotDeck,
  validateDeck,
  type AbilityId,
  type Deck,
} from '../../engine'
import { useIsPhone } from '../responsive'
import { AbilityCard } from './AbilityCard'
import { DeckPreview } from './DeckPreview'

// An Rng just for the "surprise me" button, kept away from the match Rng so shuffling a
// suggestion never disturbs the dice stream of the game you are about to play. Randomly
// seeded so the button does not offer the same deck on every page load — same reasoning as
// botBrainRng in App.tsx.
const suggestionRng = createRng(Math.floor(Math.random() * 2 ** 31))

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
  const phone = useIsPhone()

  const deck = buildDeck(selected)
  const problems = validateDeck(deck)
  const drawChance = Math.round((HAND_SIZE / DECK_SIZE) * 100)

  const toggle = (id: AbilityId): void => {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  /**
   * Replaces the selection with a random one — how many specials AND which.
   *
   * Reuses `rollRandomBotDeck`, which is exactly this roll: one draw for the count, then a
   * partial Fisher-Yates over the registry. Deliberately not a second implementation here —
   * a local `Math.random` version would drift from the engine's the moment either changed,
   * and would quietly lose the "at most one of each" guarantee that buildDeck enforces.
   *
   * `deckSpecials` unwraps the 12-slot deck back to the ids this screen's state is made of.
   * Round-tripping through a Deck rather than shuffling ids directly is what keeps the engine
   * the single source of truth for what a legal deck is.
   */
  const randomise = (): void => {
    setSelected(deckSpecials(rollRandomBotDeck(suggestionRng)))
  }

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
      {/* The default h1 is 2em/32px, which wraps this title onto three lines on a phone and
          pushes the actual choice below the fold. */}
      <h1 style={{ marginTop: 0, marginBottom: 6, fontSize: phone ? '1.5rem' : undefined }}>
        {title}
      </h1>
      <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
        Il mazzo ha <strong>{DECK_SIZE} dadi</strong> e resta lo stesso per tutta la partita.
        Ogni mano ne peschi <strong>{HAND_SIZE} a caso</strong>: un dado speciale nel mazzo
        esce quindi in circa <strong>{drawChance}%</strong> delle mani.
      </p>
      <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.6 }}>
        Puoi mettere al massimo un dado di ogni tipo speciale. Gli slot che restano sono dadi
        normali.{note !== undefined ? ` ${note}` : ''}
      </p>

      {/*
        The heading carries the shuffle, rather than putting it down by the confirm button:
        this is the row the choice happens in, and a control that rewrites the selection
        belongs next to the selection it rewrites.

        "Svuota" earns its place because of the shuffle, not on its own — once a click can
        hand you ten specials, un-toggling them one by one is the only way back, and there
        are ten of them. Disabled at zero so it never looks like it did nothing.
      */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: 24,
          marginBottom: 8,
        }}
      >
        <h2 style={{ fontSize: 14, color: '#94a3b8', margin: 0 }}>Dadi speciali disponibili</h2>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <MiniButton onClick={randomise}>🎲 Casuali</MiniButton>
          <MiniButton onClick={() => setSelected([])} disabled={selected.length === 0}>
            Svuota
          </MiniButton>
        </div>
      </div>
      {/*
        A GRID, not the single column this used to be: at eight registered abilities the list
        ran off the fold and the choice stopped being scannable. `auto-fit` with a 240px floor
        rather than a fixed column count, so it collapses to one column on a narrow screen
        instead of squeezing two unreadable ones — the cards already carry `width: 100%` and
        `minWidth: 0`, so they fit whatever track they land in and wrap their text.

        `alignItems: start` because the descriptions differ wildly in length (one line for the
        D4, four for the Spugna). Grid's default `stretch` would pad every card out to its
        tallest neighbour, leaving dead space that reads as a rendering fault.

        SCROLLS ON ITS OWN, because at ten abilities even the grid outgrew the fold and pushed
        the deck and the confirm button off screen — so the one thing you came here to look at,
        the deck you are building, was invisible until you scrolled. Bounding this list instead
        of the page keeps "the specials" and "your deck" on screen together, which is the
        comparison the screen exists to support.

        40vh rather than a pixel height: it is relative to the WINDOW, so a laptop gets ~300px
        and a tall monitor more, and in both cases there is room left for the deck below. A
        fixed height would waste space on one and still overflow on the other.

        The border and darker background are not decoration — a list cut off mid-card with no
        frame reads as a rendering fault rather than as something you can scroll.
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          alignItems: 'start',
          gap: 8,
          maxHeight: '40vh',
          overflowY: 'auto',
          border: '1px solid #1e293b',
          borderRadius: 8,
          padding: 8,
          background: '#0b1120',
        }}
      >
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

      <h2
        style={{
          fontSize: 14,
          color: '#94a3b8',
          marginBottom: 8,
          marginTop: 24,
          textAlign: 'center',
        }}
      >
        Il tuo mazzo — {selected.length} speciali, {DECK_SIZE - selected.length} normali
      </h2>
      {/*
        Centred from OUT HERE, not inside DeckPreview: that component is also the in-match
        sidebar and the Lanterna panel (both `compact`), and both are left-aligned on purpose.
        Centring it internally would move all three.

        A flex parent rather than `margin: 0 auto` on the preview itself, because the preview
        carries its own `maxWidth` and centring it would then depend on that number staying in
        sync with the variant. `justifyContent: center` just centres whatever width it is.
      */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <DeckPreview deck={deck} />
      </div>

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
          // Full width at EVERY size, not just on a phone. A <button> is inline-block, so it
          // shrink-wraps its label and sits at the left edge; the <main> around it is already
          // `maxWidth: 620; margin: 0 auto`, so filling it is what makes the button read as
          // centred with the rest of the column. The phone-only version of this was the same
          // fix for the same reason — this is the only way off the screen and a button floating
          // at the left edge under a long scroll is easy to miss — and that reasoning does not
          // stop applying at 621px.
          width: '100%',
          padding: '12px 22px',
          minHeight: 48,
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

/**
 * A small outlined button, for the controls that sit on a heading row.
 *
 * Follows App.tsx's SecondaryButton (transparent, outlined, muted) deliberately, so the two
 * screens do not grow separate button languages — but at heading scale. Reusing that one
 * directly would need it exported AND would drop a 15px/10-18px control next to a 14px <h2>,
 * where it reads as the section's title rather than as an aside to it.
 */
function MiniButton({
  onClick,
  children,
  disabled = false,
}: {
  onClick: () => void
  children: ReactNode
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        background: 'transparent',
        color: disabled ? '#475569' : '#94a3b8',
        border: `1px solid ${disabled ? '#1e293b' : '#475569'}`,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}
