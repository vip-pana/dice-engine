import { useEffect, useRef, useState, type JSX, type ReactNode, type CSSProperties } from 'react'
import {
  ALL_ABILITY_IDS,
  abilitySpec,
  isSpongeable,
  inPeekablePhase,
  chooseAction,
  evaluateHand,
  createRng,
  DECK_SIZE,
  DEFAULT_ABILITY_DROPS,
  HAND_SIZE,
  deckSpecials,
  maxBetFor,
  rollBotDeck,
  rollRandomBotDeck,
  viewFor,
  type AbilityId,
  type Deck,
  type GameState,
  type Hand,
  type HandCategory,
  type NewGameOptions,
  type PlayerHandState,
  type Rng,
} from '../engine'
import { useGame } from './useGame'
import { categoryLabel, playerLabel } from './labels'
import { DIE_SIZE, useIsPhone, useIsWide } from './responsive'
import { AbilityCard } from './components/AbilityCard'
import { DeckBuilder } from './components/DeckBuilder'
import { DeckPreview } from './components/DeckPreview'
import { DieView, ABILITY_ACCENT, ACCENT_BY_KIND, GOLD_ACCENT } from './components/DieView'
import { HandRankingLegend } from './components/HandRankingLegend'

// A single Rng dedicated to the BOT's decision-making, kept separate from the match Rng
// so the bot's internal sampling never disturbs the dice stream. Randomly seeded so the
// bot does not make the exact same reroll choices on every page load.
const botBrainRng = createRng(Math.floor(Math.random() * 2 ** 31))

/**
 * How the bot's 12-die deck comes into being. Chosen before the match.
 *
 * `mirrored` is the historical behaviour and stays the default, so an existing match plays
 * exactly as it did. The other two exist because of the Dado Lanterna: with the count
 * mirrored, a player already knows how MANY specials the bot has, so revealing its deck tells
 * them only half of what it could. `random` hides both the count and the identities;
 * `custom` lets you set the deck you are about to go looking for, which is the only way to
 * check that the ability tells the truth.
 */
type BotDeckMode = 'mirrored' | 'random' | 'custom'

/** What the player has settled on before the match starts. */
type Setup = {
  readonly deck: Deck
  readonly botMode: BotDeckMode
  /** Only set when botMode is 'custom'. */
  readonly botDeck: Deck | null
}

/**
 * Gates deck selection in front of the match: your deck, then how the bot's is made.
 *
 * `Match` mounts only once the setup is complete, so `useGame`'s eager state initializer
 * always sees a real deck — no `GameState | null` has to be threaded through the whole tree.
 * The `key` forces a fresh mount (and thus a fresh match) whenever anything about the setup
 * changes.
 *
 * Three explicit stages rather than a pair of nullable flags: "deck chosen but bot mode not
 * yet" and "bot mode chosen but deck not yet" are not both reachable, and modelling them as
 * independent nullables would invite the impossible combination.
 */
export function App(): JSX.Element {
  const [deck, setDeck] = useState<Deck | null>(null)
  const [setup, setSetup] = useState<Setup | null>(null)

  const restart = (): void => {
    setSetup(null)
    setDeck(null)
  }

  if (setup !== null) {
    return <Match key={setupKey(setup)} setup={setup} onRebuild={restart} />
  }
  if (deck === null) {
    return <DeckBuilder onConfirm={setDeck} />
  }
  return (
    <BotDeckChooser
      onConfirm={(botMode, botDeck) => setSetup({ deck, botMode, botDeck })}
      onBack={() => setDeck(null)}
    />
  )
}

/**
 * Stable identity for a setup, used to remount Match when the player changes anything.
 *
 * Includes the bot mode and its custom deck, not just the human's deck: switching only the
 * mode has to restart the match too, and a key built from the human deck alone would silently
 * keep the old one running.
 */
function setupKey(setup: Setup): string {
  const own = setup.deck.map((id) => id ?? '-').join('|')
  const bot = setup.botDeck?.map((id) => id ?? '-').join('|') ?? ''
  return `${own}#${setup.botMode}#${bot}`
}

/**
 * Match options for a chosen setup.
 *
 * A factory, not a plain object: the bot's deck is rolled from the MATCH Rng so that one
 * seed reproduces the whole match including both decks. `commonChance` stays live — common
 * dice belong to nobody and are never part of a deck — while `ownChance` is 0 because own
 * dice now come from the deck (deck mode ignores it either way; 0 is honesty, not effect).
 */
function optionsForSetup(setup: Setup): (rng: Rng) => NewGameOptions {
  return (rng) => ({
    decks: { human: setup.deck, bot: botDeckFor(setup, rng) },
    abilityDrops: { ...DEFAULT_ABILITY_DROPS, ownChance: 0 },
  })
}

function botDeckFor(setup: Setup, rng: Rng): Deck {
  switch (setup.botMode) {
    case 'mirrored':
      return rollBotDeck(rng, setup.deck)
    case 'random':
      return rollRandomBotDeck(rng)
    case 'custom':
      // Non-null by construction: 'custom' is only ever set together with a deck.
      return setup.botDeck ?? rollBotDeck(rng, setup.deck)
  }
}

/**
 * Second setup screen: how the bot's deck is generated.
 *
 * Its own screen rather than a control inside the deck builder, because 'custom' has to open
 * the builder again — nesting one builder inside another would be a worse shape than
 * sequencing them.
 */
