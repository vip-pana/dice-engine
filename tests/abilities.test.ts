import { describe, expect, it } from 'vitest'
import {
  ABILITIES,
  ALL_ABILITY_IDS,
  abilitySpec,
  createInitialState,
  createRng,
  reducer,
  rerollDie,
  rollCommonDice,
  rollDieWithAbility,
  rollOwnDice,
  rollRandomLoadout,
  viewFor,
  type AbilityId,
  type DieValue,
  type Loadout,
} from '../src/engine'

const STELLA_ONLY: Loadout = ['STELLA_ESSICCATA', null, null, null]

describe('ability registry', () => {
  it('every registered ability is self-consistent', () => {
    for (const id of ALL_ABILITY_IDS) {
      const spec = ABILITIES[id]
      expect(spec.id).toBe(id)
      expect(spec.name.length).toBeGreaterThan(0)
      expect(spec.icon.length).toBeGreaterThan(0)
      expect(spec.diceRolled).toBeGreaterThanOrEqual(1)
    }
  })

  it('roll() produces exactly diceRolled faces, and resolve() picks one of them', () => {
    const rng = createRng(7)
    for (const id of ALL_ABILITY_IDS) {
      const spec = ABILITIES[id]
      for (let i = 0; i < 200; i++) {
        const rolls = spec.roll(rng)
        expect(rolls).toHaveLength(spec.diceRolled)
        expect(rolls.every((v) => v >= 1 && v <= 6)).toBe(true)
        expect(rolls).toContain(spec.resolve(rolls))
      }
    }
  })

  it('abilitySpec returns null for a plain die', () => {
    expect(abilitySpec(null)).toBeNull()
    expect(abilitySpec(undefined)).toBeNull()
  })
})

describe('STELLA_ESSICCATA: splits into 3 and keeps the highest', () => {
  it('the kept value is always the max of the three rolled faces', () => {
    const rng = createRng(99)
    for (let i = 0; i < 2000; i++) {
      const die = rollDieWithAbility(rng, 'STELLA_ESSICCATA')
      expect(die.rolls).toHaveLength(3)
      expect(die.value).toBe(Math.max(...die.rolls!))
      expect(die.ability).toBe('STELLA_ESSICCATA')
    }
  })

  it('has the expected value of max-of-3 (≈4.958), well above a plain die', () => {
    const rng = createRng(1234)
    const samples = 60_000
    let total = 0
    for (let i = 0; i < samples; i++) {
      total += rollDieWithAbility(rng, 'STELLA_ESSICCATA').value
    }
    const mean = total / samples
    // Exact E[max of 3 d6] = 1 + sum_{k=1..5} (1 - (k/6)^3) = 4.958333...
    expect(mean).toBeGreaterThan(4.85)
    expect(mean).toBeLessThan(5.06)
  })

  it('rolls a 6 far more often than a plain die (exact P = 91/216 ≈ 0.421)', () => {
    const rng = createRng(555)
    const samples = 40_000
    let sixes = 0
    for (let i = 0; i < samples; i++) {
      if (rollDieWithAbility(rng, 'STELLA_ESSICCATA').value === 6) sixes++
    }
    expect(sixes / samples).toBeGreaterThan(0.39)
    expect(sixes / samples).toBeLessThan(0.45)
  })
})

