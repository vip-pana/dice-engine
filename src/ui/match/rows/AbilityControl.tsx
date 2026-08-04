import type { JSX } from 'react'
import type { AbilityId, GameState } from '../../../engine'
import { AbilityCard } from '../../components/AbilityCard'
import { DieView } from '../../components/DieView'
import { Hint, PrimaryButton, SecondaryButton } from '../../components/Buttons'
import { spongeableThreats, type HeldAbility, type UseGameDispatch } from '../../handState'
import { useDieSize } from './shared'
import { LanternaPeek } from './LanternaPeek'

/**
 * The control for one actionable ability: a branch per id.
 *
 * Split out of AbilityRow, which is now only the card and its open/closed state. These five are
 * the game itself, and they are what changes when an ability does.
 */
export function AbilityControl(props: {
  ability: HeldAbility
  state: GameState
  dispatch: UseGameDispatch
  /** Closes the whole modal — used by the abilities whose dispatch ends their phase. */
  onClose: () => void
  torpedoTarget: number | null
  onAimTorpedo: (index: number) => void
  spongeTarget: AbilityId | null
  onSponge: (ability: AbilityId | null) => void
}): JSX.Element {
  const { ability, state, dispatch, onClose } = props
  switch (ability.id) {
    case 'DADO_TORPEDO':
      return (
        <TorpedoAim
          state={state}
          target={props.torpedoTarget}
          onAim={props.onAimTorpedo}
          onClose={onClose}
        />
      )
    case 'DADO_SPUGNA':
      return (
        <SpongePicker
          state={state}
          target={props.spongeTarget}
          onSponge={props.onSponge}
          onClose={onClose}
        />
      )
    case 'MULINELLO':
      return <MulinelloChoice dispatch={dispatch} onClose={onClose} />
    case 'DADO_PAGURO':
      return <PaguroShells dispatch={dispatch} onClose={onClose} />
    case 'DADO_LANTERNA':
      return <LanternaPeek state={state} dispatch={dispatch} />
  }
}

/**
 * Aim the Torpedo at one of the Bot's four own dice.
 *
 * Aimed here rather than out on the felt because this is the one choice the engine makes
 * MANDATORY (handleReroll asserts a holder names a target), and a mandatory choice has to be
 * completable where it is presented. The felt keeps working too — BotRow's dice stay clickable —
 * so the target shows in both places and either path reaches the same state.
 *
 * `explain={false}`: these dice sit inside a dialog stacked above DieTooltip's portal, so their
 * hover panel would open underneath it. The card above already carries the rules text.
 */
function TorpedoAim({
  state,
  target,
  onAim,
  onClose,
}: {
  state: GameState
  target: number | null
  onAim: (index: number) => void
  onClose: () => void
}): JSX.Element {
  const own = state.hands.bot.own
  const dieSize = useDieSize()
  if (own === null) {
    return <Hint text="I dadi del Bot non sono ancora in tavola." />
  }
  return (
    <div>
      <Hint
        text={
          target === null
            ? '⚡ Scegli quale dado del Bot elettrizzare: perderà 1 allo showdown.'
            : `⚡ Bersaglio: dado ${target + 1} del Bot. Chiudi e conferma il rilancio.`
        }
      />
      <div
        style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 8 }}
      >
        {own.map((die, i) => (
          <DieView
            key={i}
            value={die.value}
            ability={die.ability}
            rolls={die.rolls}
            selected={target === i}
            caption={target === i ? 'bersaglio ⚡' : undefined}
            size={dieSize}
            explain={false}
            onClick={() => onAim(i)}
          />
        ))}
      </div>
      {/* The aim is STAGED, not sent — the reroll carries it (see AbilityModal's doc). Once a
          target exists the next step is out on the felt, so say so and offer the way there;
          without this the player is left in a dialog with nothing left to press. */}
      {target !== null && (
        <div style={{ marginTop: 10 }}>
          <PrimaryButton onClick={onClose}>Torna al tavolo</PrimaryButton>
        </div>
      )}
    </div>
  )
}

/**
 * Pick which opponent ability the Spugna absorbs, or none.
 *
 * These cards ARE toggles, unlike the row above them: declining to sponge is a legal move, so
 * there is no disabled gate and re-clicking the choice clears it.
 */
function SpongePicker({
  state,
  target,
  onSponge,
  onClose,
}: {
  state: GameState
  target: AbilityId | null
  onSponge: (ability: AbilityId | null) => void
  onClose: () => void
}): JSX.Element {
  const choices = spongeableThreats(state)
  return (
    <div>
      <Hint
        text={
          target === null
            ? "🧽 Scegli un'abilità del Bot da annullare per questa mano (facoltativo)."
            : '🧽 Assorbita. Chiudi e conferma il rilancio.'
        }
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {choices.map((id) => (
          <AbilityCard
            key={id}
            id={id}
            active={target === id}
            inactiveNote="tocca per assorbirla"
            onToggle={() => onSponge(target === id ? null : id)}
          />
        ))}
      </div>
      {/* Staged like the aim, so the same way back to the felt. */}
      {target !== null && (
        <div style={{ marginTop: 10 }}>
          <PrimaryButton onClick={onClose}>Torna al tavolo</PrimaryButton>
        </div>
      )}
    </div>
  )
}

/** Spend or decline the Mulinello's third roll. Either answer ends the phase, so both close. */
function MulinelloChoice({
  dispatch,
  onClose,
}: {
  dispatch: UseGameDispatch
  onClose: () => void
}): JSX.Element {
  return (
    <div>
      <Hint text="🎣 Puoi ritirare il dado del Mulinello una terza volta. Il dado è evidenziato in tavola." />
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        <PrimaryButton
          onClick={() => {
            dispatch({ type: 'MULINELLO_ROLL', player: 'human' })
            onClose()
          }}
        >
          Ritira il dado 🎣
        </PrimaryButton>
        <SecondaryButton
          onClick={() => {
            dispatch({ type: 'MULINELLO_PASS', player: 'human' })
            onClose()
          }}
        >
          Tieni così
        </SecondaryButton>
      </div>
    </div>
  )
}

/**
 * The Paguro's blind pick: three identical shells.
 *
 * THE BLINDNESS IS STRUCTURAL — do not "improve" this. The labels come from a literal [0,1,2],
 * and NOTHING here may read `own[paguroIndex].rolls`: the faces are on the state and one line
 * away, and printing them (or rendering the die, which would show its split) would turn a blind
 * choice into a pick of the highest.
 */
function PaguroShells({
  dispatch,
  onClose,
}: {
  dispatch: UseGameDispatch
  onClose: () => void
}): JSX.Element {
  return (
    <div>
      <Hint text="🦀 Scegli una delle tre conchiglie… al buio!" />
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        {[0, 1, 2].map((index) => (
          <PrimaryButton
            key={index}
            onClick={() => {
              dispatch({ type: 'PAGURO_CHOOSE', player: 'human', index })
              onClose()
            }}
          >
            Conchiglia {index + 1} 🦀
          </PrimaryButton>
        ))}
      </div>
    </div>
  )
}
