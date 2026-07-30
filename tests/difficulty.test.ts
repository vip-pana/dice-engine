import { describe, it, expect } from 'vitest'
import {
  ALL_DIFFICULTIES,
  BOT_TUNING,
  DEFAULT_BET_CONFIG,
  DEFAULT_STARTING_BANKROLL,
  DIFFICULTY_TABLE,
  FOGGED_FACE_WEIGHTS,
  botDeckSpecialsOffsetFor,
  botSkillFor,
  buildDeck,
  chooseAction,
  chooseStolenDie,
  createInitialState,
  createRng,
  exactRerollEV,
  optimalPlay,
  optimalReroll,
  reducer,
  rollBotDeck,
  specialCount,
  stakesFor,
  type Action,
  type Die,
  type Difficulty,
  type GameState,
  type Rng,
} from '../src/engine'

/**
 * Plays a full match with one bot skill per seat, collecting every action it emitted.
 *
 * Each seat gets its OWN brain Rng, separate from the match Rng, and that is not tidiness: the
 * 'exact' reroll consumes zero draws where 'sampled' consumes ~60 per keep-set, so a shared Rng
 * would make the two seats' dice depend on which levels were playing. It mirrors what the app
 * does (a dedicated botBrainRng).
 */
function playMatch(
  seed: number,
  levels: Record<'human' | 'bot', Difficulty>,
): { readonly final: GameState; readonly actions: readonly Action[] } {
  const rng: Rng = createRng(seed)
  const brains = { human: createRng(seed * 7919 + 1), bot: createRng(seed * 6271 + 2) }
  let s = createInitialState({ firstPrimary: 'human' })
  const actions: Action[] = []
  let guard = 0
  while (s.phase !== 'MATCH_OVER' && guard < 300) {
    if (s.phase === 'HAND_COMPLETE') {
      s = reducer(s, { type: 'NEXT_HAND' }, rng)
    } else {
      const seat = s.toAct
      const action = chooseAction(s, seat, brains[seat], levels[seat])
      actions.push(action)
      s = reducer(s, action, rng)
    }
    guard++
  }
  return { final: s, actions }
}

/** Actions emitted by ONE seat, which is what a "this level never folds" claim is about. */
function actionsOf(actions: readonly Action[], seat: 'human' | 'bot'): readonly Action[] {
  return actions.filter((a) => 'player' in a && a.player === seat)
}

describe('the difficulty table is complete', () => {
  it('gives every level a full set of numbers', () => {
    // A missing ROW is already a compile error (Record<Difficulty, …>), so what this earns its
    // keep on is missing FIELDS: a row written as a partial, or a new BetConfig field that only
    // one level got. Same job as the SPONGE_PRIORITY completeness test — turn a silent omission
    // into a failure.
    const skillKeys = Object.keys(BOT_TUNING).sort()
    const configKeys = Object.keys(DEFAULT_BET_CONFIG).sort()

    for (const level of ALL_DIFFICULTIES) {
      const profile = DIFFICULTY_TABLE[level]
      expect(Object.keys(profile.bot).sort()).toEqual(skillKeys)
      expect(Object.keys(profile.stakes.config).sort()).toEqual(configKeys)
      expect(profile.stakes.startingBankroll).toBeGreaterThan(0)
      expect(profile.stakes.config.minBet).toBeGreaterThan(0)
      expect(profile.stakes.config.maxRaisesPerWindow).toBeGreaterThan(0)
      expect(botSkillFor(level).raiseAtLeast).toBeGreaterThanOrEqual(0)
      expect(botSkillFor(level).raiseAtLeast).toBeLessThanOrEqual(1)
      expect(botSkillFor(level).maxReroll).toBeGreaterThanOrEqual(1)
    }
  })

  it('scales the stakes monotonically, easy through hard', () => {
    // The whole point of the money axis, stated as an assertion so a future edit cannot quietly
    // invert it. The CUSHION (stack / minimum bet) is what actually bites — a seat with no chips
    // behind cannot bet or bluff at all — so it is checked in the other direction.
    const bet = (d: Difficulty): number => stakesFor(d).config.minBet
    const cushion = (d: Difficulty): number =>
      stakesFor(d).startingBankroll / stakesFor(d).config.minBet

    expect(bet('easy')).toBeLessThan(bet('normal'))
    expect(bet('normal')).toBeLessThan(bet('hard'))
    expect(cushion('easy')).toBeGreaterThan(cushion('normal'))
    expect(cushion('normal')).toBeGreaterThan(cushion('hard'))
  })

  it('makes the bot deck weaker on easy and stronger on hard', () => {
    expect(botDeckSpecialsOffsetFor('easy')).toBeLessThan(0)
    expect(botDeckSpecialsOffsetFor('normal')).toBe(0)
    expect(botDeckSpecialsOffsetFor('hard')).toBeGreaterThan(0)
  })
})

