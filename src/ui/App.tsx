import { useEffect, useRef, useState, type JSX, type ReactNode, type CSSProperties } from 'react'
import {
  ALL_ABILITY_IDS,
  chooseAction,
  evaluateHand,
  createRng,
  DECK_SIZE,
  DEFAULT_ABILITY_DROPS,
  HAND_SIZE,
  deckSpecials,
  maxBetFor,
  rollBotDeck,
  viewFor,
  type AbilityId,
  type Deck,
  type GameState,
  type Hand,
  type NewGameOptions,
  type PlayerHandState,
  type Rng,
} from '../engine'
import { useGame } from './useGame'
import { categoryLabel, playerLabel } from './labels'
import { AbilityCard } from './components/AbilityCard'
import { DeckBuilder } from './components/DeckBuilder'
import { DeckPreview } from './components/DeckPreview'
import { DieView, ABILITY_ACCENT } from './components/DieView'

// A single Rng dedicated to the BOT's decision-making, kept separate from the match Rng
// so the bot's internal sampling never disturbs the dice stream. Randomly seeded so the
// bot does not make the exact same reroll choices on every page load.
const botBrainRng = createRng(Math.floor(Math.random() * 2 ** 31))

/**
 * Gates the deck builder in front of the match.
 *
 * `Match` mounts only once a deck exists, so `useGame`'s eager state initializer always
 * sees a real deck — no `GameState | null` has to be threaded through the whole tree. The
 * `key` forces a fresh mount (and thus a fresh match) whenever the deck changes.
 */
export function App(): JSX.Element {
  const [deck, setDeck] = useState<Deck | null>(null)

  if (deck === null) {
    return <DeckBuilder onConfirm={setDeck} />
  }
  return <Match key={deckKey(deck)} deck={deck} onRebuild={() => setDeck(null)} />
}

/** Stable identity for a deck, used to remount Match when the player rebuilds. */
function deckKey(deck: Deck): string {
  return deck.map((id) => id ?? '-').join('|')
}

/**
 * Match options for a chosen deck.
 *
 * A factory, not a plain object: the bot's deck is rolled from the MATCH Rng so that one
 * seed reproduces the whole match including both decks. `commonChance` stays live — common
 * dice belong to nobody and are never part of a deck — while `ownChance` is 0 because own
 * dice now come from the deck (deck mode ignores it either way; 0 is honesty, not effect).
 */
function optionsForDeck(deck: Deck): (rng: Rng) => NewGameOptions {
  return (rng) => ({
    decks: { human: deck, bot: rollBotDeck(rng, deck) },
    abilityDrops: { ...DEFAULT_ABILITY_DROPS, ownChance: 0 },
  })
}

function Match({
  deck,
  onRebuild,
}: {
  deck: Deck
  onRebuild: () => void
}): JSX.Element {
  // No seed: every match deals differently. Pass one to replay a specific game.
  const { state: trueState, dispatch, newMatch } = useGame(undefined, optionsForDeck(deck))
  const wide = useIsWide()

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
        minHeight: '100vh',
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
          gap: 24,
          alignItems: 'stretch',
          maxWidth: 1100,
          margin: '0 auto',
          padding: '1.5rem',
          // `box-sizing: border-box` so the padding sits INSIDE the 100vh rather than
          // adding to it — otherwise the page scrolls by exactly the padding.
          ...(wide ? { height: '100vh', boxSizing: 'border-box' as const } : null),
        }}
      >
        <main style={{ minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h1 style={{ marginTop: 0 }}>Poker di Dadi</h1>
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
        </main>
        {/* Reference column: your deck, what the special dice do, then the running log. */}
        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <DeckPanel
            deck={deck}
            onRebuildDeck={onRebuild}
            matchInProgress={state.phase !== 'MATCH_OVER'}
          />
          <AbilitySidebar state={state} />
          {/* Takes the remaining height, so the log reaches the bottom of the page. */}
          <ActionLog log={state.log} grow={wide} />
        </aside>
      </div>
    </div>
  )
}

/** Breakpoint below which the sidebar stacks under the game instead of sitting beside it. */
const WIDE_BREAKPOINT = 1024

/**
 * Tracks whether the viewport is wide enough for the two-column layout.
 *
 * A matchMedia hook rather than a stylesheet because this app styles everything inline;
 * adding a single CSS file just for one breakpoint would split where layout lives.
 */