function BotDeckChooser({
  onConfirm,
  onBack,
}: {
  onConfirm: (mode: BotDeckMode, deck: Deck | null) => void
  onBack: () => void
}): JSX.Element {
  const [composing, setComposing] = useState(false)
  const phone = useIsPhone()

  if (composing) {
    return (
      <DeckBuilder
        title="Componi il mazzo del Bot"
        confirmLabel="Gioca contro questo mazzo"
        // No mention of how the bot's deck is generated: you ARE generating it.
        note="Non lo vedrai in partita: solo una 🏮 Lanterna può darti una sbirciata, una volta per mano. È così che puoi verificare che l'abilità dica il vero."
        onConfirm={(deck) => onConfirm('custom', deck)}
      />
    )
  }

  const option = (
    label: string,
    description: string,
    onClick: () => void,
  ): JSX.Element => (
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
        Il mazzo del Bot
      </h1>
      <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
        Il suo mazzo resta nascosto durante la partita: solo una <strong>🏮 Lanterna</strong>{' '}
        può darti una sbirciata, una volta per mano.
      </p>

      {option(
        'Specchiato',
        'Stesso numero di speciali del tuo mazzo, ma scelti a caso. È il comportamento di sempre.',
        () => onConfirm('mirrored', null),
      )}
      {option(
        'Casuale',
        'Anche il numero di speciali è casuale: non sai né quanti né quali. Qui la Lanterna vale di più.',
        () => onConfirm('random', null),
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
    </main>
  )
}

function Match({
  setup,
  onRebuild,
}: {
  setup: Setup
  onRebuild: () => void
}): JSX.Element {
  const deck = setup.deck
  // No seed: every match deals differently. Pass one to replay a specific game.
  const { state: trueState, dispatch, newMatch } = useGame(undefined, optionsForSetup(setup))
  const wide = useIsWide()
  const phone = useIsPhone()

  // Render the HUMAN's view, never the raw state: a die hidden by the bot's Nero di
  // Seppia must be unreadable here too — including indirectly, via the "current hand"
  // badge, which would otherwise reveal the hidden face by naming the category.
  // BotAutoPlayer still receives the raw state; the bot filters its own view internally.
  const state = viewFor(trueState, 'human')

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        color: '#e2e8f0',
        background: '#0f172a',
        // dvh, not vh: on mobile browsers `100vh` is the viewport with the URL bar RETRACTED, so
        // a 100vh page is taller than the screen and jumps as the bar hides and shows. The
        // dynamic unit tracks the actually-visible height. Unsupported units are ignored, and
        // on a min-height that degrades to "no minimum", which is harmless.
        minHeight: '100dvh',
      }}
    >
      {/*
        Two columns on a wide screen, stacked on a narrow one. `minmax(0, 720px)` lets the
        game column shrink below its content width instead of forcing a horizontal scroll,
        which a bare `720px` track would do on a tablet.

        On wide the grid is exactly viewport-tall and both columns STRETCH to fill it, so
        the table and the reference panels reach the bottom of the page instead of ending
        in dead space. On narrow it keeps its natural height — a fixed-height stack would
        squeeze the panels into unreadable slivers.
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: wide ? 'minmax(0, 720px) minmax(240px, 300px)' : 'minmax(0, 1fr)',
          gap: phone ? 14 : 24,
          alignItems: 'stretch',
          maxWidth: 1100,
          margin: '0 auto',
          // 24px of side padding is 13% of a 360px screen spent on nothing. Phones get 12.
          padding: phone ? '12px 12px 28px' : '1.5rem',
          // `box-sizing: border-box` so the padding sits INSIDE the 100vh rather than
          // adding to it — otherwise the page scrolls by exactly the padding.
          ...(wide ? { height: '100vh', boxSizing: 'border-box' as const } : null),
        }}
      >
        <main style={{ minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* On a phone the title is pure overhead above the game, so it shrinks rather than
              eating a fifth of the first screenful. */}
          <h1 style={{ marginTop: 0, fontSize: phone ? '1.5rem' : undefined, marginBottom: phone ? 12 : undefined }}>
            Poker di Dadi
          </h1>
          <ScoreBar state={state} />
          <BotAutoPlayer state={trueState} dispatch={dispatch} />
          <Table state={state} dispatch={dispatch} grow={wide} />
          <OutcomeBanner state={state} />
          <Controls
            state={state}
            dispatch={dispatch}
            onNewMatch={() => newMatch()}
            onRebuildDeck={onRebuild}
          />
          {/* The log's newest line, inline with the game, so the phone layout can keep the full
              log folded away without hiding what just happened. */}
          {phone && <LastMove log={state.log} />}
        </main>
        {/* Reference column: your deck, the rules references (tabbed), then the running log. */}
        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <ReferenceStack phone={phone}>
            <DeckPanel
              deck={deck}
              onRebuildDeck={onRebuild}
              matchInProgress={state.phase !== 'MATCH_OVER'}
            />
            <BotDeckPanel state={state} dispatch={dispatch} />
            <ReferencePanel state={state} grow={wide} />
            {/* Takes the remaining height, so the log reaches the bottom of the page. */}
            <ActionLog log={state.log} grow={wide} />
          </ReferenceStack>
        </aside>
      </div>
    </div>
  )
}

/**
 * The reference column: side by side with the game on a wide screen, folded behind one tap on a
 * phone.
 *
 * Stacking the column under the game (which is what the single-column grid does) is right for a
 * tablet and wrong for a phone: the deck, both rule references and the whole log come to well
 * over 2000px of material that the player has to scroll PAST to reach nothing, because the game
 * itself is already above it. Folded, the first screenful is the game and the reference is one
 * tap away.
 *
 * A native `<details>` rather than a useState toggle: it is a disclosure widget with keyboard
 * and screen-reader behaviour already correct, and the browser keeps the open/closed state
 * across re-renders without this component holding any.
 */
function ReferenceStack({
  phone,
  children,
}: {
  phone: boolean
  children: ReactNode
}): JSX.Element {
  const stack = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>{children}</div>
  )
  if (!phone) {
    return stack
  }
  return (
    <details style={{ background: '#111c31', border: '1px solid #1e293b', borderRadius: 12 }}>
      <summary
        style={{
          padding: '14px 16px',
          minHeight: 44,
          fontSize: 15,
          fontWeight: 700,
          color: '#e2e8f0',
          cursor: 'pointer',
          // The marker is kept (it is the affordance that this opens) but the row reads as a
          // button, so the label carries the weight rather than the triangle.
          listStyle: 'revert',
        }}
      >
        Mazzo, regole e registro
      </summary>
      <div style={{ padding: '0 12px 12px' }}>{stack}</div>
    </details>
  )
}

/**
 * The most recent log line, shown on the phone layout only.
 *
 * The full log lives inside the folded reference stack, and a player should not have to open it
 * to learn that the bot just raised. This surfaces exactly the newest entry — the one piece of
 * the log that is about the moment you are in.
 */