describe("'normal' is the game as it played before difficulty existed", () => {
  /**
   * Bot-vs-bot outcomes captured from the commit BEFORE this feature, with the bot driving both
   * seats off the single match Rng — the exact shape of tests/bot.test.ts's playBotVsBot.
   *
   * This is the only assertion here that survives the refactor rather than being defined by it:
   * everything else compares new code to new code. If it ever fails, 'normal' has drifted and
   * the difficulty work changed the base game.
   */
  const GOLDEN = [
    { seed: 777, matchWinner: 'human', score: { human: 2, bot: 1 }, bankroll: { human: 230, bot: 170 }, logLength: 52 },
    { seed: 4242, matchWinner: 'human', score: { human: 2, bot: 1 }, bankroll: { human: 220, bot: 180 }, logLength: 54 },
    { seed: 31, matchWinner: 'bot', score: { human: 1, bot: 2 }, bankroll: { human: 180, bot: 220 }, logLength: 52 },
  ] as const

  function playSharedRng(seed: number, difficulty?: Difficulty): GameState {
    const rng: Rng = createRng(seed)
    let s = createInitialState({ firstPrimary: 'human' })
    let guard = 0
    while (s.phase !== 'MATCH_OVER' && guard < 200) {
      s =
        s.phase === 'HAND_COMPLETE'
          ? reducer(s, { type: 'NEXT_HAND' }, rng)
          : reducer(
              s,
              difficulty === undefined
                ? chooseAction(s, s.toAct, rng)
                : chooseAction(s, s.toAct, rng, difficulty),
              rng,
            )
      guard++
    }
    return s
  }

  it('reproduces the pre-difficulty fingerprint', () => {
    for (const g of GOLDEN) {
      const final = playSharedRng(g.seed)
      expect(final.matchWinner).toBe(g.matchWinner)
      expect(final.score).toEqual(g.score)
      expect(final.bankroll).toEqual(g.bankroll)
      expect(final.log.length).toBe(g.logLength)
    }
  })

  it("the default parameter and an explicit 'normal' play identically", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const a = playSharedRng(seed)
      const b = playSharedRng(seed, 'normal')
      expect(b.log).toEqual(a.log)
      expect(b.matchWinner).toBe(a.matchWinner)
      expect(b.score).toEqual(a.score)
      expect(b.bankroll).toEqual(a.bankroll)
    }
  })

  it("consumes the same number of Rng draws as the old call did", () => {
    // The guard against a future knob that draws from the Rng "just once, harmlessly": the bot
    // shares the match Rng in these harnesses, so one extra draw shifts every die thereafter.
    const counted = (seed: number): { rng: Rng; draws: () => number } => {
      const inner = createRng(seed)
      let n = 0
      return {
        rng: {
          nextInt: (lo: number, hi: number) => {
            n++
            return inner.nextInt(lo, hi)
          },
          rollDie: () => {
            n++
            return inner.rollDie()
          },
        } as Rng,
        draws: () => n,
      }
    }

    // A state deep enough to be past the roll-off, so the reroll sampling is what gets counted.
    const base = (): GameState => {
      const rng = createRng(5)
      let s = createInitialState({ firstPrimary: 'human' })
      let guard = 0
      while (s.phase !== 'REROLL_SELECT' && guard < 100) {
        s =
          s.phase === 'HAND_COMPLETE'
            ? reducer(s, { type: 'NEXT_HAND' }, rng)
            : reducer(s, chooseAction(s, s.toAct, rng), rng)
        guard++
      }
      return s
    }

    const s = base()
    expect(s.phase).toBe('REROLL_SELECT')

    const withDefault = counted(11)
    chooseAction(s, s.toAct, withDefault.rng)
    const withNormal = counted(11)
    chooseAction(s, s.toAct, withNormal.rng, 'normal')

    expect(withNormal.draws()).toBe(withDefault.draws())
    expect(withDefault.draws()).toBeGreaterThan(0)
  })

  it("keeps 'normal' pinned to the engine defaults rather than a copy of them", () => {
    expect(stakesFor('normal').config).toEqual(DEFAULT_BET_CONFIG)
    expect(stakesFor('normal').startingBankroll).toBe(DEFAULT_STARTING_BANKROLL)
    // BOT_TUNING is the 'normal' profile, so the old four thresholds must still read the same.
    expect(BOT_TUNING.raiseAtLeast).toBe(0.62)
    expect(BOT_TUNING.raiseOnInitialBet).toBe(false)
    expect(BOT_TUNING.foldBelow).toBe(0.3)
    expect(BOT_TUNING.foldWhenPriceOverStack).toBe(0.1)
  })
})

