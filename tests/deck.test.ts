import { describe, expect, it } from 'vitest'
import {
  ALL_ABILITY_IDS,
  DECK_SIZE,
  HAND_SIZE,
  MAX_SPECIALS_PER_DECK,
  PLAIN_DECK,
  buildDeck,
  createInitialState,
  createRng,
  deckSpecials,
  drawHandFromDeck,
  reducer,
  rollBotDeck,
  rollRandomBotDeck,
  specialCount,
  validateDeck,
  type AbilityId,
  type Deck,
  type Rng,
} from '../src/engine'

/** Every legal deck composition: the power set of the registered abilities. */
function allDecks(): readonly Deck[] {
  const out: Deck[] = []
  for (let mask = 0; mask < 1 << ALL_ABILITY_IDS.length; mask++) {
    const specials = ALL_ABILITY_IDS.filter((_, i) => (mask & (1 << i)) !== 0)
    out.push(buildDeck(specials))
  }
  return out
}

/** Counts each distinct entry (ability id or null) in a list of deck slots. */
function tally(slots: readonly (AbilityId | null)[]): Map<AbilityId | null, number> {
  const m = new Map<AbilityId | null, number>()
  for (const s of slots) {
    m.set(s, (m.get(s) ?? 0) + 1)
  }
  return m
}

/** Wraps an Rng to count how many draws each method consumes. */
function countingRng(seed: number): { rng: Rng; counts: { next: number; nextInt: number } } {
  const inner = createRng(seed)
  const counts = { next: 0, nextInt: 0 }
  const rng: Rng = {
    next: () => {
      counts.next++
      return inner.next()
    },
    nextInt: (min, max) => {
      counts.nextInt++
      return inner.nextInt(min, max)
    },
    rollDie: () => inner.rollDie(),
  }
  return { rng, counts }
}

describe('buildDeck', () => {
  it('always produces exactly DECK_SIZE dice, for any number of specials', () => {
    for (let n = 0; n <= MAX_SPECIALS_PER_DECK; n++) {
      const deck = buildDeck(ALL_ABILITY_IDS.slice(0, n))
      expect(deck).toHaveLength(DECK_SIZE)
      expect(specialCount(deck)).toBe(n)
    }
  })

  it('never repeats a special, even when handed duplicates', () => {
    const id = ALL_ABILITY_IDS[0]!
    const deck = buildDeck([id, id, id])
    expect(specialCount(deck)).toBe(1)
    expect(validateDeck(deck)).toEqual([])
  })

  it('places specials in registry order, so the same set yields the same deck', () => {
    const forwards = buildDeck([...ALL_ABILITY_IDS])
    const backwards = buildDeck([...ALL_ABILITY_IDS].reverse())
    expect(backwards).toEqual(forwards)
  })

  it('PLAIN_DECK is a valid deck of ten plain dice', () => {
    expect(PLAIN_DECK).toHaveLength(DECK_SIZE)
    expect(specialCount(PLAIN_DECK)).toBe(0)
    expect(validateDeck(PLAIN_DECK)).toEqual([])
  })

  it('every legal composition validates', () => {
    for (const deck of allDecks()) {
      expect(validateDeck(deck)).toEqual([])
    }
  })
})

describe('validateDeck catches malformed decks', () => {
  it('reports the wrong length', () => {
    expect(validateDeck([null, null]).length).toBeGreaterThan(0)
  })

  it('reports a duplicated special', () => {
    const id = ALL_ABILITY_IDS[0]!
    // Hand-crafted around buildDeck, which would have deduplicated it.
    const bad: Deck = [id, id, ...Array.from({ length: DECK_SIZE - 2 }, () => null)]
    expect(validateDeck(bad).some((p) => /più di una volta/.test(p))).toBe(true)
  })

  it('reports an unknown ability id', () => {
    const bad = ['NOPE' as AbilityId, ...Array.from({ length: DECK_SIZE - 1 }, () => null)]
    expect(validateDeck(bad).some((p) => /sconosciuta/.test(p))).toBe(true)
  })

  it('createInitialState rejects an invalid deck', () => {
    expect(() => createInitialState({ decks: { human: [null, null] } })).toThrow(/invalid deck/)
  })

  it('createInitialState rejects a seat given both a deck and a pinned loadout', () => {
    expect(() =>
      createInitialState({
        decks: { human: PLAIN_DECK },
        loadouts: { human: [null, null, null, null] },
      }),
    ).toThrow(/both a deck and a pinned loadout/)
  })
})

