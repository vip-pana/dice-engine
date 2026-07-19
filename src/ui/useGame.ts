import { useCallback, useMemo, useRef, useState } from 'react'
import {
  createInitialState,
  reducer,
  createRng,
  type Action,
  type GameState,
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

export function useGame(initialSeed: number): UseGame {
  const rngRef = useRef<Rng>(createRng(initialSeed))
  const [state, setState] = useState<GameState>(() => createInitialState())

  const dispatch = useCallback((action: Action) => {
    setState((prev) => reducer(prev, action, rngRef.current))
  }, [])

  const newMatch = useCallback((seed?: number) => {
    // A fresh match gets a fresh Rng stream; default seed derives from the previous one.
    const nextSeed = seed ?? Math.floor(Math.random() * 2 ** 31)
    rngRef.current = createRng(nextSeed)
    setState(createInitialState())
  }, [])

  return useMemo(() => ({ state, dispatch, newMatch }), [state, dispatch, newMatch])
}