describe("the 'easy' bot is weak in the ways it says it is", () => {
  it('calls where normale folds, on the identical state', () => {
    // The differential is the precise claim: same weak hand, same big bet, different level.
    const rng = createRng(31)
    let s = createInitialState({ startingBankroll: 200 })
    while (s.phase === 'ROLL_OFF') s = reducer(s, { type: 'ROLL_OFF' }, rng)

    // Reach the second bet, then hand the bot a hopeless hand and a bet that costs real money.
    let guard = 0
    while (s.phase !== 'SECOND_BET' && guard < 100) {
      s =
        s.phase === 'HAND_COMPLETE'
          ? reducer(s, { type: 'NEXT_HAND' }, rng)
          : reducer(s, chooseAction(s, s.toAct, rng), rng)
      guard++
    }
    expect(s.phase).toBe('SECOND_BET')

    const junk: Die[] = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }]
    s = {
      ...s,
      toAct: 'bot',
      aggressor: 'human',
      currentBet: 120,
      hands: {
        ...s.hands,
        bot: {
          ...s.hands.bot,
          own: [junk[0]!, junk[1]!, junk[2]!, junk[3]!],
          stolen: { value: 6 },
          committed: 0,
          rerollSelection: null,
        },
      },
      bankroll: { ...s.bankroll, bot: 200 },
    }

    expect(chooseAction(s, 'bot', createRng(1), 'normal').type).toBe('FOLD')
    expect(chooseAction(s, 'bot', createRng(1), 'easy').type).toBe('CALL')
  })

  it('never folds and never raises across whole matches', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { final, actions } = playMatch(seed, { human: 'normal', bot: 'easy' })
      expect(final.phase).toBe('MATCH_OVER')
      const mine = actionsOf(actions, 'bot')
      expect(mine.some((a) => a.type === 'FOLD')).toBe(false)
      expect(mine.some((a) => a.type === 'RAISE')).toBe(false)
    }
  })

  it('never replaces more dice than its maxReroll', () => {
    const cap = botSkillFor('easy').maxReroll
    for (let seed = 1; seed <= 40; seed++) {
      const { actions } = playMatch(seed, { human: 'normal', bot: 'easy' })
      for (const a of actionsOf(actions, 'bot')) {
        if (a.type === 'REROLL') {
          expect(a.ownIndices.length).toBeLessThanOrEqual(cap)
        }
      }
    }
  })
})

