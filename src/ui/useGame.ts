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
export interface UseGame {
  readonly state: GameState
  readonly dispatch: (action: Action) => void
  readonly newMatch: (seed?: number) => void
}

/** A fresh unpredictable seed, for when the caller does not pin one. */
function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

/**
 * `options` (die loadouts, bankroll, bet config) are captured once and reused by
 * `newMatch`, so restarting keeps the same loadouts.
 *
 * `initialSeed` defaults to a random one so a page reload deals a DIFFERENT match. Pass
 * an explicit seed only to reproduce a specific match (debugging, a shared puzzle) —
 * hardcoding one here is what made every reload replay the same dice.
 *
 * Read once via useRef: a re-render must not re-seed the stream mid-match.
 */
export function useGame(initialSeed?: number, options: NewGameOptions = {}): UseGame {
  const rngRef = useRef<Rng>(createRng(initialSeed ?? randomSeed()))
  const optionsRef = useRef<NewGameOptions>(options)
  const [state, setState] = useState<GameState>(() => createInitialState(optionsRef.current))

  const dispatch = useCallback((action: Action) => {
    setState((prev) => reducer(prev, action, rngRef.current))
  }, [])

  const newMatch = useCallback((seed?: number) => {
    // A fresh match gets a fresh Rng stream.
    rngRef.current = createRng(seed ?? randomSeed())
    setState(createInitialState(optionsRef.current))
  }, [])

  return useMemo(() => ({ state, dispatch, newMatch }), [state, dispatch, newMatch])
}
