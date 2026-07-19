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
 * Performs the ROLL_OFF (retrying on ties) and returns the state in INITIAL_BET with a
 * decided primary. The roll-off is a system action, so no player is attached.
 */
function rollOffUntilDecided(state: GameState, rng: Rng): GameState {
  let s = state
  let guard = 0
  while (s.phase === 'ROLL_OFF' && guard < 50) {
    s = reducer(s, { type: 'ROLL_OFF' }, rng)
    guard++
  }
  expect(s.phase).toBe('INITIAL_BET')
  return s
}

/**
 * Plays one full hand from ROLL_OFF: roll off, primary opens & non-primary calls, primary
 * steals first, both keep all dice, primary checks & non-primary checks in the second bet.
 * Returns the state right after the hand resolves.
 */
function playPassiveHand(state: GameState, rng: Rng): GameState {
  let s = rollOffUntilDecided(state, rng)
  const primary = s.primary
  const nonPrimary = otherPlayer(primary)

  // INITIAL_BET: primary opens (must bet), non-primary calls.
  s = reducer(s, { type: 'OPEN', player: primary }, rng)
  s = reducer(s, { type: 'CALL', player: nonPrimary }, rng)
  expect(s.phase).toBe('STEAL')

  // STEAL: primary first, then non-primary. Steal lowest free index.
  const freeIndex = (st: GameState): number =>
    [0, 1, 2].find((i) => !st.stolenCommonIndices.includes(i))!
  s = reducer(s, { type: 'STEAL', player: primary, commonIndex: freeIndex(s) }, rng)
  s = reducer(s, { type: 'STEAL', player: nonPrimary, commonIndex: freeIndex(s) }, rng)
  expect(s.phase).toBe('REROLL_SELECT')

  // REROLL_SELECT: primary first, then non-primary; both keep everything.
  s = reducer(s, { type: 'REROLL', player: primary, ownIndices: [] }, rng)
  s = reducer(s, { type: 'REROLL', player: nonPrimary, ownIndices: [] }, rng)
  expect(s.phase).toBe('SECOND_BET')

  // SECOND_BET: primary checks, non-primary checks.
  s = reducer(s, { type: 'CALL', player: primary }, rng)
  s = reducer(s, { type: 'CALL', player: nonPrimary }, rng)
  return s
}

describe('initial state', () => {
  it('starts in ROLL_OFF with equal bankrolls', () => {
    const s = createInitialState()
    expect(s.phase).toBe('ROLL_OFF')
    expect(s.rollOff).toBeNull()
    expect(s.bankroll.human).toBe(200)
    expect(s.bankroll.bot).toBe(200)
    expect(s.score).toEqual({ human: 0, bot: 0 })
  })
})

describe('roll-off decides the primary', () => {
  it('the higher die becomes primary and opens the initial bet', () => {
    const rng = createRng(1)
    let s = createInitialState()
    s = rollOffUntilDecided(s, rng)
    expect(s.rollOff).not.toBeNull()
    const { human, bot } = s.rollOff!
    expect(human.value).not.toBe(bot.value) // decided => not a tie
    const expectedPrimary: PlayerId = human.value > bot.value ? 'human' : 'bot'
    expect(s.primary).toBe(expectedPrimary)
    expect(s.toAct).toBe(expectedPrimary) // primary opens
  })
})

describe('steal ordering and exclusivity', () => {
  it('primary steals first', () => {
    const rng = createRng(2)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    s = reducer(s, { type: 'OPEN', player: primary }, rng)
    s = reducer(s, { type: 'CALL', player: otherPlayer(primary) }, rng)
    expect(s.phase).toBe('STEAL')
    expect(s.toAct).toBe(primary)
  })

  it('rejects stealing a die already taken', () => {
    const rng = createRng(3)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    s = reducer(s, { type: 'OPEN', player: primary }, rng)
    s = reducer(s, { type: 'CALL', player: otherPlayer(primary) }, rng)
    s = reducer(s, { type: 'STEAL', player: primary, commonIndex: 0 }, rng)
    expect(() =>
      reducer(s, { type: 'STEAL', player: otherPlayer(primary), commonIndex: 0 }, rng),
    ).toThrow(/already taken/)
  })

  it('non-primary cannot steal before primary', () => {
    const rng = createRng(4)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    s = reducer(s, { type: 'OPEN', player: primary }, rng)
    s = reducer(s, { type: 'CALL', player: otherPlayer(primary) }, rng)
    expect(() =>
      reducer(s, { type: 'STEAL', player: otherPlayer(primary), commonIndex: 0 }, rng),
    ).toThrow(/not this player to steal/)
  })
})