describe("the 'hard' bot's upgrades really are upgrades", () => {
  /** Seeded (own, common) draws, so the dominance claims below are checked on real shapes. */
  function draw(seed: number): { own: [Die, Die, Die, Die]; common: readonly Die[] } {
    const rng = createRng(seed)
    return {
      own: [
        { value: rng.rollDie() },
        { value: rng.rollDie() },
        { value: rng.rollDie() },
        { value: rng.rollDie() },
      ],
      common: [{ value: rng.rollDie() }, { value: rng.rollDie() }, { value: rng.rollDie() }],
    }
  }

  it('the joint steal is never worse than the greedy one', () => {
    // A mathematical fact rather than a measurement: optimalPlay maximizes over the same set of
    // steals the greedy pick chooses from, scoring each by the reroll it enables. Asserting the
    // MECHANISM this way is what lets the win-rate question live in the simulator instead of
    // inside a flaky unit test.
    for (let seed = 1; seed <= 200; seed++) {
      const { own, common } = draw(seed)
      const joint = optimalPlay(own, common)
      const greedy = chooseStolenDie(own, common)
      const greedyEv = optimalReroll(own, common[greedy.index]!).ev
      expect(joint.reroll.ev).toBeGreaterThanOrEqual(greedyEv)
    }
  })

  it('the exact reroll is never worse than a two-dice-capped one', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { own, common } = draw(seed)
      const stolen = common[0]!
      const exact = optimalReroll(own, stolen, botSkillFor('hard').maxReroll)
      const capped = optimalReroll(own, stolen, botSkillFor('easy').maxReroll)
      expect(exact.ev).toBeGreaterThanOrEqual(capped.ev)
    }
  })
})

describe("the 'hard' bot's raise sizing", () => {
  /**
   * A SECOND_BET state where `seat` faces a bet of `currentBet` holding a monster and `stack`
   * coins behind. Patched directly, the way tests/bot.test.ts sets up its all-in case: reaching
   * a specific betting spot through real play is not reproducible enough to assert an amount on.
   */
  function facingABet(seat: 'bot', currentBet: number, stack: number): GameState {
    const rng = createRng(31)
    let s = createInitialState({ startingBankroll: 500 })
    let guard = 0
    while (s.phase !== 'SECOND_BET' && guard < 100) {
      s =
        s.phase === 'HAND_COMPLETE'
          ? reducer(s, { type: 'NEXT_HAND' }, rng)
          : reducer(s, chooseAction(s, s.toAct, rng), rng)
      guard++
    }
    expect(s.phase).toBe('SECOND_BET')
    // Five sixes: as strong as a hand gets, so every level wants to raise it.
    const monster: [Die, Die, Die, Die] = [
      { value: 6 },
      { value: 6 },
      { value: 6 },
      { value: 6 },
    ]
    return {
      ...s,
      toAct: seat,
      aggressor: 'human',
      currentBet,
      raisesThisWindow: 0,
      hands: {
        ...s.hands,
        [seat]: {
          ...s.hands[seat],
          own: monster,
          stolen: { value: 6 },
          committed: 0,
          rerollSelection: null,
        },
      },
      bankroll: { human: 500, bot: stack },
    }
  }

  it('raises by two minimums where normale raises by one', () => {
    // This is a claim the level's own description makes to the player ("rilancia il doppio"), so
    // it is pinned rather than left to the tuning table being read correctly.
    const s = facingABet('bot', 50, 500)
    const min = s.config.minBet

    const normal = chooseAction(s, 'bot', createRng(1), 'normal')
    const hard = chooseAction(s, 'bot', createRng(1), 'hard')
    expect(normal).toEqual({ type: 'RAISE', player: 'bot', amount: 50 + min })
    expect(hard).toEqual({ type: 'RAISE', player: 'bot', amount: 50 + 2 * min })
  })

  it('falls back to one minimum rather than going quiet on a short stack', () => {
    // The trap this guards: betOrCall downgrades an unaffordable RAISE to a CALL, so without the
    // fallback the bigger-raise profile would CALL exactly where the smaller one RAISES — a
    // "stronger" bot playing more passively, and only on short stacks, where it is hardest to
    // notice. The stack here covers one min-raise but not two.
    const s = facingABet('bot', 50, 50 + DEFAULT_BET_CONFIG.minBet)
    const hard = chooseAction(s, 'bot', createRng(1), 'hard')
    expect(hard.type).toBe('RAISE')
    if (hard.type === 'RAISE') {
      expect(hard.amount).toBe(50 + DEFAULT_BET_CONFIG.minBet)
    }
  })
})