function useIsWide(): boolean {
  const query = `(min-width: ${WIDE_BREAKPOINT}px)`
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent): void => setWide(e.matches)
    setWide(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return wide
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
  return (
    <section
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 10,
        background: '#1e293b',
        marginBottom: 16,
      }}
    >
      <Stat label="Mano" value={`${state.handNumber}`} />
      <Stat label="Punteggio (Bo3)" value={`${state.score.human} - ${state.score.bot}`} />
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
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
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
// Ability legend: the special dice that can turn up, and how often
// ---------------------------------------------------------------------------

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
function AbilitySidebar({ state }: { state: GameState }): JSX.Element {
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
    <section
      style={{
        padding: 14,
        borderRadius: 12,
        background: '#0b1220',
        border: `1px solid ${ABILITY_ACCENT}44`,
      }}
    >
      <h2
        style={{
          margin: '0 0 4px',
          fontSize: 14,
          fontWeight: 700,
          color: ABILITY_ACCENT,
          letterSpacing: 0.3,
        }}
      >
        Dadi speciali
      </h2>

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
    </section>
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
    </section>
  )
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
  const humanIsToAct = state.toAct === 'human'

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
          padding: '14px 16px',
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
          <BotRow state={state} />
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
          <HumanRow state={state} dispatch={dispatch} />
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

function RollOffView({ state }: { state: GameState }): JSX.Element | null {
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
          <DieView value={state.rollOff.human.value} caption="tu" />
          <span style={{ color: '#64748b' }}>vs</span>
          <DieView value={state.rollOff.bot.value} caption="bot" />
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
  if (state.common === null) {
    return <Placeholder text="Non ancora lanciati" />
  }
  return (
    // Left-aligned like the two seat rows: the three bands share one spine so the eye can
    // compare dice across them. Centring the commons broke that alignment.
    <div style={{ display: 'flex', gap: 12 }}>
      {state.common.map((die, index) => {
        const taken = state.stolenCommonIndices.includes(index)
        return (
          <DieView
            key={index}
            value={die.value}
            ability={die.ability}
            rolls={die.rolls}
            dimmed={taken}
            caption={taken ? 'rubato' : canSteal ? 'rubabile' : undefined}
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

function BotRow({ state }: { state: GameState }): JSX.Element {
  const hand = state.hands.bot
  // Bot dice are always visible (open information) — including one the bot itself cannot
  // see, which is exactly what a landed Nero di Seppia buys us. Those get an ink marker
  // so the ability is visibly doing something rather than being invisible to its caster.
  const blinded = new Set(hand.concealedIndices)
  const live = liveFinalHand(hand) // reuse: own4 + stolen -> Hand, if formed
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
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
            />
          ))}
          {hand.stolen ? (
            <DieView value={hand.stolen.value} caption="rubato" />
          ) : (
            <Placeholder text="dado rubato" />
          )}
          {live && <HandBadge label={categoryLabel(evaluateHand(live))} live />}
        </>
      )}
    </div>
  )
}

function HumanRow({
  state,
  dispatch,
}: {
  state: GameState
  dispatch: UseGameDispatch
}): JSX.Element {
  const hand = state.hands.human
  const selecting = state.phase === 'REROLL_SELECT' && state.toAct === 'human'
  const [selected, setSelected] = useState<readonly number[]>([])

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

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {hand.own.map((die, i) => (
          <DieView
            key={i}
            value={die.value}
            ability={die.ability}
            rolls={die.rolls}
            // A concealed die stays selectable: rerolling blind is allowed by design.
            concealed={die.concealed}
            selected={selecting && selected.includes(i)}
            onClick={selecting ? () => toggle(i) : undefined}
          />
        ))}
        {hand.stolen ? (
          <DieView value={hand.stolen.value} caption="rubato" />
        ) : (
          <Placeholder text="dado rubato" />
        )}
        {liveHand &&
          (hand.own.some((d) => d.concealed) ? (
            // One die is unknown, so the category is unknowable: showing the one computed
            // from the placeholder would be a confident lie.
            <HandBadge label="Mano incerta — un dado è nascosto" live />
          ) : (
            <HandBadge label={categoryLabel(evaluateHand(liveHand))} live />
          ))}
      </div>

      {selecting && (
        <div style={{ marginTop: 10 }}>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>
            Selezionati da rilanciare: {selected.length} / 4 (il dado rubato resta fisso)
          </span>
          <div style={{ marginTop: 6 }}>
            <PrimaryButton
              onClick={() => {
                dispatch({ type: 'REROLL', player: 'human', ownIndices: selected })
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

function HandBadge({ label, live = false }: { label: string; live?: boolean }): JSX.Element {
  return (
    <span
      style={{
        marginLeft: 8,
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
                width: 90,
                marginLeft: 8,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#0b1220',
                color: '#e2e8f0',
                fontSize: 15,
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
          fontSize: 12,
          lineHeight: 1.6,
          // Long log lines must wrap inside the narrow column rather than widen it.
          overflowWrap: 'anywhere',
          // Growing: take whatever height the panel has. Otherwise cap it, so a long log
          // does not push the page down on a stacked/mobile layout.
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
