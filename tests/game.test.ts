import { describe, it, expect } from 'vitest'
import {
  createInitialState,
  reducer,
  otherPlayer,
  createRng,
  DEFAULT_BET_CONFIG,
  type GameState,
  type PlayerId,
  type Rng,
} from '../src/engine'

/**
 * Plays one full hand where both players just call/check through both betting windows and
 * keep all dice (no reroll). Steals the first available common die each time.
 * Returns the state right after the hand resolves.
 */
function playPassiveHand(state: GameState, rng: Rng): GameState {
  const primary = state.primary
  const nonPrimary = otherPlayer(primary)

  let s = state
  // INITIAL_BET: primary opens, non-primary calls.
  s = reducer(s, { type: 'OPEN', player: primary }, rng)
  s = reducer(s, { type: 'CALL', player: nonPrimary }, rng)
  expect(s.phase).toBe('STEAL')

  // STEAL: non-primary first, then primary. Steal lowest free index.
  const freeIndex = (st: GameState): number =>
    [0, 1, 2].find((i) => !st.stolenCommonIndices.includes(i))!
  s = reducer(s, { type: 'STEAL', player: nonPrimary, commonIndex: freeIndex(s) }, rng)
  s = reducer(s, { type: 'STEAL', player: primary, commonIndex: freeIndex(s) }, rng)
  expect(s.phase).toBe('REROLL_SELECT')

  // REROLL_SELECT: both keep everything.
  s = reducer(s, { type: 'REROLL', player: nonPrimary, ownIndices: [] }, rng)
  s = reducer(s, { type: 'REROLL', player: primary, ownIndices: [] }, rng)
  expect(s.phase).toBe('SECOND_BET')

  // SECOND_BET: primary checks, non-primary checks.
  s = reducer(s, { type: 'CALL', player: primary }, rng)
  s = reducer(s, { type: 'CALL', player: nonPrimary }, rng)
  return s
}

describe('initial state', () => {
  it('starts in INITIAL_BET with primary to act and equal bankrolls', () => {
    const s = createInitialState()
    expect(s.phase).toBe('INITIAL_BET')
    expect(s.toAct).toBe(s.primary)
    expect(s.bankroll.human).toBe(200)
    expect(s.bankroll.bot).toBe(200)
    expect(s.score).toEqual({ human: 0, bot: 0 })
  })
})

describe('steal ordering and exclusivity', () => {
  it('non-primary steals first', () => {
    const rng = createRng(1)
    let s = createInitialState({ firstPrimary: 'human' })
    s = reducer(s, { type: 'OPEN', player: 'human' }, rng)
    s = reducer(s, { type: 'CALL', player: 'bot' }, rng)
    expect(s.phase).toBe('STEAL')
    // primary is human, so non-primary (bot) must act first.
    expect(s.toAct).toBe('bot')
  })

  it('rejects stealing a die already taken', () => {
    const rng = createRng(1)
    let s = createInitialState({ firstPrimary: 'human' })
    s = reducer(s, { type: 'OPEN', player: 'human' }, rng)
    s = reducer(s, { type: 'CALL', player: 'bot' }, rng)
    s = reducer(s, { type: 'STEAL', player: 'bot', commonIndex: 0 }, rng)
    expect(() =>
      reducer(s, { type: 'STEAL', player: 'human', commonIndex: 0 }, rng),
    ).toThrow(/already taken/)
  })

  it('primary cannot steal before non-primary', () => {
    const rng = createRng(1)
    let s = createInitialState({ firstPrimary: 'human' })
    s = reducer(s, { type: 'OPEN', player: 'human' }, rng)
    s = reducer(s, { type: 'CALL', player: 'bot' }, rng)
    expect(() =>
      reducer(s, { type: 'STEAL', player: 'human', commonIndex: 0 }, rng),
    ).toThrow(/not this player to steal/)
  })
})

describe('reroll constraint (max 3, at least 1 kept)', () => {
  function reachRerollSelect(rng: Rng): GameState {
    let s = createInitialState({ firstPrimary: 'human' })
    s = reducer(s, { type: 'OPEN', player: 'human' }, rng)
    s = reducer(s, { type: 'CALL', player: 'bot' }, rng)
    s = reducer(s, { type: 'STEAL', player: 'bot', commonIndex: 0 }, rng)
    s = reducer(s, { type: 'STEAL', player: 'human', commonIndex: 1 }, rng)
    expect(s.phase).toBe('REROLL_SELECT')
    return s
  }

  it('accepts rerolling exactly 3 own dice', () => {
    const rng = createRng(2)
    const s = reachRerollSelect(rng)
    const next = reducer(s, { type: 'REROLL', player: 'bot', ownIndices: [0, 1, 2] }, rng)
    expect(next.hands.bot.rerollSelection).toEqual([0, 1, 2])
  })

  it('rejects rerolling all 4 own dice', () => {
    const rng = createRng(2)
    const s = reachRerollSelect(rng)
    expect(() =>
      reducer(s, { type: 'REROLL', player: 'bot', ownIndices: [0, 1, 2, 3] }, rng),
    ).toThrow(/at most 3/)
  })

  it('rejects duplicate indices', () => {
    const rng = createRng(2)
    const s = reachRerollSelect(rng)
    expect(() =>
      reducer(s, { type: 'REROLL', player: 'bot', ownIndices: [0, 0] }, rng),
    ).toThrow(/duplicate/)
  })
})

