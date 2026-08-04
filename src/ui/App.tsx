import { useState, type JSX } from 'react'
import type { Deck } from '../engine'
import { DeckBuilder } from './components/DeckBuilder'
import { BotDeckChooser } from './setup/BotDeckChooser'
import { setupKey, type Setup } from './setup/setup'
import { Match } from './match/Match'

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
      onConfirm={(botMode, botDeck, difficulty) => setSetup({ deck, botMode, botDeck, difficulty })}
      onBack={() => setDeck(null)}
    />
  )
}
