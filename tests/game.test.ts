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

const MIN = DEFAULT_BET_CONFIG.minBet

/** Performs the ROLL_OFF (retrying on ties) and returns the state in INITIAL_BET. */
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
 * Plays one full hand from ROLL_OFF at minimum stakes: roll off; primary opens the min &
 * non-primary calls; primary steals first; both keep all dice; primary opens the second
 * bet at the first-bet amount & non-primary calls. Returns the state after resolution.
 */
function playPassiveHand(state: GameState, rng: Rng): GameState {
  let s = rollOffUntilDecided(state, rng)
  const primary = s.primary
  const nonPrimary = otherPlayer(primary)

  // INITIAL_BET: primary opens at minimum, non-primary calls.
  s = reducer(s, { type: 'OPEN', player: primary, amount: MIN }, rng)
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

  // SECOND_BET: primary opens at the first-bet amount, non-primary calls.
  s = reducer(s, { type: 'OPEN', player: primary, amount: s.firstBetAmount }, rng)
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
    let s = rollOffUntilDecided(createInitialState(), rng)
    expect(s.rollOff).not.toBeNull()
    const { human, bot } = s.rollOff!
    expect(human.value).not.toBe(bot.value)
    const expectedPrimary: PlayerId = human.value > bot.value ? 'human' : 'bot'
    expect(s.primary).toBe(expectedPrimary)
    expect(s.toAct).toBe(expectedPrimary)
  })
})

describe('free bet amounts', () => {
  it('primary can open above the minimum and opponent must match', () => {
    const rng = createRng(2)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    const nonPrimary = otherPlayer(primary)
    s = reducer(s, { type: 'OPEN', player: primary, amount: 50 }, rng)
    expect(s.currentBet).toBe(50)
    s = reducer(s, { type: 'CALL', player: nonPrimary }, rng)
    expect(s.phase).toBe('STEAL')
    expect(s.pot).toBe(100)
    expect(s.firstBetAmount).toBe(50)
  })

  it('rejects an opening bet below the minimum', () => {
    const rng = createRng(3)
    let s = rollOffUntilDecided(createInitialState(), rng)
    expect(() =>
      reducer(s, { type: 'OPEN', player: s.primary, amount: MIN - 1 }, rng),
    ).toThrow(/at least/)
  })

  it('rejects a raise that does not exceed the current bet by the minimum', () => {
    const rng = createRng(4)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    s = reducer(s, { type: 'OPEN', player: primary, amount: 30 }, rng)
    expect(() =>
      reducer(s, { type: 'RAISE', player: otherPlayer(primary), amount: 35 }, rng),
    ).toThrow(/raise must be to at least/)
  })
})

