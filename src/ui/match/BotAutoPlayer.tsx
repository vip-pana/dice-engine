import { useEffect } from 'react'
import { chooseAction, createRng, type Difficulty, type GameState } from '../../engine'

// A single Rng dedicated to the BOT's decision-making, kept separate from the match Rng
// so the bot's internal sampling never disturbs the dice stream. Randomly seeded so the
// bot does not make the exact same reroll choices on every page load.
const botBrainRng = createRng(Math.floor(Math.random() * 2 ** 31))

/**
 * Whenever it is the bot's turn, dispatch its chosen action.
 *
 * Pure orchestration — the DECISION lives in the engine's chooseAction.
 */
export function BotAutoPlayer(props: {
  state: GameState
  dispatch: (a: ReturnType<typeof chooseAction>) => void
  /** How well this bot plays. Chosen before the match; see difficulty.ts. */
  difficulty: Difficulty
}): null {
  const { state, dispatch, difficulty } = props
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
      dispatch(chooseAction(state, 'bot', botBrainRng, difficulty))
    }, 500)
    return () => clearTimeout(id)
  }, [state, dispatch, difficulty])
  return null
}
