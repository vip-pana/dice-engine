import { useEffect, useState, type JSX } from 'react'
import { maxBetFor, type GameState } from '../../engine'
import { Hint, PrimaryButton, SecondaryButton } from '../components/Buttons'
import type { UseGameDispatch } from '../handState'

const rowStyle = { display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' as const }

export function Controls({
  state,
  dispatch,
  showTerminalButtons = true,
  onNewMatch,
  onRebuildDeck,
}: {
  state: GameState
  dispatch: UseGameDispatch
  /**
   * Whether to render the end-of-hand / end-of-match buttons here.
   *
   * False while OutcomeBanner is up, because that overlay holds the same buttons — the click that
   * closes the result is the click that continues. They still belong here for when the player
   * dismisses the overlay to look at the final dice: without them there would be no way on.
   */
  showTerminalButtons?: boolean
  onNewMatch: () => void
  onRebuildDeck: () => void
}): JSX.Element | null {
  // MATCH_OVER and HAND_COMPLETE are driven from inside OutcomeBanner, which holds "Nuova
  // partita" / "Cambia mazzo" / "Mano successiva". Duplicating them here would put the same
  // action in two places, and the copy under the felt would be the one hidden behind the
  // overlay. What stays here is the case where the banner has been dismissed by hand — then
  // there has to be a way on that is not behind a closed overlay.
  if (state.phase === 'MATCH_OVER') {
    if (!showTerminalButtons) {
      return null
    }
    return (
      <div style={rowStyle}>
        <PrimaryButton onClick={onNewMatch}>Nuova partita</PrimaryButton>
        <SecondaryButton onClick={onRebuildDeck}>Cambia mazzo</SecondaryButton>
      </div>
    )
  }

  if (state.phase === 'HAND_COMPLETE') {
    if (!showTerminalButtons) {
      return null
    }
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
        <PrimaryButton onClick={() => dispatch({ type: 'ROLL_OFF' })}>Tira il dado</PrimaryButton>
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
    return (
      <Hint text="Seleziona i dadi da rilanciare (puoi rilanciarli tutti tranne il rubato), poi conferma." />
    )
  }

  // MULINELLO_SELECT and PAGURO_SELECT are both answered in the ability menu now, which opens
  // itself on arrival (see AbilityBar): every ability is used the same way, from one place. What
  // stays here is the pointer, so a phase whose controls live in an overlay still says where.
  if (state.phase === 'MULINELLO_SELECT') {
    return <Hint text="🎣 Dado Mulinello: apri «Usa abilità» per ritirare il dado o tenerlo." />
  }
  if (state.phase === 'PAGURO_SELECT') {
    return <Hint text="🦀 Dado Paguro: apri «Usa abilità» per scegliere una conchiglia." />
  }
  return null
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
  const betRowStyle = {
    display: 'flex',
    gap: 10,
    marginTop: 16,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  }
  return (
    <div style={betRowStyle}>
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

/** Constrains `n` to [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
