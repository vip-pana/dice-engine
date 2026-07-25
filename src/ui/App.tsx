import { useEffect, useState, type JSX, type ReactNode, type CSSProperties } from 'react'
import {
  abilitySpec,
  ALL_ABILITY_IDS,
  chooseAction,
  evaluateHand,
  createRng,
  DEFAULT_ABILITY_DROPS,
  maxBetFor,
  viewFor,
  type AbilityId,
  type GameState,
  type Hand,
  type PlayerHandState,
} from '../engine'
import { useGame } from './useGame'
import { categoryLabel, playerLabel } from './labels'
import { DieView, ABILITY_ACCENT, ACCENT_BY_KIND } from './components/DieView'

// A single Rng dedicated to the BOT's decision-making, kept separate from the match Rng
// so the bot's internal sampling never disturbs the dice stream. Randomly seeded so the
// bot does not make the exact same reroll choices on every page load.
const botBrainRng = createRng(Math.floor(Math.random() * 2 ** 31))

export function App(): JSX.Element {
  // Neither seat is pinned, so both draw fresh random specials every hand at the default
  // drop rates. Pass `loadouts` here instead to pin a seat to a fixed set for playtesting.
  // No seed: every reload deals a different match. Pass one to replay a specific game.
  const { state: trueState, dispatch, newMatch } = useGame(undefined, {
    abilityDrops: DEFAULT_ABILITY_DROPS,
  })
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
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: wide ? 'minmax(0, 720px) minmax(240px, 300px)' : 'minmax(0, 1fr)',
          gap: 24,
          alignItems: 'start',
          maxWidth: 1100,
          margin: '0 auto',
          padding: '1.5rem',
        }}
      >
        <main style={{ minWidth: 0 }}>
          <h1 style={{ marginTop: 0 }}>Poker di Dadi</h1>
          <ScoreBar state={state} />
          <BotAutoPlayer state={trueState} dispatch={dispatch} />
          <Table state={state} dispatch={dispatch} />
          <OutcomeBanner state={state} />
          <Controls state={state} dispatch={dispatch} onNewMatch={() => newMatch()} />
          <ActionLog log={state.log} />
        </main>
        <AbilitySidebar state={state} sticky={wide} />
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
function AbilitySidebar({
  state,
  sticky,
}: {
  state: GameState
  sticky: boolean
}): JSX.Element {
  const { ownChance, commonChance, pool } = state.abilityDrops
  const dropsOn = ownChance > 0 || commonChance > 0

  return (
    <aside
      style={{
        position: sticky ? 'sticky' : 'static',
        top: 24,
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
        {dropsOn ? (
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
          <AbilityCard key={id} id={id} active={dropsOn && pool.includes(id)} />
        ))}
      </div>
    </aside>
  )
}

/** One entry in the catalogue: icon, name, rules text. Dimmed when it cannot drop. */
function AbilityCard({ id, active }: { id: AbilityId; active: boolean }): JSX.Element | null {
  const spec = abilitySpec(id)
  if (spec === null) {
    return null
  }
  const accent = ACCENT_BY_KIND[spec.kind]

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: '9px 10px',
        borderRadius: 9,
        background: '#111c31',
        border: `1px solid ${active ? `${accent}33` : '#1e293b'}`,
        opacity: active ? 1 : 0.45,
      }}
      title={active ? spec.description : `${spec.description} (non in gioco)`}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: accent,
          color: '#0f172a',
          fontSize: 15,
          fontWeight: 800,
          lineHeight: '26px',
          textAlign: 'center',
        }}
      >
        {spec.icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{spec.name}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.45 }}>
          {spec.description}
        </div>
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>
          {spec.kind === 'malus' ? 'Malus' : 'Bonus'}
          {active ? '' : ' — non in gioco'}
        </div>
      </div>
    </div>
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
}: {
  state: GameState
  dispatch: UseGameDispatch
}): JSX.Element {
  const primaryLabel = playerLabel(state.primary)
  const humanIsToAct = state.toAct === 'human'

  return (
    <section>
      <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 0 }}>
        Primario di mano: <strong>{primaryLabel}</strong> · Fase:{' '}
        <strong>{phaseLabel(state.phase)}</strong>
      </p>

      <RollOffView state={state} />

      <h3 style={{ marginBottom: 6 }}>Dadi comuni</h3>
      <CommonRow state={state} canSteal={state.phase === 'STEAL' && humanIsToAct} dispatch={dispatch} />

      <h3 style={{ marginBottom: 6 }}>Bot</h3>
      <BotRow state={state} />

      <h3 style={{ marginBottom: 6 }}>I tuoi dadi</h3>
      <HumanRow state={state} dispatch={dispatch} />
    </section>
  )
}

function RollOffView({ state }: { state: GameState }): JSX.Element | null {
  // Show the roll-off dice while deciding, and keep them visible through the hand so the
  // player remembers who won the right to start.
  if (state.rollOff === null && state.phase !== 'ROLL_OFF') {
    return null
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
          {state.phase !== 'ROLL_OFF' && (
            <span style={{ fontSize: 13, color: '#94a3b8' }}>
              Inizia <strong style={{ color: '#e2e8f0' }}>{playerLabel(state.primary)}</strong>
            </span>
          )}
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
    <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
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
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
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
    <div style={{ marginBottom: 12 }}>
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
}: {
  state: GameState
  dispatch: UseGameDispatch
  onNewMatch: () => void
}): JSX.Element {
  const rowStyle = { display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' as const }

  if (state.phase === 'MATCH_OVER') {
    // The winner headline is shown by OutcomeBanner; here we only offer a restart.
    return (
      <div style={rowStyle}>
        <PrimaryButton onClick={onNewMatch}>Nuova partita</PrimaryButton>
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

function ActionLog({ log }: { log: readonly string[] }): JSX.Element {
  return (
    <section style={{ marginTop: 24 }}>
      <h3 style={{ marginBottom: 6 }}>Log</h3>
      <div
        style={{
          maxHeight: 180,
          overflowY: 'auto',
          background: '#1e293b',
          borderRadius: 10,
          padding: '10px 14px',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        {log.map((line, i) => (
          <div key={i} style={{ color: i === log.length - 1 ? '#e2e8f0' : '#94a3b8' }}>
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