describe('the fogged face distribution', () => {
  it('is a distribution with the mean the fog actually produces', () => {
    const sum = FOGGED_FACE_WEIGHTS.reduce((t, p) => t + p, 0)
    expect(sum).toBeCloseTo(1, 12)
    const mean = FOGGED_FACE_WEIGHTS.reduce((t, p, i) => t + p * (i + 1), 0)
    // min-of-two-d6: 91/36 = 2.5277…, the figure the README quotes against a clear 3.5.
    expect(mean).toBeCloseTo(91 / 36, 12)
    // Monotonically decreasing: keeping the lower of two rolls makes 1 the likeliest face.
    for (let i = 1; i < FOGGED_FACE_WEIGHTS.length; i++) {
      expect(FOGGED_FACE_WEIGHTS[i]!).toBeLessThan(FOGGED_FACE_WEIGHTS[i - 1]!)
    }
  })

  it('lowers the value of rerolling, and leaves the clear EV untouched', () => {
    const own: [Die, Die, Die, Die] = [
      { value: 6 },
      { value: 6 },
      { value: 2 },
      { value: 1 },
    ]
    const stolen: Die = { value: 6 }
    const clear = exactRerollEV(own, stolen, [2, 3])
    const fogged = exactRerollEV(own, stolen, [2, 3], FOGGED_FACE_WEIGHTS)
    expect(fogged).toBeLessThan(clear)

    // An explicit uniform distribution must agree with the default path. Not bit-identical by
    // construction (it multiplies where the default divides once), hence the tolerance — the
    // default path is the one kept bit-identical, and this only proves the weighting is right.
    const uniform = exactRerollEV(own, stolen, [2, 3], [1, 1, 1, 1, 1, 1].map(() => 1 / 6))
    expect(uniform).toBeCloseTo(clear, 6)
  })

  it('changes the chosen keep-set in BOTH directions, not just toward keeping', () => {
    // The intuition this pins against is the one the code used to state: "a fresh face averages
    // 2.53 in fog, so keep more". It is wrong, and the reason is worth having a test for — the
    // fogged distribution is bunched on the low faces, so fresh dice pair up MORE often (three of
    // them make at least a pair 55% of the time in fog against 44% clear), and handScore ranks by
    // category before face value. So fog-aware play sometimes throws MORE dice away.
    const rng = createRng(99)
    let differ = 0
    let fewer = 0
    let more = 0
    for (let i = 0; i < 300; i++) {
      const own: [Die, Die, Die, Die] = [
        { value: rng.rollDie() },
        { value: rng.rollDie() },
        { value: rng.rollDie() },
        { value: rng.rollDie() },
      ]
      const stolen: Die = { value: rng.rollDie() }
      const clear = optimalReroll(own, stolen, 4).rerollIdx.length
      const fogged = optimalReroll(own, stolen, 4, FOGGED_FACE_WEIGHTS).rerollIdx.length
      if (clear !== fogged) differ++
      if (fogged < clear) fewer++
      if (fogged > clear) more++
    }
    // It matters at all...
    expect(differ).toBeGreaterThan(30)
    // ...and it matters in both directions, which is the part the old comment got wrong.
    expect(fewer).toBeGreaterThan(0)
    expect(more).toBeGreaterThan(fewer)
  })
})

