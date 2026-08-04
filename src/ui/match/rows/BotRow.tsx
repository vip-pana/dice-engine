import type { JSX } from 'react'
import { evaluateHand, type GameState } from '../../../engine'
import { categoryLabel } from '../../labels'
import { useIsPhone } from '../../responsive'
import { DieView } from '../../components/DieView'
import { liveFinalHand } from '../../handState'
import { HandBadge, Placeholder, diceRowStyle, useDieSize } from './shared'

export function BotRow({
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
  const live = liveFinalHand(hand)
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