describe('drawHandFromDeck', () => {
  it('draws exactly HAND_SIZE dice, all of them from the deck', () => {
    const rng = createRng(1)
    for (const deck of allDecks()) {
      for (let i = 0; i < 200; i++) {
        const hand = drawHandFromDeck(rng, deck)
        expect(hand).toHaveLength(HAND_SIZE)

        // Multiset subset: no entry may appear more often than the deck holds it.
        const inDeck = tally(deck)
        for (const [slot, n] of tally(hand)) {
          expect(n).toBeLessThanOrEqual(inDeck.get(slot) ?? 0)
        }
      }
    }
  })

  it('never draws the same special twice — the player-visible rule', () => {
    const rng = createRng(2)
    const full = buildDeck([...ALL_ABILITY_IDS])
    for (let i = 0; i < 3_000; i++) {
      const specials = deckSpecials(drawHandFromDeck(rng, full))
      expect(new Set(specials).size).toBe(specials.length)
    }
  })

  it('leaves the deck unmutated', () => {
    const rng = createRng(3)
    const deck = buildDeck([...ALL_ABILITY_IDS])
    const before = [...deck]
    for (let i = 0; i < 50; i++) {
      drawHandFromDeck(rng, deck)
    }
    expect(deck).toEqual(before)
  })

  it('consumes a FIXED number of Rng draws whatever the deck holds', () => {
    // The discipline that keeps a seed reproducible: the draw count must not depend on the
    // deck's contents, or every downstream roll shifts.
    for (const deck of allDecks()) {
      const { rng, counts } = countingRng(7)
      drawHandFromDeck(rng, deck)
      expect(counts.nextInt).toBe(HAND_SIZE)
      expect(counts.next).toBe(0)
    }
  })

  it('is deterministic: same seed and deck give the same hand', () => {
    const deck = buildDeck([...ALL_ABILITY_IDS])
    const a = drawHandFromDeck(createRng(99), deck)
    const b = drawHandFromDeck(createRng(99), deck)
    expect(a).toEqual(b)
  })

  it('draws a given special in about HAND_SIZE/DECK_SIZE of hands', () => {
    // This is the number the deck builder promises the player, so it is worth pinning.
    // It is also the assertion that catches an off-by-one in the Fisher-Yates bound.
    const rng = createRng(4242)
    const id = ALL_ABILITY_IDS[0]!
    const deck = buildDeck([id])
    const trials = 20_000
    let seen = 0
    for (let i = 0; i < trials; i++) {
      if (drawHandFromDeck(rng, deck).includes(id)) seen++
    }
    const expected = HAND_SIZE / DECK_SIZE
    expect(seen / trials).toBeGreaterThan(expected - 0.02)
    expect(seen / trials).toBeLessThan(expected + 0.02)
  })

  it('draws from every deck position, roughly uniformly', () => {
    // Mark each slot with a distinct id by position: use a plain deck and track which
    // INDEX was taken, via a stub Rng-free approach — instead, count how often the single
    // special lands in the hand when it starts at each position of an equivalent deck.
    // A biased bound (e.g. nextInt(i, DECK_SIZE-2)) would starve the last position.
    const rng = createRng(808)
    const id = ALL_ABILITY_IDS[0]!
    const trials = 8_000
    for (let pos = 0; pos < DECK_SIZE; pos++) {
      const deck: Deck = Array.from({ length: DECK_SIZE }, (_, i) => (i === pos ? id : null))
      let seen = 0
      for (let i = 0; i < trials; i++) {
        if (drawHandFromDeck(rng, deck).includes(id)) seen++
      }
      const rate = seen / trials
      // Bounds derived from HAND_SIZE/DECK_SIZE rather than hardcoded, so they follow the
      // deck size instead of failing whenever it changes.
      const expected = HAND_SIZE / DECK_SIZE
      expect(rate).toBeGreaterThan(expected - 0.04)
      expect(rate).toBeLessThan(expected + 0.04)
    }
  })
})

describe('rollBotDeck', () => {
  it('matches the human deck special count, for every composition', () => {
    for (const human of allDecks()) {
      for (let seed = 0; seed < 30; seed++) {
        const bot = rollBotDeck(createRng(seed), human)
        expect(specialCount(bot)).toBe(specialCount(human))
        expect(validateDeck(bot)).toEqual([])
      }
    }
  })

  it('is deterministic: same seed and human deck give the same bot deck', () => {
    const human = buildDeck([ALL_ABILITY_IDS[0]!])
    expect(rollBotDeck(createRng(5), human)).toEqual(rollBotDeck(createRng(5), human))
  })

  it('varies across seeds when there is more than one way to choose', () => {
    // One special out of N: different seeds must eventually pick different abilities.
    const human = buildDeck([ALL_ABILITY_IDS[0]!])
    const seen = new Set<string>()
    for (let seed = 0; seed < 60; seed++) {
      seen.add(deckSpecials(rollBotDeck(createRng(seed), human)).join('|'))
    }
    expect(seen.size).toBeGreaterThan(1)
    expect(seen.size).toBeLessThanOrEqual(ALL_ABILITY_IDS.length)
  })

  it('a plain human deck yields a plain bot deck', () => {
    expect(rollBotDeck(createRng(11), PLAIN_DECK)).toEqual(PLAIN_DECK)
  })
})

