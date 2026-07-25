import { describe, it, expect } from 'vitest'
import {
  createInitialState,
  reducer,
  chooseAction,
  createRng,
  BOT_TUNING,
  DEFAULT_BET_CONFIG,
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

  it('never bets more than it holds, and no bankroll goes negative', () => {
    // The bot picks its own amounts, so this is the check that its bets stay affordable
    // even deep into a match where one side is short-stacked.
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createRng(seed)
      let s = createInitialState()
      let guard = 0
      while (s.phase !== 'MATCH_OVER' && guard < 300) {
        s =
          s.phase === 'HAND_COMPLETE'
            ? reducer(s, { type: 'NEXT_HAND' }, rng)
            : reducer(s, chooseAction(s, s.toAct, rng), rng)
        expect(s.bankroll.human).toBeGreaterThanOrEqual(0)
        expect(s.bankroll.bot).toBeGreaterThanOrEqual(0)
        guard++
      }
    }
  })

  it('never raises against an all-in opponent — it can only call', () => {
    const rng = createRng(31)
    let s = createInitialState({ startingBankroll: 200 })
    while (s.phase === 'ROLL_OFF') s = reducer(s, { type: 'ROLL_OFF' }, rng)

    // Put the human all-in for a small amount; the bot is rich and must not raise.
    const human = 'human'
    const bot = 'bot'
    s = { ...s, bankroll: { ...s.bankroll, [human]: 10 }, primary: human, toAct: human }
    s = reducer(s, { type: 'OPEN', player: human, amount: 10 }, rng)
    expect(s.bankroll[human]).toBe(0)

    const action = chooseAction(s, bot, rng)
    expect(action.type).toBe('CALL')
  })

  it('plays on a short stack without emitting an unaffordable bet', () => {
    // Start both seats poor enough that the usual minimum-bet impulses do not fit.
    const rng = createRng(4242)
    let s = createInitialState({ startingBankroll: DEFAULT_BET_CONFIG.minBet })
    let guard = 0
    while (s.phase !== 'MATCH_OVER' && guard < 300) {
      s =
        s.phase === 'HAND_COMPLETE'
          ? reducer(s, { type: 'NEXT_HAND' }, rng)
          : reducer(s, chooseAction(s, s.toAct, rng), rng)
      expect(s.bankroll.human).toBeGreaterThanOrEqual(0)
      expect(s.bankroll.bot).toBeGreaterThanOrEqual(0)
      guard++
    }
    expect(s.phase).toBe('MATCH_OVER')
  })

  it('exposes a tunable raise threshold in [0,1]', () => {
    expect(BOT_TUNING.raiseAtLeast).toBeGreaterThanOrEqual(0)
    expect(BOT_TUNING.raiseAtLeast).toBeLessThanOrEqual(1)
  })
})