describe('reroll constraint (max 3, at least 1 kept)', () => {
  function reachRerollSelect(rng: Rng): GameState {
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    const nonPrimary = otherPlayer(primary)
    s = reducer(s, { type: 'OPEN', player: primary }, rng)
    s = reducer(s, { type: 'CALL', player: nonPrimary }, rng)
    s = reducer(s, { type: 'STEAL', player: primary, commonIndex: 0 }, rng)
    s = reducer(s, { type: 'STEAL', player: nonPrimary, commonIndex: 1 }, rng)
    expect(s.phase).toBe('REROLL_SELECT')
    return s
  }

  it('accepts rerolling exactly 3 own dice', () => {
    const rng = createRng(5)
    const s = reachRerollSelect(rng)
    const next = reducer(s, { type: 'REROLL', player: s.primary, ownIndices: [0, 1, 2] }, rng)
    expect(next.hands[s.primary].rerollSelection).toEqual([0, 1, 2])
  })

  it('rejects rerolling all 4 own dice', () => {
    const rng = createRng(6)
    const s = reachRerollSelect(rng)
    expect(() =>
      reducer(s, { type: 'REROLL', player: s.primary, ownIndices: [0, 1, 2, 3] }, rng),
    ).toThrow(/at most 3/)
  })

  it('rejects duplicate indices', () => {
    const rng = createRng(7)
    const s = reachRerollSelect(rng)
    expect(() =>
      reducer(s, { type: 'REROLL', player: s.primary, ownIndices: [0, 0] }, rng),
    ).toThrow(/duplicate/)
  })
})

describe('betting rules', () => {
  it('rejects a check during INITIAL_BET (must bet)', () => {
    // Force a state where the opponent would attempt to check pre-bet: only possible if
    // aggressor is null, which never happens after OPEN. Instead we assert the primary
    // cannot CALL at currentBet 0 (that path is an OPEN), and the non-primary faces a bet.
    const rng = createRng(8)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    // Primary must OPEN, not CALL, at the start.
    expect(() => reducer(s, { type: 'CALL', player: primary }, rng)).toThrow(
      /cannot check in the initial bet/,
    )
  })

  it('rejects FOLD during INITIAL_BET', () => {
    const rng = createRng(9)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    s = reducer(s, { type: 'OPEN', player: primary }, rng)
    expect(() => reducer(s, { type: 'FOLD', player: otherPlayer(primary) }, rng)).toThrow(
      /FOLD only allowed in SECOND_BET/,
    )
  })

  it('allows FOLD in SECOND_BET and awards the hand to the opponent', () => {
    const rng = createRng(10)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    const nonPrimary = otherPlayer(primary)
    s = reducer(s, { type: 'OPEN', player: primary }, rng)
    s = reducer(s, { type: 'CALL', player: nonPrimary }, rng)
    s = reducer(s, { type: 'STEAL', player: primary, commonIndex: 0 }, rng)
    s = reducer(s, { type: 'STEAL', player: nonPrimary, commonIndex: 1 }, rng)
    s = reducer(s, { type: 'REROLL', player: primary, ownIndices: [] }, rng)
    s = reducer(s, { type: 'REROLL', player: nonPrimary, ownIndices: [] }, rng)
    expect(s.phase).toBe('SECOND_BET')
    // Primary checks, non-primary folds.
    s = reducer(s, { type: 'CALL', player: primary }, rng)
    const potBefore = s.pot
    const winnerCommitted = s.hands[primary].committed
    s = reducer(s, { type: 'FOLD', player: nonPrimary }, rng)
    expect(s.score[primary]).toBe(1)
    expect(s.lastShowdown).toBeNull() // folded, no showdown
    expect(s.bankroll[primary]).toBe(200 - winnerCommitted + potBefore)
  })

  it('pot equals total committed by both players', () => {
    const rng = createRng(11)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    const nonPrimary = otherPlayer(primary)
    s = reducer(s, { type: 'OPEN', player: primary }, rng)
    s = reducer(s, { type: 'RAISE', player: nonPrimary }, rng)
    s = reducer(s, { type: 'CALL', player: primary }, rng)
    const expected = s.hands.human.committed + s.hands.bot.committed
    expect(s.pot).toBe(expected)
    expect(s.hands.human.committed).toBe(s.hands.bot.committed)
  })

  it('respects the raise cap per betting round', () => {
    const rng = createRng(12)
    let s = rollOffUntilDecided(
      createInitialState({ config: { ...DEFAULT_BET_CONFIG, maxRaisesPerWindow: 1 } }),
      rng,
    )
    const primary = s.primary
    const nonPrimary = otherPlayer(primary)
    s = reducer(s, { type: 'OPEN', player: primary }, rng)
    s = reducer(s, { type: 'RAISE', player: nonPrimary }, rng)
    expect(() => reducer(s, { type: 'RAISE', player: primary }, rng)).toThrow(/raise cap/)
  })
})

describe('next hand re-runs the roll-off', () => {
  it('returns to ROLL_OFF after a decisive hand', () => {
    const rng = createRng(13)
    let s = playPassiveHand(createInitialState(), rng)
    if (s.phase === 'HAND_COMPLETE') {
      s = reducer(s, { type: 'NEXT_HAND' }, rng)
      expect(s.phase).toBe('ROLL_OFF')
      expect(s.handNumber).toBe(2)
      expect(s.rollOff).toBeNull()
    } else {
      // Tie hands also return to ROLL_OFF on NEXT_HAND.
      expect(s.phase).toBe('HAND_COMPLETE')
    }
  })
})

describe('Best of 3 completes', () => {
  it('reaches MATCH_OVER with a winner', () => {
    const rng = createRng(123)
    let s = createInitialState()
    let guard = 0
    while (s.phase !== 'MATCH_OVER' && guard < 40) {
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
      let s = createInitialState()
      let guard = 0
      while (s.phase !== 'MATCH_OVER' && guard < 40) {
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