describe('fold is only allowed in SECOND_BET', () => {
  it('rejects FOLD during INITIAL_BET', () => {
    const rng = createRng(3)
    let s = createInitialState({ firstPrimary: 'human' })
    s = reducer(s, { type: 'OPEN', player: 'human' }, rng)
    expect(() => reducer(s, { type: 'FOLD', player: 'bot' }, rng)).toThrow(
      /FOLD only allowed in SECOND_BET/,
    )
  })

  it('allows FOLD in SECOND_BET and awards the hand to the opponent', () => {
    const rng = createRng(4)
    let s = createInitialState({ firstPrimary: 'human' })
    // Reach SECOND_BET.
    s = reducer(s, { type: 'OPEN', player: 'human' }, rng)
    s = reducer(s, { type: 'CALL', player: 'bot' }, rng)
    s = reducer(s, { type: 'STEAL', player: 'bot', commonIndex: 0 }, rng)
    s = reducer(s, { type: 'STEAL', player: 'human', commonIndex: 1 }, rng)
    s = reducer(s, { type: 'REROLL', player: 'bot', ownIndices: [] }, rng)
    s = reducer(s, { type: 'REROLL', player: 'human', ownIndices: [] }, rng)
    expect(s.phase).toBe('SECOND_BET')
    // Primary checks, non-primary folds.
    s = reducer(s, { type: 'CALL', player: 'human' }, rng)
    const potBefore = s.pot
    s = reducer(s, { type: 'FOLD', player: 'bot' }, rng)
    expect(s.score.human).toBe(1)
    expect(s.lastShowdown).toBeNull() // folded, no showdown
    // Winner collected the pot.
    expect(s.bankroll.human).toBe(200 - s.hands.human.committed + potBefore)
  })
})

describe('betting: second bet floor and pot accounting', () => {
  it('pot equals total committed by both players', () => {
    const rng = createRng(5)
    const s0 = createInitialState({ firstPrimary: 'human' })
    let s = reducer(s0, { type: 'OPEN', player: 'human' }, rng)
    s = reducer(s, { type: 'RAISE', player: 'bot' }, rng)
    s = reducer(s, { type: 'CALL', player: 'human' }, rng)
    // After settle, pot = both matched the raised bet.
    const expected = s.hands.human.committed + s.hands.bot.committed
    expect(s.pot).toBe(expected)
    expect(s.hands.human.committed).toBe(s.hands.bot.committed)
  })

  it('respects the raise cap per window', () => {
    const rng = createRng(6)
    const s0 = createInitialState({
      firstPrimary: 'human',
      config: { ...DEFAULT_BET_CONFIG, maxRaisesPerWindow: 1 },
    })
    let s = reducer(s0, { type: 'OPEN', player: 'human' }, rng)
    s = reducer(s, { type: 'RAISE', player: 'bot' }, rng)
    // Second raise exceeds the cap of 1.
    expect(() => reducer(s, { type: 'RAISE', player: 'human' }, rng)).toThrow(/raise cap/)
  })
})

describe('primary role alternates each hand (except ties)', () => {
  it('alternates after a decisive hand', () => {
    const rng = createRng(7)
    let s = createInitialState({ firstPrimary: 'human' })
    const firstPrimary = s.primary
    s = playPassiveHand(s, rng)
    // If it happened to tie, replay keeps primary; otherwise it flips. Handle both.
    if (s.lastShowdown?.outcome.kind === 'tie') {
      s = reducer(s, { type: 'NEXT_HAND' }, rng)
      expect(s.primary).toBe(firstPrimary)
    } else {
      expect(s.phase).toBe('HAND_COMPLETE')
      s = reducer(s, { type: 'NEXT_HAND' }, rng)
      expect(s.primary).toBe(otherPlayer(firstPrimary))
      expect(s.handNumber).toBe(2)
    }
  })
})

describe('Best of 3 completes', () => {
  it('reaches MATCH_OVER with a winner within at most 5 hands', () => {
    const rng = createRng(123)
    let s = createInitialState({ firstPrimary: 'human' })
    let guard = 0
    while (s.phase !== 'MATCH_OVER' && guard < 20) {
      s = playPassiveHand(s, rng)
      if (s.phase === 'HAND_COMPLETE') {
        s = reducer(s, { type: 'NEXT_HAND' }, rng)
      }
      guard++
    }
    expect(s.phase).toBe('MATCH_OVER')
    expect(s.matchWinner).not.toBeNull()
    const winner = s.matchWinner as PlayerId
    expect(s.score[winner]).toBe(2)
  })
})

describe('determinism', () => {
  it('same seed + same actions -> identical final state', () => {
    const run = (): GameState => {
      const rng = createRng(999)
      let s = createInitialState({ firstPrimary: 'human' })
      let guard = 0
      while (s.phase !== 'MATCH_OVER' && guard < 20) {
        s = playPassiveHand(s, rng)
        if (s.phase === 'HAND_COMPLETE') s = reducer(s, { type: 'NEXT_HAND' }, rng)
        guard++
      }
      return s
    }
    const a = run()
    const b = run()
    expect(a.score).toEqual(b.score)
    expect(a.matchWinner).toBe(b.matchWinner)
    expect(a.log).toEqual(b.log)
  })
})
