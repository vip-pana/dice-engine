import { useCallback, useMemo, useRef, useState } from 'react'
import {
  createInitialState,
  reducer,
  createRng,
  type Action,
  type GameState,
  type NewGameOptions,
  type Rng,
} from '../engine'

/**
 * Owns the match state and the single injected Rng. This is the ONLY place the UI
 * touches the engine reducer. No game rules live here — it just threads actions through.
 *
 * The Rng is created once per match from a seed so a game is reproducible. All rolls in a
 * match draw from this same stream, matching the engine's determinism guarantees.
 */
/**
 * Match options, or a factory that derives them from the match Rng.
 *
 * The factory form exists for setup that must itself be random yet seed-reproducible —
 * rolling the bot's deck, for instance. Running it against the match stream keeps "one
 * seed = one match, decks included" true, which a separate Rng would break.
 */
export type GameOptionsInput = NewGameOptions | ((rng: Rng) => NewGameOptions)

export interface UseGame {
  readonly state: GameState
  readonly dispatch: (action: Action) => void
  /** Starts a fresh match. Omit `options` to reuse the current ones (same deck). */
  readonly newMatch: (seed?: number, options?: GameOptionsInput) => void
}

/** A fresh unpredictable seed, for when the caller does not pin one. */
function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

function resolveOptions(input: GameOptionsInput, rng: Rng): NewGameOptions {
  return typeof input === 'function' ? input(rng) : input
}

/**
 * The `options` INPUT is remembered — the factory itself, not its result. So `newMatch()`
 * with no arguments restarts with the same configuration but re-runs the factory against
 * the new stream: your deck stays, and anything derived randomly from it (the bot's deck)
 * is rolled afresh. Remembering the resolved value instead would freeze the bot's deck for
 * every restart, which reads as the opponent never changing.
 *
 * `initialSeed` defaults to a random one so a page reload deals a DIFFERENT match. Pass
 * an explicit seed only to reproduce a specific match (debugging, a shared puzzle) —
 * hardcoding one here is what made every reload replay the same dice.
 *
 * Read once via useRef: a re-render must not re-seed the stream mid-match.
 */
export function useGame(initialSeed?: number, options: GameOptionsInput = {}): UseGame {
  const rngRef = useRef<Rng>(createRng(initialSeed ?? randomSeed()))
  const optionsRef = useRef<GameOptionsInput>(options)
  const [state, setState] = useState<GameState>(() =>
    createInitialState(resolveOptions(optionsRef.current, rngRef.current)),
  )

  const dispatch = useCallback((action: Action) => {
    setState((prev) => reducer(prev, action, rngRef.current))
  }, [])

  const newMatch = useCallback((seed?: number, next?: GameOptionsInput) => {
    // A fresh match gets a fresh Rng stream, and the options factory runs against it.
    rngRef.current = createRng(seed ?? randomSeed())
    if (next !== undefined) {
      optionsRef.current = next
    }
    setState(createInitialState(resolveOptions(optionsRef.current, rngRef.current)))
  }, [])

  return useMemo(() => ({ state, dispatch, newMatch }), [state, dispatch, newMatch])
}