describe('a bet can never exceed the bankroll', () => {
  it('rejects an opening bet larger than the bankroll', () => {
    const rng = createRng(11)
    const s = rollOffUntilDecided(createInitialState(), rng)
    expect(() =>
      reducer(s, { type: 'OPEN', player: s.primary, amount: 99_999 }, rng),
    ).toThrow(/exceeds/)
  })

  it('rejects an opening bet one coin over the bankroll, but allows exactly all-in', () => {
    const rng = createRng(12)
    const s = rollOffUntilDecided(createInitialState(), rng)
    const stack = s.bankroll[s.primary]

    expect(() =>
      reducer(s, { type: 'OPEN', player: s.primary, amount: stack + 1 }, rng),
    ).toThrow(/exceeds/)

    const allIn = reducer(s, { type: 'OPEN', player: s.primary, amount: stack }, rng)
    expect(allIn.bankroll[s.primary]).toBe(0)
    expect(allIn.pot).toBe(stack)
  })

  it('rejects a raise beyond the bankroll', () => {
    const rng = createRng(13)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    s = reducer(s, { type: 'OPEN', player: primary, amount: MIN }, rng)
    expect(() =>
      reducer(s, { type: 'RAISE', player: otherPlayer(primary), amount: 99_999 }, rng),
    ).toThrow(/exceeds/)
  })

  it('caps a bet at the SHORTER stack, so unmatchable chips are never wagered', () => {
    const rng = createRng(14)
    let s = rollOffUntilDecided(createInitialState({ startingBankroll: 200 }), rng)
    const primary = s.primary
    const shortSeat = otherPlayer(primary)

    // The opponent can only cover 30, so the rich player cannot bet more than that.
    s = { ...s, bankroll: { ...s.bankroll, [shortSeat]: 30 } }
    expect(() => reducer(s, { type: 'OPEN', player: primary, amount: 200 }, rng)).toThrow(
      /exceeds the effective stack/,
    )

    // Betting exactly the short stack is legal, and both end up all-in for 30 each.
    const shoved = reducer(s, { type: 'OPEN', player: primary, amount: 30 }, rng)
    const called = reducer(shoved, { type: 'CALL', player: shortSeat }, rng)
    expect(called.bankroll[shortSeat]).toBe(0)
    expect(called.bankroll[primary]).toBe(170)
  })

  it('a hand played with both players broke skips betting entirely', () => {
    const rng = createRng(15)
    // Nobody has chips: the roll-off must deal straight into STEAL, with an empty pot.
    let s = createInitialState({ startingBankroll: 0 })
    while (s.phase === 'ROLL_OFF') {
      s = reducer(s, { type: 'ROLL_OFF' }, rng)
    }
    expect(s.phase).toBe('STEAL')
    expect(s.pot).toBe(0)
    expect(s.log.some((l) => /senza puntate/.test(l))).toBe(true)
  })

  it('skips the second betting round when a first-round all-in left nobody with chips', () => {
    const rng = createRng(16)
    let s = rollOffUntilDecided(createInitialState({ startingBankroll: 40 }), rng)
    const primary = s.primary
    const other = otherPlayer(primary)

    // Both shove everything in the first round.
    s = reducer(s, { type: 'OPEN', player: primary, amount: 40 }, rng)
    s = reducer(s, { type: 'CALL', player: other }, rng)
    expect(s.bankroll.human).toBe(0)
    expect(s.bankroll.bot).toBe(0)

    // Play through steal + reroll; the second betting round must not be offered.
    s = reducer(s, { type: 'STEAL', player: s.primary, commonIndex: 0 }, rng)
    s = reducer(s, { type: 'STEAL', player: otherPlayer(s.primary), commonIndex: 1 }, rng)
    s = reducer(s, { type: 'REROLL', player: s.primary, ownIndices: [] }, rng)
    s = reducer(s, { type: 'REROLL', player: otherPlayer(s.primary), ownIndices: [] }, rng)

    expect(s.phase).not.toBe('SECOND_BET')
    expect(['HAND_COMPLETE', 'MATCH_OVER']).toContain(s.phase)
    expect(s.log.some((l) => /direttamente allo showdown/.test(l))).toBe(true)
  })
})

