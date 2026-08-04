import { useEffect, useState, type JSX } from 'react'
import { abilitySpec, evaluateHand, type AbilityId, type GameState, type Hand } from '../../../engine'
import { categoryLabel } from '../../labels'
import { useIsPhone } from '../../responsive'
import { AbilityCard } from '../../components/AbilityCard'
import { DieView } from '../../components/DieView'
import { Hint, PrimaryButton } from '../../components/Buttons'
import { liveFinalHand, spongeableThreats, type UseGameDispatch } from '../../handState'
import { HandBadge, Placeholder, diceRowStyle, useDieSize } from './shared'

export function HumanRow({
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