describe('rollRandomBotDeck', () => {
  const FULL = buildDeck([...ALL_ABILITY_IDS])

  it('always builds a valid deck', () => {
    for (let seed = 0; seed < 60; seed++) {
      const bot = rollRandomBotDeck(createRng(seed))
      expect(validateDeck(bot)).toEqual([])
      expect(bot).toHaveLength(DECK_SIZE)
    }
  })

  it('varies its special COUNT across seeds — the whole point of this mode', () => {
    // Without this the mode could return a plain deck every time and still look like it works.
    const counts = new Set<number>()
    for (let seed = 0; seed < 200; seed++) {
      counts.add(specialCount(rollRandomBotDeck(createRng(seed))))
    }
    expect(counts.size).toBeGreaterThan(1)
    // And it must stay inside what a deck can hold.
    for (const n of counts) {
      expect(n).toBeLessThanOrEqual(MAX_SPECIALS_PER_DECK)
    }
  })

  it('ignores the human deck entirely, unlike rollBotDeck', () => {
    // Same seed, same call: the count owes nothing to what the human brought. Contrast the
    // mirrored mode, whose count is exactly specialCount(humanDeck).
    for (let seed = 0; seed < 40; seed++) {
      expect(rollRandomBotDeck(createRng(seed))).toEqual(rollRandomBotDeck(createRng(seed)))
    }
    // At least one seed must disagree with the mirrored count for a FULL human deck, otherwise
    // the two modes are indistinguishable in practice.
    const differs = Array.from({ length: 60 }, (_, seed) => seed).some(
      (seed) =>
        specialCount(rollRandomBotDeck(createRng(seed))) !== specialCount(FULL),
    )
    expect(differs).toBe(true)
  })
})

