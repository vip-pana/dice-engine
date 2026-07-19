import { describe, it, expect } from 'vitest'
import {
  createInitialState,
  reducer,
  chooseAction,
  createRng,
  BOT_TUNING,
  DEFAULT_STARTING_BANKROLL,
  type GameState,
  type Rng,
} from '../src/engine'

/**
 * Plays a full match with the bot driving BOTH seats. Every action returned by
 * chooseAction is fed straight into the reducer; if any were illegal for the current
 * phase, the reducer would throw. Reaching MATCH_OVER therefore proves the bot only ever
 * emits legal actions across the whole game.
 */
function playBotVsBot(seed: number): GameState {
  const rng: Rng = createRng(seed)
  let s = createInitialState({ firstPrimary: 'human' })
  let guard = 0
  while (s.phase !== 'MATCH_OVER' && guard < 200) {
    if (s.phase === 'HAND_COMPLETE') {
      s = reducer(s, { type: 'NEXT_HAND' }, rng)
    } else {
      const action = chooseAction(s, s.toAct, rng)
      s = reducer(s, action, rng)
    }
    guard++
  }
  return s
}

describe('bot plays only legal actions', () => {
  it('completes a full bot-vs-bot match for many seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const final = playBotVsBot(seed)
      expect(final.phase).toBe('MATCH_OVER')
      expect(final.matchWinner).not.toBeNull()
      const winner = final.matchWinner!
      expect(final.score[winner]).toBe(2)
    }
  })

  it('is deterministic for a given seed', () => {
    const a = playBotVsBot(777)
    const b = playBotVsBot(777)
    expect(a.log).toEqual(b.log)
    expect(a.matchWinner).toBe(b.matchWinner)
    expect(a.score).toEqual(b.score)
  })
})

describe('bot betting heuristics', () => {
  it('conserves chips: bankrolls + pot stay constant during a match', () => {
    const rng = createRng(9)
    let s = createInitialState()
    const total = () => s.bankroll.human + s.bankroll.bot + s.pot
    const start = DEFAULT_STARTING_BANKROLL * 2
    let guard = 0
    while (s.phase !== 'MATCH_OVER' && guard < 200) {
      expect(total()).toBe(start)
      if (s.phase === 'HAND_COMPLETE') {
        s = reducer(s, { type: 'NEXT_HAND' }, rng)
      } else {
        s = reducer(s, chooseAction(s, s.toAct, rng), rng)
      }
      guard++
    }
    expect(total()).toBe(start)
  })

  it('exposes a tunable raise threshold in [0,1]', () => {
    expect(BOT_TUNING.raiseAtLeast).toBeGreaterThanOrEqual(0)
    expect(BOT_TUNING.raiseAtLeast).toBeLessThanOrEqual(1)
  })
})