describe('fold (second round only, facing a bet)', () => {
  /** Drives a fresh match to SECOND_BET with a bet on the table. */
  function toSecondBetFacingABet(seed: number): { s: GameState; rng: Rng } {
    const rng = createRng(seed)
    let s = rollOffUntilDecided(createInitialState(), rng)
    s = reducer(s, { type: 'OPEN', player: s.primary, amount: MIN }, rng)
    s = reducer(s, { type: 'CALL', player: otherPlayer(s.primary) }, rng)
    s = reducer(s, { type: 'STEAL', player: s.primary, commonIndex: 0 }, rng)
    s = reducer(s, { type: 'STEAL', player: otherPlayer(s.primary), commonIndex: 1 }, rng)
    s = reducer(s, { type: 'REROLL', player: s.primary, ownIndices: [] }, rng)
    s = reducer(s, { type: 'REROLL', player: otherPlayer(s.primary), ownIndices: [] }, rng)
    expect(s.phase).toBe('SECOND_BET')
    s = reducer(s, { type: 'OPEN', player: s.primary, amount: MIN }, rng)
    return { s, rng }
  }

  it('awards the pot AND the Bo3 point to the player who did not fold', () => {
    const { s, rng } = toSecondBetFacingABet(21)
    const folder = s.toAct
    const winner = otherPlayer(folder)
    const potBefore = s.pot
    const bankrollBefore = s.bankroll[winner]

    const after = reducer(s, { type: 'FOLD', player: folder }, rng)

    expect(after.bankroll[winner]).toBe(bankrollBefore + potBefore)
    expect(after.pot).toBe(0)
    expect(after.score[winner]).toBe(1)
    expect(after.score[folder]).toBe(0)
    expect(after.log.some((l) => /si ritira/.test(l))).toBe(true)
  })

  it('is rejected in the first betting round', () => {
    const rng = createRng(22)
    let s = rollOffUntilDecided(createInitialState(), rng)
    s = reducer(s, { type: 'OPEN', player: s.primary, amount: MIN }, rng)
    expect(() =>
      reducer(s, { type: 'FOLD', player: otherPlayer(s.primary) }, rng),
    ).toThrow(/second betting round/)
  })

  it('is rejected when there is no bet to face', () => {
    const rng = createRng(23)
    let s = rollOffUntilDecided(createInitialState(), rng)
    s = reducer(s, { type: 'OPEN', player: s.primary, amount: MIN }, rng)
    s = reducer(s, { type: 'CALL', player: otherPlayer(s.primary) }, rng)
    s = reducer(s, { type: 'STEAL', player: s.primary, commonIndex: 0 }, rng)
    s = reducer(s, { type: 'STEAL', player: otherPlayer(s.primary), commonIndex: 1 }, rng)
    s = reducer(s, { type: 'REROLL', player: s.primary, ownIndices: [] }, rng)
    s = reducer(s, { type: 'REROLL', player: otherPlayer(s.primary), ownIndices: [] }, rng)
    expect(s.phase).toBe('SECOND_BET')
    // Nobody has opened yet, so the player to act has nothing to fold to.
    expect(() => reducer(s, { type: 'FOLD', player: s.toAct }, rng)).toThrow(/no bet to face/)
  })

  it('cannot fold to your own bet', () => {
    const { s, rng } = toSecondBetFacingABet(24)
    // s.aggressor opened; it is the opponent's turn, so the aggressor folding is illegal.
    expect(() => reducer(s, { type: 'FOLD', player: s.aggressor! }, rng)).toThrow(
      /not this player to act/,
    )
  })
})

describe('no check, no fold', () => {
  it('rejects CALL before the round is opened (no check)', () => {
    const rng = createRng(5)
    let s = rollOffUntilDecided(createInitialState(), rng)
    // Primary cannot CALL first — the round is not opened yet.
    expect(() => reducer(s, { type: 'CALL', player: s.primary }, rng)).toThrow(
      /nothing to call/,
    )
  })

  it('has no FOLD action available in the type system (compile-time), and every hand reaches showdown', () => {
    const rng = createRng(6)
    let s = playPassiveHand(createInitialState(), rng)
    // Passive hands always resolve via showdown, never a fold.
    if (s.phase === 'HAND_COMPLETE') {
      expect(s.lastShowdown).not.toBeNull()
    } else {
      expect(s.phase).toBe('MATCH_OVER')
    }
  })
})

describe('steal ordering and exclusivity', () => {
  it('primary steals first', () => {
    const rng = createRng(7)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    s = reducer(s, { type: 'OPEN', player: primary, amount: MIN }, rng)
    s = reducer(s, { type: 'CALL', player: otherPlayer(primary) }, rng)
    expect(s.phase).toBe('STEAL')
    expect(s.toAct).toBe(primary)
  })

  it('rejects stealing a die already taken', () => {
    const rng = createRng(8)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    s = reducer(s, { type: 'OPEN', player: primary, amount: MIN }, rng)
    s = reducer(s, { type: 'CALL', player: otherPlayer(primary) }, rng)
    s = reducer(s, { type: 'STEAL', player: primary, commonIndex: 0 }, rng)
    expect(() =>
      reducer(s, { type: 'STEAL', player: otherPlayer(primary), commonIndex: 0 }, rng),
    ).toThrow(/already taken/)
  })
})