describe('deck mode in a match', () => {
  const FULL = buildDeck([...ALL_ABILITY_IDS])

  /** Drives a fresh state through the roll-off and initial bet, landing in STEAL. */
  function playToSteal(
    state: ReturnType<typeof createInitialState>,
    rng: Rng,
  ): ReturnType<typeof createInitialState> {
    let s = state
    while (s.phase === 'ROLL_OFF') {
      s = reducer(s, { type: 'ROLL_OFF' }, rng)
    }
    s = reducer(s, { type: 'OPEN', player: s.primary, amount: 10 }, rng)
    s = reducer(s, { type: 'CALL', player: s.primary === 'human' ? 'bot' : 'human' }, rng)
    expect(s.phase).toBe('STEAL')
    return s
  }

  /** From STEAL, plays out to HAND_COMPLETE (or MATCH_OVER) with minimum bets. */
  function finishHand(
    state: ReturnType<typeof createInitialState>,
    rng: Rng,
  ): ReturnType<typeof createInitialState> {
    const other = (p: 'human' | 'bot'): 'human' | 'bot' => (p === 'human' ? 'bot' : 'human')
    // A Dado Torpedo makes the reroll's target mandatory, so supply one when the seat holds
    // it. Fixed index 0 so the helper stays deterministic.
    const reroll = (
      s0: ReturnType<typeof createInitialState>,
      player: 'human' | 'bot',
    ): Parameters<typeof reducer>[1] => {
      const hand = s0.hands[player]
      const holds =
        (hand.own ?? []).some((d) => d.ability === 'DADO_TORPEDO') ||
        hand.stolen?.ability === 'DADO_TORPEDO'
      return holds
        ? { type: 'REROLL', player, ownIndices: [], torpedoTarget: 0 }
        : { type: 'REROLL', player, ownIndices: [] }
    }
    let s = state
    s = reducer(s, { type: 'STEAL', player: s.primary, commonIndex: 0 }, rng)
    s = reducer(s, { type: 'STEAL', player: other(s.primary), commonIndex: 1 }, rng)
    s = reducer(s, reroll(s, s.primary), rng)
    s = reducer(s, reroll(s, other(s.primary)), rng)
    // The second bet is settled BEFORE the chosen dice are thrown; the Mulinello and Paguro
    // phases (which need a result to look at) come after it.
    if (s.phase === 'SECOND_BET') {
      s = reducer(s, { type: 'OPEN', player: s.primary, amount: 10 }, rng)
      s = reducer(s, { type: 'CALL', player: other(s.primary) }, rng)
    }
    // A full deck can hand a seat a Mulinello, which opens a phase of its own. Decline it:
    // this helper is about deck plumbing, and an extra roll would move the dice underneath
    // tests that are measuring something else.
    while (s.phase === 'MULINELLO_SELECT') {
      s = reducer(s, { type: 'MULINELLO_PASS', player: s.toAct }, rng)
    }
    // A full deck can likewise hand a seat a Dado Paguro, which opens a blind-pick phase.
    // Make the pick (index 0) so the hand can finish; the face is neutral either way.
    while (s.phase === 'PAGURO_SELECT') {
      s = reducer(s, { type: 'PAGURO_CHOOSE', player: s.toAct, index: 0 }, rng)
    }
    return s
  }

  it('reports deck mode in the state and stores both decks', () => {
    const state = createInitialState({ decks: { human: FULL, bot: FULL } })
    expect(state.ownDiceSource.human.kind).toBe('deck')
    expect(state.ownDiceSource.bot.kind).toBe('deck')
    expect(state.decks.human).toEqual(FULL)
    expect(state.decks.bot).toEqual(FULL)
    // Deck mode is not pinned mode.
    expect(state.pinnedLoadouts).toEqual({ human: false, bot: false })
  })

  it('draws a fresh hand from the deck every hand, always a subset of the deck', () => {
    const rng = createRng(31)
    let s = createInitialState({ decks: { human: FULL, bot: FULL } })

    const seen: string[] = []
    for (let hand = 0; hand < 8; hand++) {
      s = playToSteal(s, rng)

      for (const seat of ['human', 'bot'] as const) {
        const drawn = s.loadouts[seat]
        expect(drawn).toHaveLength(HAND_SIZE)

        const inDeck = tally(s.decks[seat]!)
        for (const [slot, n] of tally(drawn)) {
          expect(n).toBeLessThanOrEqual(inDeck.get(slot) ?? 0)
        }
        // And no ability appears that is not in the deck at all.
        for (const id of deckSpecials(drawn)) {
          expect(deckSpecials(s.decks[seat]!)).toContain(id)
        }
      }
      seen.push(s.loadouts.human.join('|'))

      s = finishHand(s, rng)
      if (s.phase === 'MATCH_OVER') break
      s = reducer(s, { type: 'NEXT_HAND' }, rng)
    }

    // Re-drawn each hand, so across several hands the hand must not be constant.
    expect(new Set(seen).size).toBeGreaterThan(1)
  })

  it('a plain deck on both seats leaves every die plain, hand after hand', () => {
    const rng = createRng(32)
    let s = createInitialState({
      decks: { human: PLAIN_DECK, bot: PLAIN_DECK },
      abilityDrops: { ownChance: 1, commonChance: 0, pool: ALL_ABILITY_IDS },
    })

    for (let hand = 0; hand < 4; hand++) {
      s = playToSteal(s, rng)
      for (const seat of ['human', 'bot'] as const) {
        // ownChance is 1 but must be IGNORED in deck mode.
        expect(s.hands[seat].own!.every((d) => d.ability === undefined)).toBe(true)
      }
      expect(s.common!.every((d) => d.ability === undefined)).toBe(true)
      s = finishHand(s, rng)
      if (s.phase === 'MATCH_OVER') break
      s = reducer(s, { type: 'NEXT_HAND' }, rng)
    }
  })

  it('common dice still draw abilities in deck mode', () => {
    const rng = createRng(33)
    const s = playToSteal(
      createInitialState({
        decks: { human: PLAIN_DECK, bot: PLAIN_DECK },
        abilityDrops: { ownChance: 0, commonChance: 1, pool: ALL_ABILITY_IDS },
      }),
      rng,
    )
    expect(s.common!.some((d) => d.ability !== undefined)).toBe(true)
  })

  it('mixes with pinned mode: deck on one seat, fixed loadout on the other', () => {
    const rng = createRng(34)
    const pinned = ['STELLA_ESSICCATA', null, null, null] as const
    const s = playToSteal(
      createInitialState({ decks: { human: FULL }, loadouts: { bot: pinned } }),
      rng,
    )
    expect(s.ownDiceSource.human.kind).toBe('deck')
    expect(s.ownDiceSource.bot.kind).toBe('pinned')
    expect(s.pinnedLoadouts).toEqual({ human: false, bot: true })
    expect(s.loadouts.bot).toEqual(pinned)
  })

  it('is fully deterministic: same seed and decks give an identical match', () => {
    const play = (): ReturnType<typeof createInitialState> => {
      const rng = createRng(1234)
      let s = createInitialState({ decks: { human: FULL, bot: FULL } })
      for (let hand = 0; hand < 4; hand++) {
        s = playToSteal(s, rng)
        s = finishHand(s, rng)
        if (s.phase === 'MATCH_OVER') break
        s = reducer(s, { type: 'NEXT_HAND' }, rng)
      }
      return s
    }
    const a = play()
    const b = play()
    expect(a.log).toEqual(b.log)
    expect(a.score).toEqual(b.score)
  })
})