describe('every level plays only legal actions with its own stakes', () => {
  // The real risk in a change like this is a new code path emitting an illegal action, not a
  // balance regression — so this is the sweep that matters most. Each level runs on ITS OWN
  // money, which is what exercises the bet clamps differently (easy's 5/2 and hard's 25/6 hit
  // maxBetFor and the raise cap in places the defaults never reach).
  for (const level of ALL_DIFFICULTIES) {
    it(`completes matches and conserves chips on ${level}`, () => {
      const { config, startingBankroll } = stakesFor(level)
      for (let seed = 1; seed <= 12; seed++) {
        const rng = createRng(seed)
        const brains = { human: createRng(seed + 101), bot: createRng(seed + 202) }
        let s = createInitialState({ config, startingBankroll, firstPrimary: 'human' })
        const total = (): number => s.bankroll.human + s.bankroll.bot + s.pot
        let guard = 0
        while (s.phase !== 'MATCH_OVER' && guard < 300) {
          s =
            s.phase === 'HAND_COMPLETE'
              ? reducer(s, { type: 'NEXT_HAND' }, rng)
              : reducer(s, chooseAction(s, s.toAct, brains[s.toAct], level), rng)
          expect(s.bankroll.human).toBeGreaterThanOrEqual(0)
          expect(s.bankroll.bot).toBeGreaterThanOrEqual(0)
          guard++
        }
        expect(s.phase).toBe('MATCH_OVER')
        // No Dado d'Oro can mint here only if none showed up; a doubled payout legitimately
        // grows the total, so the check is one-directional.
        expect(total()).toBeGreaterThanOrEqual(startingBankroll * 2)
      }
    })

    it(`survives a stack of one minimum bet on ${level}`, () => {
      const { config } = stakesFor(level)
      const rng = createRng(4242)
      const brains = { human: createRng(7), bot: createRng(8) }
      let s = createInitialState({ config, startingBankroll: config.minBet })
      let guard = 0
      while (s.phase !== 'MATCH_OVER' && guard < 300) {
        s =
          s.phase === 'HAND_COMPLETE'
            ? reducer(s, { type: 'NEXT_HAND' }, rng)
            : reducer(s, chooseAction(s, s.toAct, brains[s.toAct], level), rng)
        expect(s.bankroll.human).toBeGreaterThanOrEqual(0)
        expect(s.bankroll.bot).toBeGreaterThanOrEqual(0)
        guard++
      }
      expect(s.phase).toBe('MATCH_OVER')
    })
  }
})

describe('the bot deck offset', () => {
  it('shifts the mirrored special count by the level offset', () => {
    const deck = buildDeck(['STELLA_ESSICCATA', 'D4', 'MULINELLO'])
    for (const level of ALL_DIFFICULTIES) {
      const offset = botDeckSpecialsOffsetFor(level)
      const bot = rollBotDeck(createRng(9), deck, offset)
      expect(specialCount(bot)).toBe(specialCount(deck) + offset)
    }
  })

  it('clamps at the edges instead of asking for an impossible deck', () => {
    // An offset does nothing when there is nothing to take away — stated as a test because it is
    // a real limit of the feature (a player with no specials sees no difference on easy).
    const empty = buildDeck([])
    expect(specialCount(rollBotDeck(createRng(1), empty, -1))).toBe(0)

    const everything = buildDeck([
      'STELLA_ESSICCATA',
      'D4',
      'NERO_DI_SEPPIA',
      'DADO_D_ORO',
      'DADO_TORPEDO',
      'MULINELLO',
      'DADO_SPUGNA',
      'DADO_LANTERNA',
      'DADO_BRUMEGGIO',
      'DADO_PAGURO',
    ])
    const full = specialCount(everything)
    expect(specialCount(rollBotDeck(createRng(1), everything, 1))).toBe(full)
  })
})