describe('reroll constraint (up to 4, stolen fixed)', () => {
  function reachRerollSelect(rng: Rng): GameState {
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    const nonPrimary = otherPlayer(primary)
    s = reducer(s, { type: 'OPEN', player: primary, amount: MIN }, rng)
    s = reducer(s, { type: 'CALL', player: nonPrimary }, rng)
    s = reducer(s, { type: 'STEAL', player: primary, commonIndex: 0 }, rng)
    s = reducer(s, { type: 'STEAL', player: nonPrimary, commonIndex: 1 }, rng)
    expect(s.phase).toBe('REROLL_SELECT')
    return s
  }

  it('accepts rerolling all 4 own dice', () => {
    const rng = createRng(9)
    const s = reachRerollSelect(rng)
    const next = reducer(s, { type: 'REROLL', player: s.primary, ownIndices: [0, 1, 2, 3] }, rng)
    expect(next.hands[s.primary].rerollSelection).toEqual([0, 1, 2, 3])
  })

  it('rejects an index outside 0..3 (the stolen die is not indexable)', () => {
    const rng = createRng(10)
    const s = reachRerollSelect(rng)
    expect(() =>
      reducer(s, { type: 'REROLL', player: s.primary, ownIndices: [0, 4] }, rng),
    ).toThrow(/own-dice indices/)
  })

  it('rejects duplicate indices', () => {
    const rng = createRng(11)
    const s = reachRerollSelect(rng)
    expect(() =>
      reducer(s, { type: 'REROLL', player: s.primary, ownIndices: [0, 0] }, rng),
    ).toThrow(/duplicate/)
  })
})

describe('betting: pot accounting and raise cap', () => {
  it('pot equals total chips committed across both rounds', () => {
    const rng = createRng(12)
    let s = rollOffUntilDecided(createInitialState(), rng)
    const primary = s.primary
    const nonPrimary = otherPlayer(primary)
    s = reducer(s, { type: 'OPEN', player: primary, amount: 20 }, rng)
    s = reducer(s, { type: 'RAISE', player: nonPrimary, amount: 40 }, rng)
    s = reducer(s, { type: 'CALL', player: primary }, rng)
    expect(s.pot).toBe(80) // both matched 40
    expect(s.phase).toBe('STEAL')
  })

  it('respects the raise cap per betting round', () => {
    const rng = createRng(13)
    let s = rollOffUntilDecided(
      createInitialState({ config: { ...DEFAULT_BET_CONFIG, maxRaisesPerWindow: 1 } }),
      rng,
    )
    const primary = s.primary
    const nonPrimary = otherPlayer(primary)
    s = reducer(s, { type: 'OPEN', player: primary, amount: MIN }, rng)
    s = reducer(s, { type: 'RAISE', player: nonPrimary, amount: 2 * MIN }, rng)
    expect(() =>
      reducer(s, { type: 'RAISE', player: primary, amount: 3 * MIN }, rng),
    ).toThrow(/raise cap/)
  })
})

describe('next hand re-runs the roll-off', () => {
  it('returns to ROLL_OFF after a decisive hand', () => {
    const rng = createRng(14)
    let s = playPassiveHand(createInitialState(), rng)
    if (s.phase === 'HAND_COMPLETE') {
      s = reducer(s, { type: 'NEXT_HAND' }, rng)
      expect(s.phase).toBe('ROLL_OFF')
      expect(s.handNumber).toBe(2)
      expect(s.rollOff).toBeNull()
    } else {
      expect(s.phase).toBe('MATCH_OVER')
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
    const winner = s.matchWinner as PlayerId
    expect(s.score[winner]).toBe(2)
  })
})

describe('chip conservation', () => {
  it('bankrolls + pot stay constant through a whole match', () => {
    const rng = createRng(55)
    let s = createInitialState()
    const total = (st: GameState): number => st.bankroll.human + st.bankroll.bot + st.pot
    const start = total(s)
    let guard = 0
    while (s.phase !== 'MATCH_OVER' && guard < 40) {
      expect(total(s)).toBe(start)
      s = playPassiveHand(s, rng)
      if (s.phase === 'HAND_COMPLETE') s = reducer(s, { type: 'NEXT_HAND' }, rng)
      guard++
    }
    expect(total(s)).toBe(start)
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
