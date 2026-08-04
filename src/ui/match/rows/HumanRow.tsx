import { useEffect, useState, type JSX } from 'react'
import { abilitySpec, evaluateHand, type AbilityId, type GameState, type Hand } from '../../../engine'
import { categoryLabel } from '../../labels'
import { useIsPhone } from '../../responsive'
import { DieView } from '../../components/DieView'
import { Hint, PrimaryButton } from '../../components/Buttons'
import { liveFinalHand, type UseGameDispatch } from '../../handState'
import { EmptyDieSlot, HandBadge, Placeholder, diceRowStyle, useDieSize } from './shared'

export function HumanRow({
  state,
  dispatch,
  aiming = false,
  torpedoTarget = null,
  spongeTarget = null,
}: {
  state: GameState
  dispatch: UseGameDispatch
  /** A Torpedo target must be chosen before the reroll can be confirmed. */
  aiming?: boolean
  /**
   * The two values STAGED in the ability menu. They are chosen there but sent from here, because
   * they are optional fields on the same REROLL action that carries the dice to throw — see
   * RerollAction. This row is the only place that dispatches one.
   */
  torpedoTarget?: number | null
  spongeTarget?: AbilityId | null
}): JSX.Element {
  const hand = state.hands.human
  const selecting = state.phase === 'REROLL_SELECT' && state.toAct === 'human'
  const [selected, setSelected] = useState<readonly number[]>([])
  const phone = useIsPhone()
  const dieSize = useDieSize()

  // Reset selection whenever we (re)enter selection for a new hand.
  useEffect(() => {
    if (!selecting) setSelected([])
  }, [selecting, state.handNumber])

  if (hand.own === null) {
    // Centred where the dice will be, like BotRow's own waiting state (which already sits inside
    // the row style).
    return (
      <div style={diceRowStyle(phone)}>
        <Placeholder text="In attesa del lancio" />
      </div>
    )
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
          <EmptyDieSlot text="dado rubato" size={dieSize} />
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
        // Centred with the dice it acts on: the count, the hints and the confirm button all
        // belong to the row above them, so they share its middle.
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>
            Selezionati da rilanciare: {selected.length} / 4 (il dado rubato resta fisso)
          </span>
          {aiming && (
            // The aim itself is made in the ability menu (see AbilityModal); this only reports
            // where it stands. Without the "not yet" line the confirm button below is disabled
            // for a reason the player cannot see.
            <div style={{ marginTop: 4 }}>
              <Hint
                text={
                  torpedoTarget === null
                    ? '⚡ Devi scegliere un bersaglio: apri «Usa abilità».'
                    : `⚡ Bersaglio: dado ${torpedoTarget + 1} del Bot — perderà 1 allo showdown.`
                }
              />
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