describe('D4: a 4-sided die', () => {
  it('only ever shows 1..4, never a 5 or a 6', () => {
    const rng = createRng(2024)
    const seen = new Set<number>()
    for (let i = 0; i < 5_000; i++) {
      const die = rollDieWithAbility(rng, 'D4')
      expect(die.ability).toBe('D4')
      expect(die.value).toBeGreaterThanOrEqual(1)
      expect(die.value).toBeLessThanOrEqual(4)
      seen.add(die.value)
    }
    // All four faces must actually occur.
    expect([...seen].sort()).toEqual([1, 2, 3, 4])
  })

  it('has the expected value of a d4 (2.5), below a plain d6', () => {
    const rng = createRng(31337)
    const samples = 60_000
    let total = 0
    for (let i = 0; i < samples; i++) {
      total += rollDieWithAbility(rng, 'D4').value
    }
    const mean = total / samples
    expect(mean).toBeGreaterThan(2.42)
    expect(mean).toBeLessThan(2.58)
  })

  it('rolls a single face, so it records no multi-die split', () => {
    const rng = createRng(5)
    const die = rollDieWithAbility(rng, 'D4')
    expect(die.rolls).toHaveLength(1)
    expect(die.rolls![0]).toBe(die.value)
  })

  it('keeps its ability through a reroll', () => {
    const rng = createRng(6)
    const rerolled = rerollDie(rng, rollDieWithAbility(rng, 'D4'))
    expect(rerolled.ability).toBe('D4')
    expect(rerolled.value).toBeLessThanOrEqual(4)
  })

  it('is visible in the log even though it rolls a single face', () => {
    // Regression: the log used to require a 2+ face split, so a D4 printed as a bare
    // number and was indistinguishable from a plain die.
    const rng = createRng(4)
    const state = playToSteal(
      createInitialState({ loadouts: { human: ['D4', null, null, null] } }),
      rng,
    )
    const rollLine = state.log.find((l) => l.startsWith('Lancio —'))!
    expect(rollLine).toContain(ABILITIES.D4.icon)
    // Icon + value, with no split parentheses for a single-face ability.
    expect(rollLine).toMatch(/▲[1-4](?!\s*\()/)
  })
})

describe('NERO_DI_SEPPIA: conceals an opponent die', () => {
  const SEPPIA_ONLY: Loadout = ['NERO_DI_SEPPIA', null, null, null]

  it('hides exactly one of the OPPONENT dice, not its own', () => {
    const rng = createRng(101)
    const state = playToSteal(
      createInitialState({ loadouts: { bot: SEPPIA_ONLY } }),
      rng,
    )
    // The bot holds the seppia -> the human loses sight of one die.
    expect(state.hands.human.concealedIndices).toHaveLength(1)
    expect(state.hands.bot.concealedIndices).toHaveLength(0)

    const hidden = state.hands.human.concealedIndices[0]!
    expect(hidden).toBeGreaterThanOrEqual(0)
    expect(hidden).toBeLessThan(4)
  })

  it('conceals nothing when nobody rolled one', () => {
    const rng = createRng(102)
    const state = playToSteal(createInitialState(), rng)
    expect(state.hands.human.concealedIndices).toHaveLength(0)
    expect(state.hands.bot.concealedIndices).toHaveLength(0)
  })

  it('is symmetric: both seats holding one both lose a die', () => {
    const rng = createRng(103)
    const state = playToSteal(
      createInitialState({ loadouts: { human: SEPPIA_ONLY, bot: SEPPIA_ONLY } }),
      rng,
    )
    expect(state.hands.human.concealedIndices).toHaveLength(1)
    expect(state.hands.bot.concealedIndices).toHaveLength(1)
  })

  it('keeps the TRUE value in engine state — concealment is knowledge, not value', () => {
    const rng = createRng(104)
    const state = playToSteal(createInitialState({ loadouts: { bot: SEPPIA_ONLY } }), rng)
    const hidden = state.hands.human.concealedIndices[0]!
    const die = state.hands.human.own![hidden]!
    // The reducer never masks: a real face is still there for evaluation.
    expect(die.value).toBeGreaterThanOrEqual(1)
    expect(die.value).toBeLessThanOrEqual(6)
    expect(die.concealed).toBeUndefined()
  })

  it('viewFor masks the die for its owner but not for the opponent', () => {
    const rng = createRng(105)
    const state = playToSteal(createInitialState({ loadouts: { bot: SEPPIA_ONLY } }), rng)
    const hidden = state.hands.human.concealedIndices[0]!
    const trueValue = state.hands.human.own![hidden]!.value

    // The human cannot read their own hidden die...
    const humanView = viewFor(state, 'human')
    expect(humanView.hands.human.own![hidden]!.concealed).toBe(true)
    expect(humanView.hands.human.own![hidden]!.rolls).toBeUndefined()

    // ...but the bot, who cast it, still sees the real face (open information).
    const botView = viewFor(state, 'bot')
    expect(botView.hands.human.own![hidden]!.value).toBe(trueValue)
    expect(botView.hands.human.own![hidden]!.concealed).toBeUndefined()
  })

  it('the hidden die still counts in full at the showdown', () => {
    const rng = createRng(106)
    let state = playToSteal(createInitialState({ loadouts: { bot: SEPPIA_ONLY } }), rng)
    const hidden = state.hands.human.concealedIndices[0]!
    // Keep every die, so the concealed value survives untouched into the showdown.
    state = reducer(state, { type: 'STEAL', player: state.primary, commonIndex: 0 }, rng)
    state = reducer(state, { type: 'STEAL', player: other(state.primary), commonIndex: 1 }, rng)
    const keptValue = state.hands.human.own![hidden]!.value

    state = reducer(state, { type: 'REROLL', player: state.primary, ownIndices: [] }, rng)
    state = reducer(state, { type: 'REROLL', player: other(state.primary), ownIndices: [] }, rng)
    state = reducer(state, { type: 'OPEN', player: state.primary, amount: 10 }, rng)
    state = reducer(state, { type: 'CALL', player: other(state.primary) }, rng)

    expect(state.lastShowdown).not.toBeNull()
    // The evaluated hand contains the once-hidden face.
    expect(state.lastShowdown!.human.values).toContain(keptValue)
  })

  it('reveals at the showdown: concealment is cleared', () => {
    const rng = createRng(107)
    let state = playToSteal(createInitialState({ loadouts: { bot: SEPPIA_ONLY } }), rng)
    expect(state.hands.human.concealedIndices).toHaveLength(1)

    state = reducer(state, { type: 'STEAL', player: state.primary, commonIndex: 0 }, rng)
    state = reducer(state, { type: 'STEAL', player: other(state.primary), commonIndex: 1 }, rng)
    state = reducer(state, { type: 'REROLL', player: state.primary, ownIndices: [] }, rng)
    state = reducer(state, { type: 'REROLL', player: other(state.primary), ownIndices: [] }, rng)
    state = reducer(state, { type: 'OPEN', player: state.primary, amount: 10 }, rng)
    state = reducer(state, { type: 'CALL', player: other(state.primary) }, rng)

    expect(state.hands.human.concealedIndices).toHaveLength(0)
    // And the view no longer masks anything.
    expect(viewFor(state, 'human').hands.human.own!.every((d) => !d.concealed)).toBe(true)
  })

  it('a concealed die can be rerolled blind and stays concealed', () => {
    const rng = createRng(108)
    let state = playToSteal(createInitialState({ loadouts: { bot: SEPPIA_ONLY } }), rng)
    const hidden = state.hands.human.concealedIndices[0]!

    state = reducer(state, { type: 'STEAL', player: state.primary, commonIndex: 0 }, rng)
    state = reducer(state, { type: 'STEAL', player: other(state.primary), commonIndex: 1 }, rng)
    // The human rerolls the very die they cannot see.
    state = reducer(state, { type: 'REROLL', player: 'human', ownIndices: [hidden] }, rng)
    state = reducer(
      state,
      { type: 'REROLL', player: 'bot', ownIndices: [] },
      rng,
    )
    // Still hidden while the hand is live (SECOND_BET), not revealed by the reroll.
    if (state.phase === 'SECOND_BET') {
      expect(state.hands.human.concealedIndices).toContain(hidden)
      expect(viewFor(state, 'human').hands.human.own![hidden]!.concealed).toBe(true)
    }
  })

  // --- Common (unowned) Nero di Seppia ---
  //
  // An unclaimed one belongs to nobody, so it blinds BOTH seats; stealing it narrows the
  // malus to the opponent alone. `commonChance: 1` with a Seppia-only pool puts it among
  // the commons deterministically.
  const COMMON_SEPPIA = {
    abilityDrops: { ownChance: 0, commonChance: 1, pool: ['NERO_DI_SEPPIA' as AbilityId] },
  }
  const seppiaCommonIndex = (state: ReturnType<typeof createInitialState>): number =>
    state.common!.findIndex((d) => d.ability === 'NERO_DI_SEPPIA')

  it('a common Nero di Seppia can now roll up at all', () => {
    // It used to be ownOnly, which filtered it out of the commons entirely.
    const rng = createRng(201)
    const common = rollCommonDice(rng, COMMON_SEPPIA.abilityDrops)
    expect(common.some((d) => d.ability === 'NERO_DI_SEPPIA')).toBe(true)
  })

  it('while unclaimed, it blinds BOTH seats', () => {
    const rng = createRng(202)
    const state = playToSteal(createInitialState(COMMON_SEPPIA), rng)
    expect(seppiaCommonIndex(state)).toBeGreaterThanOrEqual(0)
    expect(state.hands.human.concealedIndices).toHaveLength(1)
    expect(state.hands.bot.concealedIndices).toHaveLength(1)
    // Each seat is masked in its own view.
    expect(viewFor(state, 'human').hands.human.own!.some((d) => d.concealed)).toBe(true)
    expect(viewFor(state, 'bot').hands.bot.own!.some((d) => d.concealed)).toBe(true)
  })

  it('stealing it frees the stealer and keeps the opponent blind', () => {
    const rng = createRng(203)
    let state = playToSteal(createInitialState(COMMON_SEPPIA), rng)
    const seppia = seppiaCommonIndex(state)
    const stealer = state.primary
    const victim = other(stealer)

    state = reducer(state, { type: 'STEAL', player: stealer, commonIndex: seppia }, rng)

    expect(state.hands[stealer].concealedIndices).toHaveLength(0)
    expect(state.hands[victim].concealedIndices).toHaveLength(1)
    expect(viewFor(state, stealer).hands[stealer].own!.every((d) => !d.concealed)).toBe(true)
  })

  it('stealing a NON-seppia common die leaves both seats blind', () => {
    const rng = createRng(204)
    let state = playToSteal(createInitialState(COMMON_SEPPIA), rng)
    const seppia = seppiaCommonIndex(state)
    const plain = [0, 1, 2].find((i) => i !== seppia)!

    state = reducer(state, { type: 'STEAL', player: state.primary, commonIndex: plain }, rng)
    // The Seppia is still unclaimed, so the table-wide malus stands.
    expect(state.hands.human.concealedIndices).toHaveLength(1)
    expect(state.hands.bot.concealedIndices).toHaveLength(1)
  })

  it('if nobody steals it, both stay blind until the showdown reveal', () => {
    const rng = createRng(205)
    let state = playToSteal(createInitialState(COMMON_SEPPIA), rng)
    const seppia = seppiaCommonIndex(state)
    const others = [0, 1, 2].filter((i) => i !== seppia)

    state = reducer(state, { type: 'STEAL', player: state.primary, commonIndex: others[0]! }, rng)
    state = reducer(
      state,
      { type: 'STEAL', player: other(state.primary), commonIndex: others[1]! },
      rng,
    )
    // Both stole a plain die: the Seppia sat there all hand and blinded everyone.
    expect(state.hands.human.concealedIndices).toHaveLength(1)
    expect(state.hands.bot.concealedIndices).toHaveLength(1)

    state = reducer(state, { type: 'REROLL', player: state.primary, ownIndices: [] }, rng)
    state = reducer(state, { type: 'REROLL', player: other(state.primary), ownIndices: [] }, rng)
    state = reducer(state, { type: 'OPEN', player: state.primary, amount: 10 }, rng)
    state = reducer(state, { type: 'CALL', player: other(state.primary) }, rng)

    // The showdown still reveals everything.
    expect(state.hands.human.concealedIndices).toHaveLength(0)
    expect(state.hands.bot.concealedIndices).toHaveLength(0)
  })

  it('never stacks two hidden dice on one seat', () => {
    const rng = createRng(206)
    // Bot holds its own Seppia AND one sits among the commons: the human is targeted by
    // both, but the ability hides ONE die, so the human must lose exactly one.
    const state = playToSteal(
      createInitialState({ ...COMMON_SEPPIA, loadouts: { bot: SEPPIA_ONLY } }),
      rng,
    )
    expect(state.hands.human.concealedIndices).toHaveLength(1)
    expect(state.hands.bot.concealedIndices).toHaveLength(1)
  })

  it('stealing the common one does NOT undo an opponent-owned Seppia', () => {
    const rng = createRng(207)
    let state = playToSteal(
      createInitialState({ ...COMMON_SEPPIA, loadouts: { bot: SEPPIA_ONLY } }),
      rng,
    )
    const seppia = seppiaCommonIndex(state)
    // The human steals the common Seppia, but the BOT's own one still blinds them.
    if (state.toAct !== 'human') {
      const plain = [0, 1, 2].find((i) => i !== seppia)!
      state = reducer(state, { type: 'STEAL', player: 'bot', commonIndex: plain }, rng)
    }
    state = reducer(state, { type: 'STEAL', player: 'human', commonIndex: seppia }, rng)

    expect(state.hands.human.concealedIndices).toHaveLength(1)
  })

  it('the log masks the concealed die for its owner', () => {
    const rng = createRng(109)
    const state = playToSteal(createInitialState({ loadouts: { bot: SEPPIA_ONLY } }), rng)
    const rollLine = state.log.find((l) => l.startsWith('Lancio —'))!
    // The human's side of the line carries a "?" instead of the hidden face.
    expect(rollLine.split('Bot:')[0]).toContain('?')
    expect(state.log.some((l) => /Nero di Seppia/.test(l))).toBe(true)
  })

  it('the log still shows the BOT dice in full when the bot is the one blinded', () => {
    // Regression: masking the bot's hidden die in the human-facing log robbed the caster
    // of the very advantage the ability buys. Only the reader's own die is masked.
    const rng = createRng(111)
    const state = playToSteal(
      createInitialState({ loadouts: { human: SEPPIA_ONLY } }),
      rng,
    )
    expect(state.hands.bot.concealedIndices).toHaveLength(1)

    const rollLine = state.log.find((l) => l.startsWith('Lancio —'))!
    const botPart = rollLine.split('Bot:')[1]!
    expect(botPart).not.toContain('?')
    // Every one of the bot's four faces is spelled out for the human to read.
    for (const die of state.hands.bot.own!) {
      expect(botPart).toContain(String(die.value))
    }
  })

  it('with both seats casting one, each side has exactly one blinded die', () => {
    // The symmetric case: the human must be able to tell that THEIR seppia landed too,
    // which the UI does by marking the opponent die they can still read.
    const rng = createRng(112)
    const state = playToSteal(
      createInitialState({ loadouts: { human: SEPPIA_ONLY, bot: SEPPIA_ONLY } }),
      rng,
    )
    expect(state.hands.human.concealedIndices).toHaveLength(1)
    expect(state.hands.bot.concealedIndices).toHaveLength(1)

    const view = viewFor(state, 'human')
    // Own hidden die: masked. Opponent's hidden die: still readable by us.
    const mine = state.hands.human.concealedIndices[0]!
    const theirs = state.hands.bot.concealedIndices[0]!
    expect(view.hands.human.own![mine]!.concealed).toBe(true)
    expect(view.hands.bot.own![theirs]!.concealed).toBeUndefined()
    expect(view.hands.bot.own![theirs]!.value).toBe(state.hands.bot.own![theirs]!.value)
  })

  it('does drop on a common die, and is not ownOnly any more', () => {
    // Replaces an older test asserting the opposite. It was ownOnly because an unowned
    // Seppia had no target; now an unclaimed one blinds BOTH seats, so it has one.
    expect(ABILITIES.NERO_DI_SEPPIA.ownOnly).not.toBe(true)

    const rng = createRng(110)
    let sawIt = false
    for (let i = 0; i < 400 && !sawIt; i++) {
      const common = rollCommonDice(rng, {
        ownChance: 0,
        commonChance: 1,
        pool: ALL_ABILITY_IDS,
      })
      sawIt = common.some((d) => d.ability === 'NERO_DI_SEPPIA')
    }
    expect(sawIt).toBe(true)
  })
})

describe('plain dice are untouched by the ability layer', () => {
  it('a die with no ability is a bare { value } with no rolls metadata', () => {
    const rng = createRng(3)
    const die = rollDieWithAbility(rng, undefined)
    expect(die.value).toBeGreaterThanOrEqual(1)
    expect(die.value).toBeLessThanOrEqual(6)
    expect(die.ability).toBeUndefined()
    expect(die.rolls).toBeUndefined()
  })

  it('the default loadout consumes exactly 4 faces, matching the base game stream', () => {
    // Same seed, two streams: rolling 4 plain own dice must equal 4 raw rollDie() calls.
    const a = createRng(42)
    const b = createRng(42)
    const own = rollOwnDice(a)
    const raw: DieValue[] = [b.rollDie(), b.rollDie(), b.rollDie(), b.rollDie()]
    expect(own.map((d) => d.value)).toEqual(raw)
  })
})

describe('abilities survive a reroll', () => {
  it('rerollDie keeps the ability and re-applies it', () => {
    const rng = createRng(11)
    const original = rollDieWithAbility(rng, 'STELLA_ESSICCATA')
    const rerolled = rerollDie(rng, original)
    expect(rerolled.ability).toBe('STELLA_ESSICCATA')
    expect(rerolled.rolls).toHaveLength(3)
    expect(rerolled.value).toBe(Math.max(...rerolled.rolls!))
  })

  it('rerollDie on a plain die stays plain', () => {
    const rng = createRng(12)
    const rerolled = rerollDie(rng, { value: 3 })
    expect(rerolled.ability).toBeUndefined()
    expect(rerolled.rolls).toBeUndefined()
  })
})

describe('loadouts in the match state', () => {
  it('defaults to plain dice, so no die carries an ability', () => {
    const rng = createRng(5)
    let state = createInitialState()
    expect(state.loadouts.human.every((a) => a === null)).toBe(true)

    state = playToSteal(state, rng)
    for (const seat of ['human', 'bot'] as const) {
      expect(state.hands[seat].own!.every((d) => d.ability === undefined)).toBe(true)
    }
  })

  it('places the ability on the configured slot only', () => {
    const rng = createRng(6)
    let state = createInitialState({ loadouts: { human: STELLA_ONLY } })
    state = playToSteal(state, rng)

    const own = state.hands.human.own!
    expect(own[0].ability).toBe('STELLA_ESSICCATA')
    expect(own[0].rolls).toHaveLength(3)
    expect(own[0].value).toBe(Math.max(...own[0].rolls!))
    for (const i of [1, 2, 3] as const) {
      expect(own[i].ability).toBeUndefined()
    }
    // The bot was not given a loadout, so all of its dice stay plain.
    expect(state.hands.bot.own!.every((d) => d.ability === undefined)).toBe(true)
  })

  it('a rerolled ability die re-splits, and the ability persists into the showdown', () => {
    const rng = createRng(8)
    let state = createInitialState({ loadouts: { human: STELLA_ONLY } })
    state = playToSteal(state, rng)

    // Both seats steal, then the human rerolls the ability die (slot 0).
    state = reducer(state, { type: 'STEAL', player: state.primary, commonIndex: 0 }, rng)
    state = reducer(state, { type: 'STEAL', player: other(state.primary), commonIndex: 1 }, rng)

    state = reducer(state, { type: 'REROLL', player: state.primary, ownIndices: [0] }, rng)
    state = reducer(state, { type: 'REROLL', player: other(state.primary), ownIndices: [0] }, rng)

    // Second betting round -> showdown applies the rerolls.
    state = reducer(state, { type: 'OPEN', player: state.primary, amount: 10 }, rng)
    state = reducer(state, { type: 'CALL', player: other(state.primary) }, rng)

    expect(state.lastShowdown).not.toBeNull()
    const own = state.hands.human.own!
    expect(own[0].ability).toBe('STELLA_ESSICCATA')
    expect(own[0].rolls).toHaveLength(3)
    expect(own[0].value).toBe(Math.max(...own[0].rolls!))
  })

  it('the log shows the ability split so the effect is visible', () => {
    const rng = createRng(21)
    let state = createInitialState({ loadouts: { human: STELLA_ONLY } })
    state = playToSteal(state, rng)
    const rollLine = state.log.find((l) => l.startsWith('Lancio —'))!
    expect(rollLine).toContain(ABILITIES.STELLA_ESSICCATA.icon)
    // "✵6 (2/6/3)" — the three faces are spelled out.
    expect(rollLine).toMatch(/✵\d \(\d\/\d\/\d\)/)
  })
})

describe('random ability drops', () => {
  const ALWAYS = { ownChance: 1, commonChance: 1, pool: ALL_ABILITY_IDS }
  const NEVER = { ownChance: 0, commonChance: 0, pool: ALL_ABILITY_IDS }

  /** How many slots of a loadout hold an ability. */
  const specialCount = (l: readonly (AbilityId | null)[]): number =>
    l.filter((a) => a !== null).length

  /** How many slots hold each ability id. */
  const countsByAbility = (
    ids: readonly (AbilityId | null | undefined)[],
  ): Map<AbilityId, number> => {
    const m = new Map<AbilityId, number>()
    for (const id of ids) {
      if (id != null) m.set(id, (m.get(id) ?? 0) + 1)
    }
    return m
  }

  it('rollRandomLoadout respects the drop chance at both extremes', () => {
    const rng = createRng(31)
    // At chance 1 every ability in the pool lands exactly once.
    const all = rollRandomLoadout(rng, ALWAYS)
    expect(specialCount(all)).toBe(ALL_ABILITY_IDS.length)
    expect([...countsByAbility(all).values()].every((n) => n === 1)).toBe(true)

    expect(specialCount(rollRandomLoadout(rng, NEVER))).toBe(0)
  })

  it('never puts two dice of the SAME ability in a hand, at any drop rate', () => {
    const rng = createRng(4242)
    for (const chance of [0.1, 0.35, 0.5, 0.9, 1]) {
      const drops = { ownChance: chance, commonChance: 0, pool: ALL_ABILITY_IDS }
      for (let i = 0; i < 3_000; i++) {
        const counts = countsByAbility(rollRandomLoadout(rng, drops))
        for (const n of counts.values()) {
          expect(n).toBe(1)
        }
      }
    }
  })

  it('allows two DIFFERENT abilities to coexist in one hand', () => {
    const rng = createRng(9090)
    const drops = { ownChance: 0.6, commonChance: 0, pool: ALL_ABILITY_IDS }
    let sawTwoDifferent = false
    for (let i = 0; i < 5_000 && !sawTwoDifferent; i++) {
      const counts = countsByAbility(rollRandomLoadout(rng, drops))
      if (counts.size >= 2) sawTwoDifferent = true
    }
    // Only meaningful once there is more than one ability registered.
    expect(sawTwoDifferent).toBe(ALL_ABILITY_IDS.length > 1)
  })

  it('ownChance is the per-ability chance of appearing in the hand', () => {
    const rng = createRng(77)
    const drops = { ownChance: 0.35, commonChance: 0, pool: ALL_ABILITY_IDS }
    const trials = 20_000
    const hits = new Map<AbilityId, number>()
    for (let i = 0; i < trials; i++) {
      for (const [id] of countsByAbility(rollRandomLoadout(rng, drops))) {
        hits.set(id, (hits.get(id) ?? 0) + 1)
      }
    }
    // Each ability independently lands in ~35% of hands.
    for (const id of ALL_ABILITY_IDS) {
      const rate = (hits.get(id) ?? 0) / trials
      expect(rate).toBeGreaterThan(0.33)
      expect(rate).toBeLessThan(0.37)
    }
  })

  it('spreads a special across all 4 slots, roughly uniformly', () => {
    const rng = createRng(808)
    // A single-ability pool, so slot choice is not perturbed by collision shifting.
    const drops = { ownChance: 1, commonChance: 0, pool: ['STELLA_ESSICCATA' as AbilityId] }
    const perSlot = [0, 0, 0, 0]
    const trials = 20_000
    for (let i = 0; i < trials; i++) {
      const slot = rollRandomLoadout(rng, drops).findIndex((a) => a !== null)
      perSlot[slot]!++
    }
    // Uniform over 4 slots = 25% each. A fixed slot would show up as 100%/0%/0%/0%.
    for (const count of perSlot) {
      expect(count / trials).toBeGreaterThan(0.22)
      expect(count / trials).toBeLessThan(0.28)
    }
  })

  it('common dice hold at most one of each ability, and none at rate zero', () => {
    const rng = createRng(64)
    const common = rollCommonDice(rng, ALWAYS)
    expect(common).toHaveLength(3)

    // Own-only abilities (which target "the opponent") never reach the commons.
    const commonPool = ALL_ABILITY_IDS.filter((id) => ABILITIES[id].ownOnly !== true)
    const counts = countsByAbility(common.map((d) => d.ability))
    expect(counts.size).toBe(commonPool.length)
    for (const n of counts.values()) {
      expect(n).toBe(1)
    }
    for (const id of counts.keys()) {
      expect(ABILITIES[id].ownOnly).not.toBe(true)
    }
    // And stay plain when the rate is zero.
    expect(rollCommonDice(rng, NEVER).every((d) => d.ability === undefined)).toBe(true)
  })

  it('never assigns more specials than there are dice', () => {
    const rng = createRng(1717)
    // Pool larger than the 3 common slots: extra abilities must simply not fit.
    const pool = [...ALL_ABILITY_IDS, ...ALL_ABILITY_IDS, ...ALL_ABILITY_IDS]
    for (let i = 0; i < 500; i++) {
      const common = rollCommonDice(rng, { ownChance: 0, commonChance: 1, pool })
      expect(common).toHaveLength(3)
    }
  })

  it('a match with drops re-draws the loadouts every hand', () => {
    const rng = createRng(2026)
    let state = createInitialState({ abilityDrops: { ownChance: 0.5, commonChance: 0.5, pool: ALL_ABILITY_IDS } })
    // Both seats unpinned -> the state's loadouts are placeholders until the first draw.
    expect(state.pinnedLoadouts).toEqual({ human: false, bot: false })

    const seen: string[] = []
    for (let hand = 0; hand < 12; hand++) {
      state = playToSteal(state, rng)
      seen.push(state.loadouts.human.join('|'))
      state = playHandToCompletion(state, rng)
      if (state.phase === 'MATCH_OVER') {
        state = createInitialState({ abilityDrops: { ownChance: 0.5, commonChance: 0.5, pool: ALL_ABILITY_IDS } })
      } else {
        state = reducer(state, { type: 'NEXT_HAND' }, rng)
      }
    }
    // Re-drawn each hand, so across 12 hands the loadout must not be constant.
    expect(new Set(seen).size).toBeGreaterThan(1)
  })

  it('a pinned seat keeps its loadout while the other seat keeps re-drawing', () => {
    const rng = createRng(909)
    let state = createInitialState({
      loadouts: { human: STELLA_ONLY },
      abilityDrops: { ownChance: 0.5, commonChance: 0.5, pool: ALL_ABILITY_IDS },
    })
    expect(state.pinnedLoadouts).toEqual({ human: true, bot: false })

    for (let hand = 0; hand < 6; hand++) {
      state = playToSteal(state, rng)
      // The pinned seat is untouched by the draw, every hand.
      expect(state.loadouts.human).toEqual(STELLA_ONLY)
      expect(state.hands.human.own![0].ability).toBe('STELLA_ESSICCATA')
      state = playHandToCompletion(state, rng)
      if (state.phase === 'MATCH_OVER') break
      state = reducer(state, { type: 'NEXT_HAND' }, rng)
    }
  })

  it('drops disabled leaves every die plain, hand after hand', () => {
    const rng = createRng(13)
    let state = createInitialState()
    for (let hand = 0; hand < 4; hand++) {
      state = playToSteal(state, rng)
      for (const seat of ['human', 'bot'] as const) {
        expect(state.hands[seat].own!.every((d) => d.ability === undefined)).toBe(true)
      }
      expect(state.common!.every((d) => d.ability === undefined)).toBe(true)
      state = playHandToCompletion(state, rng)
      if (state.phase === 'MATCH_OVER') break
      state = reducer(state, { type: 'NEXT_HAND' }, rng)
    }
  })

  it('a stolen special common die keeps its ability in the final hand', () => {
    const rng = createRng(505)
    let state = createInitialState({
      abilityDrops: { ownChance: 0, commonChance: 1, pool: ALL_ABILITY_IDS },
    })
    state = playToSteal(state, rng)
    // commonChance 1 puts one die of each ability among the commons — take the Stella.
    const specialIndex = state.common!.findIndex((d) => d.ability === 'STELLA_ESSICCATA')
    expect(specialIndex).toBeGreaterThanOrEqual(0)

    state = reducer(
      state,
      { type: 'STEAL', player: state.primary, commonIndex: specialIndex },
      rng,
    )
    expect(state.hands[state.primary].stolen!.ability).toBe('STELLA_ESSICCATA')
  })
})

// --- helpers -------------------------------------------------------------

function other(p: 'human' | 'bot'): 'human' | 'bot' {
  return p === 'human' ? 'bot' : 'human'
}

/** From STEAL, plays a hand out to HAND_COMPLETE (or MATCH_OVER) with minimum bets. */
function playHandToCompletion(
  state: ReturnType<typeof createInitialState>,
  rng: ReturnType<typeof createRng>,
): ReturnType<typeof createInitialState> {
  let s = state
  s = reducer(s, { type: 'STEAL', player: s.primary, commonIndex: 0 }, rng)
  s = reducer(s, { type: 'STEAL', player: other(s.primary), commonIndex: 1 }, rng)
  s = reducer(s, { type: 'REROLL', player: s.primary, ownIndices: [] }, rng)
  s = reducer(s, { type: 'REROLL', player: other(s.primary), ownIndices: [] }, rng)
  s = reducer(s, { type: 'OPEN', player: s.primary, amount: 10 }, rng)
  s = reducer(s, { type: 'CALL', player: other(s.primary) }, rng)
  return s
}

/** Drives a fresh state through the roll-off and initial bet, landing in STEAL. */
function playToSteal(
  state: ReturnType<typeof createInitialState>,
  rng: ReturnType<typeof createRng>,
): ReturnType<typeof createInitialState> {
  let s = state
  while (s.phase === 'ROLL_OFF') {
    s = reducer(s, { type: 'ROLL_OFF' }, rng)
  }
  s = reducer(s, { type: 'OPEN', player: s.primary, amount: 10 }, rng)
  s = reducer(s, { type: 'CALL', player: other(s.primary) }, rng)
  expect(s.phase).toBe('STEAL')
  return s
}

// Type-level guard: every AbilityId must have a registry entry (compile-time check).
const _exhaustive: Record<AbilityId, unknown> = ABILITIES
void _exhaustive