function LastMove({ log }: { log: readonly string[] }): JSX.Element | null {
  const last = log[log.length - 1]
  if (last === undefined) {
    return null
  }
  return (
    <p
      style={{
        margin: '14px 0 0',
        padding: '10px 12px',
        borderRadius: 10,
        background: '#111c31',
        border: '1px solid #1e293b',
        color: '#94a3b8',
        fontSize: 13,
        lineHeight: 1.45,
        overflowWrap: 'anywhere',
      }}
    >
      {last}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Bot auto-play: whenever it is the bot's turn, dispatch its chosen action.
// This is pure orchestration — the DECISION lives in the engine's chooseAction.
// ---------------------------------------------------------------------------

function BotAutoPlayer(props: {
  state: GameState
  dispatch: (a: ReturnType<typeof chooseAction>) => void
}): null {
  const { state, dispatch } = props
  useEffect(() => {
    const botActs =
      state.toAct === 'bot' &&
      state.phase !== 'ROLL_OFF' && // roll-off is always initiated by the human's click
      state.phase !== 'HAND_COMPLETE' &&
      state.phase !== 'SHOWDOWN' &&
      state.phase !== 'MATCH_OVER'
    if (!botActs) {
      return
    }
    // Small delay so the human can follow the bot's moves.
    const id = setTimeout(() => {
      dispatch(chooseAction(state, 'bot', botBrainRng))
    }, 500)
    return () => clearTimeout(id)
  }, [state, dispatch])
  return null
}

// ---------------------------------------------------------------------------
// Score / bankroll / pot
// ---------------------------------------------------------------------------

function ScoreBar({ state }: { state: GameState }): JSX.Element {
  const phone = useIsPhone()
  return (
    <section
      style={{
        // A grid, not a `space-between` flex row. Five stats whose labels total ~270px of text
        // cannot share a 300px phone row: they used to survive only by breaking every label onto
        // two or three lines ("Punteggio / (Bo3)") and leaving the values on a ragged baseline.
        // auto-fit reflows them into as many rows as the width needs, with no breakpoint.
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(74px, 1fr))',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 10,
        background: '#1e293b',
        marginBottom: 16,
      }}
    >
      <Stat label="Mano" value={`${state.handNumber}`} />
      {/* "(Bo3)" is 30px of label that wraps onto a second line in a phone-width track, which
          drops this stat's value below its neighbours' and makes the whole strip look broken.
          The match format is stated on the setup screen; the live number does not need it. */}
      <Stat
        label={phone ? 'Punteggio' : 'Punteggio (Bo3)'}
        value={`${state.score.human} - ${state.score.bot}`}
      />
      <Stat label="Tu (monete)" value={`${state.bankroll.human}`} />
      <Stat label="Bot (monete)" value={`${state.bankroll.bot}`} />
      <Stat label="Piatto" value={`${state.pot}`} highlight />
    </section>
  )
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}): JSX.Element {
  return (
    <div style={{ textAlign: 'center', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: highlight ? '#fbbf24' : '#e2e8f0' }}>
        {value}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Deck panel: what you brought to this match, and the way back to the builder
// ---------------------------------------------------------------------------

/**
 * Your deck, always visible during the match.
 *
 * Unlike the ability catalogue below it, this IS a per-seat inventory — and it can be,
 * because a deck is fixed for the whole match. It answers "what did I bring?" without
 * having to remember the builder screen.
 *
 * The rebuild button lives here rather than only in the end-of-match controls: composing a
 * deck is the one setup choice in the game, so the way back to it should always be at hand.
 */
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
 *
 * DeckPreview, unchanged, because the whole bag is the point — specials and plain slots alike.
 */
function BotDeckPanel({
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

function DeckPanel({
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

// ---------------------------------------------------------------------------
// Reference panel: the two static rule references, on tabs
// ---------------------------------------------------------------------------

const REFERENCE_TABS = ['abilities', 'ranking'] as const
type ReferenceTab = (typeof REFERENCE_TABS)[number]

const REFERENCE_TAB_LABEL: Record<ReferenceTab, string> = {
  abilities: 'Dadi speciali',
  ranking: 'Classifica mani',
}

/**
 * Holds the game's two rules references — the special-dice catalogue and the hand ranking
 * ladder — in one tabbed panel.
 *
 * Tabs rather than two stacked panels because the sidebar is height-bound: both references
 * are tall and fixed-height, and stacking them left ActionLog's `flex: 1` with literally
 * zero pixels, so the log vanished. One at a time keeps the log readable.
 *
 * Both are static reference material you consult and leave, never per-turn state, so the
 * cost of hiding one is low — and neither is on the critical path of a decision (the dice
 * themselves carry their ability badge; the live hand has its own "Mano attuale" badge).
 */
function ReferencePanel({
  state,
  grow = false,
}: {
  state: GameState
  /** Share the bounded sidebar height with the log instead of sizing to content. */
  grow?: boolean
}): JSX.Element {
  const [tab, setTab] = useState<ReferenceTab>('abilities')
  const phone = useIsPhone()
  // Accent follows the active tab so the panel border keeps signalling what you're reading.
  const accent = tab === 'abilities' ? `${ABILITY_ACCENT}44` : '#1e293b'

  return (
    <section
      style={{
        padding: 14,
        borderRadius: 12,
        background: '#0b1220',
        border: `1px solid ${accent}`,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        // Growing: share the leftover column height with ActionLog rather than taking a
        // fixed slice. A `maxHeight` here would still be a floor the log has to pay for on
        // a short viewport — which is how the log got squeezed to zero in the first place.
        // Flexing with `minHeight: 0` lets BOTH panels shrink and scroll internally, so
        // neither can starve the other. Not growing (stacked layout): natural height, and
        // the body caps itself below.
        ...(grow ? { flex: '1 1 0', minHeight: 0 } : null),
      }}
    >
      <div role="tablist" aria-label="Riferimenti" style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {REFERENCE_TABS.map((id) => {
          const active = id === tab
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              style={{
                flex: 1,
                padding: '6px 8px',
                // These were the smallest tap targets in the app at ~26px tall. They are the
                // only way to switch reference, so they have to be thumb-sized.
                minHeight: 44,
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 0.3,
                background: active ? '#111c31' : 'transparent',
                color: active ? (id === 'abilities' ? ABILITY_ACCENT : '#e2e8f0') : '#64748b',
                border: `1px solid ${active ? '#334155' : 'transparent'}`,
              }}
            >
              {REFERENCE_TAB_LABEL[id]}
            </button>
          )
        })}
      </div>

      <div
        style={{
          overflowY: 'auto',
          minHeight: 0,
          // On a phone this panel already sits inside a folded disclosure, so capping it would
          // put a scroller inside a scroller — the one gesture guaranteed to trap a thumb. Let
          // it size to content there and leave the page as the only thing that scrolls.
          ...(grow ? { flex: 1 } : phone ? null : { maxHeight: 340 }),
        }}
      >
        {tab === 'abilities' ? <AbilityReference state={state} /> : <RankingReference state={state} />}
      </div>
    </section>
  )
}

/**
 * The hand ranking ladder with live markers for both seats.
 *
 * IMPORTANT: it must be fed the human's VIEW of the state (what Match renders), never the
 * raw state. A Nero di Seppia hides one of your own dice, and viewFor replaces that face
 * with a placeholder — so the position computed here is an estimate, which is exactly why
 * the marker is drawn with a "?". Passing the true state would leak the hidden face by
 * pointing at the real category.
 */
function RankingReference({ state }: { state: GameState }): JSX.Element {
  const humanCategory = categoryOf(state.hands.human)
  const botCategory = categoryOf(state.hands.bot)
  const humanUncertain = state.hands.human.own?.some((d) => d.concealed) ?? false

  return (
    <>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
        {humanCategory === null
          ? 'Dalla più forte alla più debole. I marker appaiono quando la mano è completa.'
          : 'Chi sta più in alto vince. A parità di categoria decidono i dadi più alti.'}
      </p>
      <HandRankingLegend
        human={humanCategory}
        humanUncertain={humanUncertain}
        bot={botCategory}
      />
    </>
  )
}

/** Category of a seat's provisional 5-die hand, or null while it is still incomplete. */
function categoryOf(hand: PlayerHandState): HandCategory | null {
  const live = liveFinalHand(hand)
  return live === null ? null : evaluateHand(live).category
}

/**
 * The catalogue of every special die in the game.
 *
 * Driven by ALL_ABILITY_IDS, not by the drop pool, so a newly registered ability shows up
 * here the moment it is added to abilities.ts — no UI edit required. Abilities excluded
 * from the current drop pool are still listed but marked inactive, which makes an
 * accidentally-empty pool visible rather than silent.
 *
 * It is a rules reference, not a per-seat inventory: with random drops a loadout changes
 * every hand, so "what Tu has" would be stale by the next hand. The dice themselves carry
 * the badge that says who got what.
 */
function AbilityReference({ state }: { state: GameState }): JSX.Element {
  const { ownChance, commonChance, pool } = state.abilityDrops
  const dropsOn = ownChance > 0 || commonChance > 0

  // In deck mode `ownChance` does nothing, so printing it would state a rule that is not in
  // force. Read the MODE, and mark abilities active by what is actually in the deck.
  const deck = state.decks.human
  const deckMode = state.ownDiceSource.human.kind === 'deck' && deck !== null
  const inDeck = deckMode ? deckSpecials(deck) : []
  const drawChance = Math.round((HAND_SIZE / DECK_SIZE) * 100)
  const isActive = (id: AbilityId): boolean =>
    deckMode ? inDeck.includes(id) : dropsOn && pool.includes(id)

  return (
    <>
      <p style={{ margin: '0 0 12px', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
        {deckMode ? (
          <>
            Peschi {HAND_SIZE} dadi su {DECK_SIZE} dal tuo mazzo a ogni mano: ogni speciale
            nel mazzo esce in circa {drawChance}% delle mani.
            {commonChance > 0 && <> Tra i comuni può uscirne uno al {pct(commonChance)}.</>}
          </>
        ) : dropsOn ? (
          <>
            Ogni tipo può uscire al massimo una volta: {pct(ownChance)} in mano,{' '}
            {pct(commonChance)} tra i comuni. Si ripescano a ogni mano.
          </>
        ) : (
          'Estrazioni disattivate: si gioca con soli dadi normali.'
        )}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ALL_ABILITY_IDS.map((id) => (
          <AbilityCard
            key={id}
            id={id}
            active={isActive(id)}
            inactiveNote={deckMode ? 'non nel tuo mazzo' : 'non in gioco'}
          />
        ))}
      </div>
    </>
  )
}

/** Formats a 0..1 probability as a whole-percent label. */
function pct(chance: number): string {
  return `${Math.round(chance * 100)}%`
}

// ---------------------------------------------------------------------------
// Outcome banner: prominent result of the last showdown / match
// ---------------------------------------------------------------------------

function OutcomeBanner({ state }: { state: GameState }): JSX.Element | null {
  const show =
    state.phase === 'SHOWDOWN' ||
    state.phase === 'HAND_COMPLETE' ||
    state.phase === 'MATCH_OVER'
  if (!show || state.lastShowdown === null) {
    return null
  }

  const sd = state.lastShowdown
  const isTie = sd.outcome.kind === 'tie'
  const winner = sd.outcome.kind === 'win' ? sd.outcome.winner : null

  // Color: green if you won the hand, red if the bot did, amber on a tie.
  const bg = isTie ? '#78350f' : winner === 'human' ? '#14532d' : '#7f1d1d'
  const border = isTie ? '#f59e0b' : winner === 'human' ? '#22c55e' : '#ef4444'

  const headline =
    state.phase === 'MATCH_OVER'
      ? `${playerLabel(state.matchWinner!)} vince il match ${state.score.human}-${state.score.bot}!`
      : isTie
        ? 'Pareggio: piatto diviso, si rigioca.'
        : `${playerLabel(winner!)} ${winner === 'human' ? 'hai' : 'ha'} vinto la mano!`

  return (
    <section
      style={{
        marginTop: 16,
        padding: '14px 16px',
        borderRadius: 10,
        background: bg,
        border: `2px solid ${border}`,
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
      {goldenPayoutNote(state) !== null && (
        // A doubled pot is the most surprising thing that can happen to the bankroll, and
        // the log line explaining it scrolls away. Repeat it where it cannot be missed.
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: GOLD_ACCENT }}>
          🪙 {goldenPayoutNote(state)}
        </div>
      )}
    </section>
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
 * Reads the log rather than recomputing: the reducer already decided and worded this, and a
 * second implementation here could disagree with the coins actually paid.
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

// ---------------------------------------------------------------------------
// Table: common dice, bot row, your row, live hand
// ---------------------------------------------------------------------------

function Table({
  state,
  dispatch,
  grow = false,
}: {
  state: GameState
  dispatch: UseGameDispatch
  /** Stretch to fill the remaining column height (wide layout only). */
  grow?: boolean
}): JSX.Element {
  const primaryLabel = playerLabel(state.primary)
  const phone = useIsPhone()
  const humanIsToAct = state.toAct === 'human'

  // A Dado Torpedo is aimed at a BOT die but confirmed from the human row, so the choice
  // lives here, in the nearest common parent of the two rows.
  const aiming = state.phase === 'REROLL_SELECT' && humanIsToAct && humanHoldsTorpedo(state)
  const [torpedoTarget, setTorpedoTarget] = useState<number | null>(null)

  // The Spugna target is chosen in the same window and confirmed by the same button, so it
  // lives beside the aim rather than inside HumanRow — same reasoning, same lifetime.
  const [spongeTarget, setSpongeTarget] = useState<AbilityId | null>(null)
  const selectingReroll = state.phase === 'REROLL_SELECT' && humanIsToAct

  // Drop a stale aim when the hand moves on, so last hand's target cannot leak into the next.
  useEffect(() => {
    if (!aiming) setTorpedoTarget(null)
  }, [aiming, state.handNumber])
  useEffect(() => {
    if (!selectingReroll) setSpongeTarget(null)
  }, [selectingReroll, state.handNumber])

  return (
    <section
      style={
        grow
          ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
          : undefined
      }
    >
      <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 0 }}>
        Primario di mano: <strong>{primaryLabel}</strong> · Fase:{' '}
        <strong>{phaseLabel(state.phase)}</strong>
      </p>

      <RollOffView state={state} />

      {/*
        Seated like a real table, read top to bottom: the OPPONENT across from you, the
        shared dice on the felt between you, your own dice nearest to you. That ordering
        is what makes the steal legible — the commons sit physically between the two
        hands competing for them.
      */}
      <div
        style={{
          borderRadius: 16,
          border: '1px solid #1e293b',
          background: 'linear-gradient(180deg, #101c2e 0%, #0d1826 55%, #101c2e 100%)',
          // Tighter felt padding on a phone: 16px a side is width the dice rows need more.
          padding: phone ? '12px 10px' : '14px 16px',
          // The rows wrap, so nothing should reach past the panel — but if a future row ever
          // does, it scrolls INSIDE the felt rather than dragging the whole page sideways and
          // making the browser zoom the app out. Previously this guard existed only on wide.
          minWidth: 0,
          overflowX: 'auto',
          // When stretching, the panel fills the column and the bands share the extra
          // height (capped, see Band). `overflow: auto` keeps a tall hand scrollable on a
          // short viewport instead of spilling out of the panel.
          ...(grow
            ? {
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                overflow: 'auto',
              }
            : null),
        }}
      >
        <Band grow={grow}>
          <SeatLabel text="Bot" highlight={state.toAct === 'bot'} />
          <BotRow
            state={state}
            aiming={aiming}
            torpedoTarget={torpedoTarget}
            onAim={setTorpedoTarget}
          />
        </Band>

        <FeltDivider />

        <Band grow={grow}>
          <SeatLabel text="Dadi comuni" muted />
          <CommonRow
            state={state}
            canSteal={state.phase === 'STEAL' && humanIsToAct}
            dispatch={dispatch}
          />
        </Band>

        <FeltDivider />

        <Band grow={grow}>
          <SeatLabel text="I tuoi dadi" highlight={humanIsToAct} />
          <HumanRow
            state={state}
            dispatch={dispatch}
            aiming={aiming}
            torpedoTarget={torpedoTarget}
            spongeTarget={spongeTarget}
            onSponge={setSpongeTarget}
          />
        </Band>
      </div>
    </section>
  )
}

/** Small heading above a row of dice. Highlighted when it is that seat's turn to act. */
function SeatLabel({
  text,
  muted = false,
  highlight = false,
}: {
  text: string
  muted?: boolean
  highlight?: boolean
}): JSX.Element {
  return (
    <div style={{ marginBottom: 8 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          color: highlight ? '#fbbf24' : muted ? '#64748b' : '#94a3b8',
        }}
      >
        {text}
      </span>
    </div>
  )
}

/**
 * One horizontal band of the table (a seat, or the shared felt).
 *
 * When the board stretches, bands share the spare height and centre their content — but
 * they only GROW (flex-grow), never stretch from a zero basis. Sizing them from `0` split
 * the height into three equal thirds, which on a tall screen flung the rows so far apart
 * the table stopped reading as one surface. Growing from content height keeps the rows
 * visually related while still filling the page.
 */
function Band({ grow, children }: { grow: boolean; children: ReactNode }): JSX.Element {
  return (
    <div
      style={
        grow
          ? {
              flex: '1 1 auto',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              // Cap the breathing room so a very tall viewport does not strand the rows
              // far apart. Roughly two dice tall: enough to feel airy, close enough that
              // the three bands still read as one table.
              maxHeight: 140,
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}

/** Hairline separating the three bands of the table. */
function FeltDivider(): JSX.Element {
  return (
    <div
      style={{
        height: 1,
        margin: '14px 0',
        background: 'linear-gradient(90deg, transparent, #1e293b 15%, #1e293b 85%, transparent)',
      }}
    />
  )
}

/**
 * Shared layout for the three dice rows (commons, bot, you).
 *
 * WRAPPING is the load-bearing part. A row is five dice plus a stolen die plus a hand badge, and
 * at the desktop die size that is over 500px of content — against ~295px inside the felt on a
 * phone. It used to be a non-wrapping row, so the excess did not reflow: it pushed the page
 * wider than the screen, and a mobile browser answers that by scaling the whole app down. With
 * `flexWrap` the overflow becomes a second line instead of a zoomed-out page, and the phone die
 * size (DIE_SIZE.phone) is chosen so a full row still fits on one line at 320px anyway.
 */
function diceRowStyle(phone: boolean): CSSProperties {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    columnGap: phone ? 8 : 12,
    rowGap: phone ? 10 : 12,
  }
}

/** The die edge for the current layout. */
function useDieSize(): number {
  return useIsPhone() ? DIE_SIZE.phone : DIE_SIZE.default
}

function RollOffView({ state }: { state: GameState }): JSX.Element | null {
  const dieSize = useDieSize()

  if (state.rollOff === null && state.phase !== 'ROLL_OFF') {
    return null
  }

  // Once the hand is under way the roll-off is only a memo of who won the right to
  // start, so it collapses to one line — the table below is what deserves the space.
  // The dice stay full-size only while the roll-off IS the current decision.
  const deciding = state.phase === 'ROLL_OFF'

  if (!deciding && state.rollOff !== null) {
    return (
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
        Tiro iniziale: {state.rollOff.human.value} — {state.rollOff.bot.value} · inizia{' '}
        <strong style={{ color: '#94a3b8' }}>{playerLabel(state.primary)}</strong>
      </p>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 16,
        padding: '10px 14px',
        borderRadius: 10,
        background: '#0b1220',
        border: '1px solid #1e293b',
        marginBottom: 16,
      }}
    >
      <strong style={{ fontSize: 13 }}>Tiro per iniziare</strong>
      {state.rollOff === null ? (
        <Placeholder text="Premi «Tira il dado»" />
      ) : (
        <>
          <DieView value={state.rollOff.human.value} caption="tu" size={dieSize} />
          <span style={{ color: '#64748b' }}>vs</span>
          <DieView value={state.rollOff.bot.value} caption="bot" size={dieSize} />
        </>
      )}
    </div>
  )
}

function CommonRow({
  state,
  canSteal,
  dispatch,
}: {
  state: GameState
  canSteal: boolean
  dispatch: UseGameDispatch
}): JSX.Element {
  const phone = useIsPhone()
  const dieSize = useDieSize()
  if (state.common === null) {
    return <Placeholder text="Non ancora lanciati" />
  }
  return (
    // Left-aligned like the two seat rows: the three bands share one spine so the eye can
    // compare dice across them. Centring the commons broke that alignment.
    <div style={diceRowStyle(phone)}>
      {state.common.map((die, index) => {
        const taken = state.stolenCommonIndices.includes(index)
        return (
          <DieView
            key={index}
            value={die.value}
            ability={die.ability}
            rolls={die.rolls}
            dimmed={taken}
            // 'preso' rather than 'rubato' for a taken common: the die that LEFT and the die
            // that arrived in a seat row would otherwise carry the same label, which is half
            // of why a steal reads as if nothing moved.
            caption={taken ? 'preso' : canSteal ? 'rubabile' : undefined}
            size={dieSize}
            onClick={
              canSteal && !taken
                ? () => dispatch({ type: 'STEAL', player: 'human', commonIndex: index })
                : undefined
            }
          />
        )
      })}
    </div>
  )
}

function BotRow({
  state,
  aiming = false,
  torpedoTarget = null,
  onAim,
}: {
  state: GameState
  /** The human holds a Torpedo and is choosing which of these dice to zap. */
  aiming?: boolean
  torpedoTarget?: number | null
  onAim?: (index: number) => void
}): JSX.Element {
  const hand = state.hands.bot
  // Bot dice are always visible (open information) — including one the bot itself cannot
  // see, which is exactly what a landed Nero di Seppia buys us. Those get an ink marker
  // so the ability is visibly doing something rather than being invisible to its caster.
  const blinded = new Set(hand.concealedIndices)
  const live = liveFinalHand(hand) // reuse: own4 + stolen -> Hand, if formed
  const phone = useIsPhone()
  const dieSize = useDieSize()
  return (
    <div style={diceRowStyle(phone)}>
      {hand.own === null ? (
        <Placeholder text="In attesa del lancio" />
      ) : (
        <>
          {hand.own.map((die, i) => (
            <DieView
              key={i}
              value={die.value}
              ability={die.ability}
              rolls={die.rolls}
              blindedToOpponent={blinded.has(i)}
              // Only the 4 own dice are targetable — the stolen die is fixed, as everywhere
              // else in the game.
              selected={aiming && torpedoTarget === i}
              caption={torpedoTarget === i ? 'bersaglio ⚡' : undefined}
              size={dieSize}
              onClick={aiming && onAim !== undefined ? () => onAim(i) : undefined}
            />
          ))}
          {hand.stolen ? (
            // The stolen die keeps the ability it carried among the commons, so it must
            // render with the same accent as an own special — otherwise a stolen special is
            // indistinguishable from a plain d6 and the transfer reads as if it never
            // happened. No `concealed`/`blindedToOpponent` here: concealedIndices only
            // indexes `own`, so the stolen die can never be hidden from anyone.
            <DieView
              value={hand.stolen.value}
              ability={hand.stolen.ability}
              rolls={hand.stolen.rolls}
              caption="rubato"
              size={dieSize}
            />
          ) : (
            <Placeholder text="dado rubato" />
          )}
          {live && <HandBadge label={categoryLabel(evaluateHand(live))} live ownLine={phone} />}
        </>
      )}
    </div>
  )
}

function HumanRow({
  state,
  dispatch,
  aiming = false,
  torpedoTarget = null,
  spongeTarget = null,
  onSponge,
}: {
  state: GameState
  dispatch: UseGameDispatch
  /** A Torpedo target must be chosen before the reroll can be confirmed. */
  aiming?: boolean
  torpedoTarget?: number | null
  /** The opponent ability a Dado Spugna will absorb, or null for none. Always optional. */
  spongeTarget?: AbilityId | null
  onSponge?: (ability: AbilityId | null) => void
}): JSX.Element {
  const hand = state.hands.human
  const selecting = state.phase === 'REROLL_SELECT' && state.toAct === 'human'
  const [selected, setSelected] = useState<readonly number[]>([])
  const spongeChoices = spongeableThreats(state)
  const phone = useIsPhone()
  const dieSize = useDieSize()

  // Reset selection whenever we (re)enter selection for a new hand.
  useEffect(() => {
    if (!selecting) setSelected([])
  }, [selecting, state.handNumber])

  if (hand.own === null) {
    return <Placeholder text="In attesa del lancio" />
  }

  const toggle = (i: number): void => {
    setSelected((cur) => {
      if (cur.includes(i)) return cur.filter((x) => x !== i)
      return [...cur, i] // all 4 own dice may be rerolled; only the stolen die is fixed
    })
  }

  const liveHand: Hand | null = liveFinalHand(hand)

  // In MULINELLO_SELECT the buttons below the row say what to do; this marks WHICH die they
  // act on, so the choice is not about a die the player has to hunt for. Highlighting only,
  // never clickable: the engine picks the die from the ability, not from a click.
  const mulinelloIndex =
    state.phase === 'MULINELLO_SELECT' && state.toAct === 'human'
      ? hand.own.findIndex((d) => d.ability === 'MULINELLO')
      : -1

  // Same idea for the Paguro: mark WHICH covered die the shell buttons below decide, so the
  // player connects the choice to a die on the table. Highlight only — the pick is a button,
  // and the die itself stays covered until it lands.
  const paguroIndex =
    state.phase === 'PAGURO_SELECT' && state.toAct === 'human'
      ? hand.own.findIndex((d) => d.ability === 'DADO_PAGURO')
      : -1

  return (
    <div>
      <div style={diceRowStyle(phone)}>
        {hand.own.map((die, i) => (
          <DieView
            key={i}
            value={die.value}
            ability={die.ability}
            rolls={die.rolls}
            // A concealed die stays selectable: rerolling blind is allowed by design.
            concealed={die.concealed}
            selected={
              (selecting && selected.includes(i)) || i === mulinelloIndex || i === paguroIndex
            }
            caption={
              i === mulinelloIndex
                ? `ritirabile ${abilitySpec('MULINELLO')?.icon}`
                : i === paguroIndex
                  ? `scegli al buio ${abilitySpec('DADO_PAGURO')?.icon}`
                  : undefined
            }
            size={dieSize}
            onClick={selecting ? () => toggle(i) : undefined}
          />
        ))}
        {hand.stolen ? (
          <DieView
            value={hand.stolen.value}
            ability={hand.stolen.ability}
            rolls={hand.stolen.rolls}
            caption="rubato"
            size={dieSize}
          />
        ) : (
          <Placeholder text="dado rubato" />
        )}
        {liveHand &&
          (hand.own.some((d) => d.concealed) ? (
            // One die is unknown, so the category is unknowable: showing the one computed
            // from the placeholder would be a confident lie.
            <HandBadge label="Mano incerta — un dado è nascosto" live ownLine={phone} />
          ) : (
            <HandBadge label={categoryLabel(evaluateHand(liveHand))} live ownLine={phone} />
          ))}
      </div>

      {selecting && (
        <div style={{ marginTop: 10 }}>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>
            Selezionati da rilanciare: {selected.length} / 4 (il dado rubato resta fisso)
          </span>
          {aiming && (
            <div style={{ marginTop: 4 }}>
              <Hint
                text={
                  torpedoTarget === null
                    ? '⚡ Dado Torpedo: clicca un dado del Bot da elettrizzare.'
                    : `⚡ Bersaglio: dado ${torpedoTarget + 1} del Bot — perderà 1 allo showdown.`
                }
              />
            </div>
          )}
          {spongeChoices.length > 0 && (
            // Only the abilities actually threatening this hand are offered — an empty list
            // renders nothing, which is also what happens when the Spugna sits unstolen among
            // the commons and therefore does nothing. Unlike the Torpedo there is no `disabled`
            // gate: declining to sponge is a legal move, so the choice stays optional.
            <div style={{ marginTop: 8 }}>
              <Hint
                text={`${abilitySpec('DADO_SPUGNA')?.icon} Dado Spugna: scegli un'abilità del Bot da annullare (facoltativo).`}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {spongeChoices.map((id) => (
                  <AbilityCard
                    key={id}
                    id={id}
                    active={spongeTarget === id}
                    onToggle={() => onSponge?.(spongeTarget === id ? null : id)}
                  />
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            <PrimaryButton
              // The engine ASSERTS that a Torpedo holder picks a target, so block the click
              // rather than let it throw: the UI anticipates the rule, it does not own it.
              disabled={aiming && torpedoTarget === null}
              onClick={() => {
                dispatch({
                  type: 'REROLL',
                  player: 'human',
                  ownIndices: selected,
                  ...(aiming && torpedoTarget !== null ? { torpedoTarget } : {}),
                  ...(spongeTarget !== null ? { spongeTarget } : {}),
                })
                setSelected([])
              }}
            >
              Conferma rilancio
            </PrimaryButton>
          </div>
        </div>
      )}
    </div>
  )
}

function HandBadge({
  label,
  live = false,
  ownLine = false,
}: {
  label: string
  live?: boolean
  /**
   * Put the badge on its own line below the dice instead of at the end of their row.
   *
   * Used on phones. The badge's text is the longest thing in the row — "Mano incerta — un dado è
   * nascosto" runs ~250px — so beside the dice it either wraps into a tall blob or pushes the row
   * past the screen. A `flexBasis: 100%` item takes a full flex line, which is how it drops below
   * without either row needing a different structure.
   */
  ownLine?: boolean
}): JSX.Element {
  const pill = (
    <span
      style={{
        // inline-BLOCK, not inline: an inline span that has to wrap is split into two boxes, so
        // the rounded background tore into two half-pills mid-sentence. As a block the text wraps
        // inside one pill. Visible on the longest label, "Mano incerta — un dado è nascosto".
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        background: live ? '#164e63' : '#3f3f46',
        color: '#e2e8f0',
      }}
    >
      {live ? 'Mano attuale: ' : ''}
      {label}
    </span>
  )
  if (ownLine) {
    // The wrapper takes the line; the pill inside keeps hugging its text rather than stretching
    // into a full-width bar.
    return <div style={{ flexBasis: '100%', minWidth: 0 }}>{pill}</div>
  }
  return <span style={{ marginLeft: 8 }}>{pill}</span>
}

function Placeholder({ text }: { text: string }): JSX.Element {
  return <span style={{ color: '#64748b', fontSize: 13, fontStyle: 'italic' }}>{text}</span>
}

// ---------------------------------------------------------------------------
// Contextual controls
// ---------------------------------------------------------------------------

function Controls({
  state,
  dispatch,
  onNewMatch,
  onRebuildDeck,
}: {
  state: GameState
  dispatch: UseGameDispatch
  onNewMatch: () => void
  onRebuildDeck: () => void
}): JSX.Element {
  const rowStyle = { display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' as const }

  if (state.phase === 'MATCH_OVER') {
    // The winner headline is shown by OutcomeBanner; here we only offer a restart. "Nuova
    // partita" keeps the deck (and re-rolls the bot's); "Cambia mazzo" goes back to the
    // builder, since a deck is fixed for the whole match by design.
    return (
      <div style={rowStyle}>
        <PrimaryButton onClick={onNewMatch}>Nuova partita</PrimaryButton>
        <SecondaryButton onClick={onRebuildDeck}>Cambia mazzo</SecondaryButton>
      </div>
    )
  }

  if (state.phase === 'HAND_COMPLETE') {
    return (
      <div style={rowStyle}>
        <PrimaryButton onClick={() => dispatch({ type: 'NEXT_HAND' })}>
          Mano successiva
        </PrimaryButton>
      </div>
    )
  }

  // ROLL_OFF: the human rolls to decide who starts. (System roll — no per-player turn.)
  if (state.phase === 'ROLL_OFF') {
    return (
      <div style={rowStyle}>
        <PrimaryButton onClick={() => dispatch({ type: 'ROLL_OFF' })}>
          Tira il dado
        </PrimaryButton>
      </div>
    )
  }

  if (state.toAct !== 'human') {
    return (
      <div style={rowStyle}>
        <span style={{ color: '#94a3b8' }}>In attesa del Bot…</span>
      </div>
    )
  }

  // Human's turn in a betting phase: free-amount open / call / raise, plus fold in the
  // second round. No check. A player with nothing left is never asked for chips: the
  // engine skips the round entirely when neither side can wager.
  if (state.phase === 'INITIAL_BET' || state.phase === 'SECOND_BET') {
    return <BettingControls state={state} dispatch={dispatch} />
  }

  // STEAL / REROLL_SELECT are driven inline on the dice; nudge the player.
  if (state.phase === 'STEAL') {
    return <Hint text="Clicca un dado comune per rubarlo." />
  }
  if (state.phase === 'REROLL_SELECT') {
    return <Hint text="Seleziona i dadi da rilanciare (puoi rilanciarli tutti tranne il rubato), poi conferma." />
  }

  // MULINELLO_SELECT: unlike STEAL and REROLL_SELECT this is NOT driven inline on the dice.
  // The choice is about one specific die the engine already identifies, so there is nothing
  // to pick — only to accept or decline, which is a pair of buttons.
  if (state.phase === 'MULINELLO_SELECT') {
    return (
      <div style={rowStyle}>
        <PrimaryButton onClick={() => dispatch({ type: 'MULINELLO_ROLL', player: 'human' })}>
          Ritira il dado {abilitySpec('MULINELLO')?.icon}
        </PrimaryButton>
        <SecondaryButton onClick={() => dispatch({ type: 'MULINELLO_PASS', player: 'human' })}>
          Tieni così
        </SecondaryButton>
      </div>
    )
  }

  // PAGURO_SELECT: three covered "shells" to pick from, blind. Like the Mulinello this is not
  // driven on the dice in hand (the Paguro's three faces are not among them) — it is a choice
  // among three hidden faces, so three identical covered buttons carry it. The faces stay
  // secret until the pick lands: nothing here reads their values.
  if (state.phase === 'PAGURO_SELECT') {
    return (
      <div>
        <Hint
          text={`${abilitySpec('DADO_PAGURO')?.icon} Dado Paguro: scegli una delle tre conchiglie… al buio!`}
        />
        <div style={rowStyle}>
          {[0, 1, 2].map((index) => (
            <PrimaryButton
              key={index}
              onClick={() => dispatch({ type: 'PAGURO_CHOOSE', player: 'human', index })}
            >
              Conchiglia {index + 1} {abilitySpec('DADO_PAGURO')?.icon}
            </PrimaryButton>
          ))}
        </div>
      </div>
    )
  }
  return <span />
}

function Hint({ text }: { text: string }): JSX.Element {
  return <p style={{ color: '#fbbf24', fontSize: 14, marginTop: 16 }}>{text}</p>
}

/**
 * Free-amount betting controls for the human. No check; fold only in the second round
 * while facing a bet:
 *  - If the round is not opened yet (human is primary), they must OPEN with an amount
 *    >= the phase minimum.
 *  - If facing a bet, they may CALL (match) or RAISE to a higher amount.
 * The amount field is bounded to the player's bankroll.
 */
function BettingControls({
  state,
  dispatch,
}: {
  state: GameState
  dispatch: UseGameDispatch
}): JSX.Element {
  const isOpening = state.aggressor === null // human is the primary opening this round
  const phaseMin = state.phase === 'SECOND_BET' ? state.firstBetAmount : state.config.minBet
  // The engine waives the minimum for a player shoving their whole (effective) stack, so
  // mirror that here or the UI would demand a bet the rules no longer require.
  const maxAmount = maxBetFor(state, 'human')
  const rawMin = isOpening ? phaseMin : state.currentBet + state.config.minBet
  const minAmount = Math.min(rawMin, maxAmount)
  const canRaise =
    !isOpening &&
    state.raisesThisWindow < state.config.maxRaisesPerWindow &&
    maxAmount > state.currentBet
  // Folding is legal only in the second round while facing someone else's bet.
  const canFold =
    state.phase === 'SECOND_BET' && state.aggressor !== null && state.aggressor !== 'human'

  const [amount, setAmount] = useState<number>(minAmount)

  // Keep the amount within [minAmount, maxAmount] as context changes.
  useEffect(() => {
    setAmount((a) => Math.max(minAmount, Math.min(maxAmount, a)))
  }, [minAmount, maxAmount])

  const owed = state.currentBet - state.hands.human.committed
  const rowStyle = { display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' as const }
  return (
    <div style={rowStyle}>
      {state.phase === 'SECOND_BET' && (
        // The one fact that decides how much this bet is worth risking: the reroll is still
        // entirely ahead of you, so these five dice are a starting point, not a result.
        <span style={{ flexBasis: '100%', fontSize: 13, color: '#fbbf24' }}>
          Punti <strong>prima</strong> del rilancio: dopo la scommessa potrai ritirare fino a 4
          dei tuoi dadi.
        </span>
      )}
      {!isOpening && (
        <PrimaryButton onClick={() => dispatch({ type: 'CALL', player: 'human' })}>
          Vedi (paga {Math.min(owed, state.bankroll.human)} monete)
          {owed > state.bankroll.human ? ' — all-in' : ''}
        </PrimaryButton>
      )}

      {canFold && (
        <SecondaryButton onClick={() => dispatch({ type: 'FOLD', player: 'human' })}>
          Lascia la mano
        </SecondaryButton>
      )}

      {(isOpening || canRaise) && (
        <>
          <label style={{ fontSize: 13, color: '#94a3b8' }}>
            {isOpening ? 'Punta' : 'Rilancia a'}:
            <input
              type="number"
              min={minAmount}
              max={maxAmount}
              step={state.config.minBet}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              // `max` on a number input is only a hint — typing past it still fires
              // onChange. Clamping on blur (rather than on every keystroke) snaps the
              // field back into range without fighting the user mid-typing.
              onBlur={() => setAmount((a) => clamp(a, minAmount, maxAmount))}
              style={{
                width: 96,
                marginLeft: 8,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#0b1220',
                color: '#e2e8f0',
                // 16px is not a style choice: iOS Safari ZOOMS THE PAGE IN when a focused input's
                // text is smaller than 16px, and it does not zoom back out on blur. At 15px this
                // field left the player stranded in a magnified layout mid-bet.
                fontSize: 16,
                minHeight: 44,
              }}
            />
          </label>
          <PrimaryButton
            disabled={!Number.isFinite(amount) || amount < minAmount || amount > maxAmount}
            onClick={() => {
              // Clamp again at dispatch: a click can land without the field ever blurring.
              const bet = clamp(amount, minAmount, maxAmount)
              setAmount(bet)
              dispatch(
                isOpening
                  ? { type: 'OPEN', player: 'human', amount: bet }
                  : { type: 'RAISE', player: 'human', amount: bet },
              )
            }}
          >
            {isOpening ? `Punta ${amount} monete` : `Rilancia a ${amount}`}
          </PrimaryButton>
        </>
      )}

      <span style={{ fontSize: 12, color: '#64748b' }}>
        {maxAmount <= 0
          ? 'Sei all-in: non hai altre monete da puntare.'
          : `(min ${minAmount}, max ${maxAmount} monete${
              maxAmount < state.bankroll.human + state.hands.human.committed
                ? ' — limitato dallo stack avversario'
                : ''
            })`}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Action log
// ---------------------------------------------------------------------------

/**
 * Running commentary, in the reference column under the ability catalogue.
 *
 * Auto-scrolls to the newest line: in a sidebar the panel is short, so without this the
 * latest event — the one you actually need — would sit out of sight below the fold.
 */
function ActionLog({
  log,
  grow = false,
}: {
  log: readonly string[]
  /** Fill the remaining sidebar height instead of sizing to content. */
  grow?: boolean
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = boxRef.current
    if (box !== null) {
      box.scrollTop = box.scrollHeight
    }
  }, [log])

  return (
    <section
      style={{
        padding: 14,
        borderRadius: 12,
        background: '#0b1220',
        border: '1px solid #1e293b',
        minWidth: 0,
        // Stretching to the bottom of the page: the panel grows, and the scrollable list
        // inside it grows with it (see maxHeight below).
        ...(grow
          ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
          : null),
      }}
    >
      <h2
        style={{
          margin: '0 0 8px',
          fontSize: 14,
          fontWeight: 700,
          color: '#94a3b8',
          letterSpacing: 0.3,
        }}
      >
        Log
      </h2>
      <div
        ref={boxRef}
        style={{
          overflowY: 'auto',
          // 13, not 12: this is running prose on a phone, and it is the only record of what the
          // bot did.
          fontSize: 13,
          lineHeight: 1.6,
          // Long log lines must wrap inside the narrow column rather than widen it.
          overflowWrap: 'anywhere',
          // Growing: take whatever height the panel has. Otherwise cap it, so a long log
          // does not push the page down on a stacked layout. The cap stays even on a phone:
          // unlike the reference panel the log GROWS all match, so uncapped it would turn the
          // opened disclosure into an endless scroll.
          ...(grow ? { flex: 1, minHeight: 0 } : { maxHeight: 260 }),
        }}
      >
        {log.map((line, i) => (
          <div
            key={i}
            style={{
              color: i === log.length - 1 ? '#e2e8f0' : '#64748b',
              fontWeight: i === log.length - 1 ? 600 : 400,
              paddingBottom: 3,
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonProps = { onClick: () => void; children: ReactNode; disabled?: boolean }

const baseButton: CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  border: 'none',
  // 15px text with 10px padding computed to a ~38px control — under the 44px minimum a thumb
  // needs. The floor is set here, on the shared base, so every button in the app clears it
  // rather than each call site remembering to.
  minHeight: 44,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
}

function PrimaryButton({ onClick, children, disabled = false }: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...baseButton,
        background: disabled ? '#1e293b' : '#2563eb',
        color: disabled ? '#64748b' : 'white',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

/** Muted button for the destructive/retreating choice, so it never outshines the bet. */
function SecondaryButton({ onClick, children, disabled = false }: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...baseButton,
        background: 'transparent',
        color: disabled ? '#475569' : '#94a3b8',
        border: `1px solid ${disabled ? '#1e293b' : '#475569'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

/** Constrains `n` to [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// ---------------------------------------------------------------------------
// Local helpers (presentation only)
// ---------------------------------------------------------------------------

type UseGameDispatch = ReturnType<typeof useGame>['dispatch']

/**
 * Whether the human holds a Dado Torpedo — among their own dice or as their stolen die.
 *
 * Mirrors the reducer's `seatHolds`, which is the authority: this only decides whether to
 * OFFER the aiming UI. The engine asserts the rule regardless of what the UI does.
 */
function humanHoldsTorpedo(state: GameState): boolean {
  return humanHolds(state, 'DADO_TORPEDO')
}

/** Whether the human holds `ability`, among their own dice or as their stolen die. */
function humanHolds(state: GameState, ability: AbilityId): boolean {
  const hand = state.hands.human
  return (
    (hand.own ?? []).some((d) => d.ability === ability) || hand.stolen?.ability === ability
  )
}

/**
 * The spongeable abilities actually threatening the human right now — the only ones worth
 * offering as Spugna targets.
 *
 * Empty when the human holds no Spugna, so the picker disappears rather than presenting a
 * choice with no effect. That also covers the "unstolen among the commons" case, where the
 * engine ignores the target anyway.
 *
 * An ability threatens us if the Bot holds it OR it sits unstolen among the commons, since
 * several table effects hit both seats. Presentation only: the reducer decides what a sponge
 * actually does, and rejects a non-spongeable target regardless of what this offers.
 */
function spongeableThreats(state: GameState): readonly AbilityId[] {
  if (!humanHolds(state, 'DADO_SPUGNA')) {
    return []
  }
  const bot = state.hands.bot
  return ALL_ABILITY_IDS.filter((id) => {
    // isSpongeable, not a local list: what a sponge can absorb is a RULE, and the engine owns
    // it. A copy here would drift the moment an ability's spec changes.
    if (id === 'DADO_SPUGNA' || !isSpongeable(id)) {
      return false
    }
    const botHolds =
      (bot.own ?? []).some((d) => d.ability === id) || bot.stolen?.ability === id
    const onTable = (state.common ?? []).some(
      (d, i) => d.ability === id && !state.stolenCommonIndices.includes(i),
    )
    return botHolds || onTable
  })
}

function liveFinalHand(hand: PlayerHandState): Hand | null {
  if (hand.own === null || hand.stolen === null) return null
  return [hand.own[0], hand.own[1], hand.own[2], hand.own[3], hand.stolen]
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
