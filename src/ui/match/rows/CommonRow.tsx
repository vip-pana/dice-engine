import type { JSX } from 'react'
import type { GameState } from '../../../engine'
import { useIsPhone } from '../../responsive'
import { DieView } from '../../components/DieView'
import type { UseGameDispatch } from '../../handState'
import { Placeholder, diceRowStyle, useDieSize } from './shared'

export function CommonRow({
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
    // compare dice across them.
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
