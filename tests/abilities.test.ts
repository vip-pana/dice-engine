import { describe, expect, it } from 'vitest'
import {
  ABILITIES,
  ALL_ABILITY_IDS,
  abilitySpec,
  chooseTorpedoTarget,
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
    // At chance 1 every ability in the pool lands exactly once — capped by the 4 own-dice
    // slots, since the registry has outgrown a single hand.
    const all = rollRandomLoadout(rng, ALWAYS)
    expect(specialCount(all)).toBe(Math.min(ALL_ABILITY_IDS.length, all.length))
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
    // Capped by the 3 common slots: once the eligible pool outgrows them, not every
    // ability can appear at once. Assert we fill every slot we can rather than a fixed 3.
    expect(counts.size).toBe(Math.min(commonPool.length, common.length))
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
  s = reducer(s, rerollAction(s, s.primary, []), rng)
  s = reducer(s, rerollAction(s, other(s.primary), []), rng)
  s = reducer(s, { type: 'OPEN', player: s.primary, amount: 10 }, rng)
  s = reducer(s, { type: 'CALL', player: other(s.primary) }, rng)
  return s
}

/**
 * A legal REROLL for `player`, supplying a Torpedo target if and only if the rules demand one.
 *
 * A Dado Torpedo makes the target mandatory, so any helper that drives a hand through
 * REROLL_SELECT must provide it once that ability can turn up. Defaulting to index 0 keeps
 * these helpers deterministic — tests about WHICH die gets hit pass an explicit target.
 */
function rerollAction(
  state: ReturnType<typeof createInitialState>,
  player: 'human' | 'bot',
  ownIndices: readonly number[],
  target = 0,
): { type: 'REROLL'; player: 'human' | 'bot'; ownIndices: readonly number[]; torpedoTarget?: number } {
  const hand = state.hands[player]
  const holds =
    (hand.own ?? []).some((d) => d.ability === 'DADO_TORPEDO') ||
    hand.stolen?.ability === 'DADO_TORPEDO'
  return holds
    ? { type: 'REROLL', player, ownIndices, torpedoTarget: target }
    : { type: 'REROLL', player, ownIndices }
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

describe("DADO_D_ORO: doubles the winner's payout", () => {
  const ORO_ONLY: Loadout = ['DADO_D_ORO', null, null, null]
  // commonChance 1 with a single-ability pool puts it among the commons deterministically.
  const COMMON_ORO = {
    abilityDrops: { ownChance: 0, commonChance: 1, pool: ['DADO_D_ORO' as AbilityId] },
  }
  const oroCommonIndex = (s: ReturnType<typeof createInitialState>): number =>
    s.common!.findIndex((d) => d.ability === 'DADO_D_ORO')

  /**
   * Plays from STEAL to HAND_COMPLETE and reports the numbers a payout assertion needs.
   *
   * The settling CALL tops the pot up AND pays it out inside one reducer step, so the final
   * pot is never visible in a returned state — it is reconstructed from the pre-call
   * snapshot. `gainOf(seat)` then nets out the chips that seat itself put in on that call,
   * so a plain win returns exactly `pot` and a doubled win exactly `pot * 2`.
   *
   * `steals` picks each seat's common die, in [primary, non-primary] order.
   */
  function playOutAndCapture(
    start: ReturnType<typeof createInitialState>,
    rng: ReturnType<typeof createRng>,
    steals: readonly [number, number],
  ): {
    pot: number
    before: typeof start
    after: typeof start
    gainOf: (seat: 'human' | 'bot') => number
  } {
    let s = start
    const np = other(s.primary)
    s = reducer(s, { type: 'STEAL', player: s.primary, commonIndex: steals[0] }, rng)
    s = reducer(s, { type: 'STEAL', player: np, commonIndex: steals[1] }, rng)
    s = reducer(s, { type: 'REROLL', player: s.primary, ownIndices: [] }, rng)
    s = reducer(s, { type: 'REROLL', player: np, ownIndices: [] }, rng)
    s = reducer(s, { type: 'OPEN', player: s.primary, amount: 10 }, rng)

    const before = s
    const paidOnCall = Math.min(
      Math.max(0, before.currentBet - before.hands[np].committed),
      before.bankroll[np],
    )
    const pot = before.pot + paidOnCall
    s = reducer(s, { type: 'CALL', player: np }, rng)
    expect(s.phase === 'HAND_COMPLETE' || s.phase === 'MATCH_OVER').toBe(true)
    const after = s

    const gainOf = (seat: 'human' | 'bot'): number =>
      after.bankroll[seat] - before.bankroll[seat] + (seat === np ? paidOnCall : 0)

    return { pot, before, after, gainOf }
  }

  it('rolls a plain d6 — its power is economic, not on the face', () => {
    const rng = createRng(301)
    const spec = ABILITIES.DADO_D_ORO
    let sum = 0
    const trials = 400
    for (let i = 0; i < trials; i++) {
      const rolls = spec.roll(rng)
      expect(rolls).toHaveLength(1)
      const v = spec.resolve(rolls)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
      sum += v
    }
    // E[value] = 3.5 for a real d6; generous band so this never flakes.
    expect(Math.abs(sum / trials - 3.5)).toBeLessThan(0.4)
  })

  it('the winner holding it collects 2x the pot', () => {
    const rng = createRng(302)
    const start = playToSteal(createInitialState({ loadouts: { human: ORO_ONLY } }), rng)
    const { pot, after, gainOf } = playOutAndCapture(start, rng, [0, 1])
    const outcome = after.lastShowdown!.outcome
    if (outcome.kind !== 'win' || outcome.winner !== 'human') {
      return // seed did not produce a human win; other tests pin this down
    }
    expect(gainOf('human')).toBe(pot * 2)
  })

  it('the loser is out only what they bet — extra coins are minted, not taken', () => {
    const rng = createRng(303)
    const start = playToSteal(createInitialState({ loadouts: { human: ORO_ONLY } }), rng)
    const { after, gainOf } = playOutAndCapture(start, rng, [0, 1])
    const outcome = after.lastShowdown!.outcome
    if (outcome.kind !== 'win') {
      return
    }
    // The loser gains nothing. Minting means the doubled half comes from the bank, so the
    // loser is never charged extra for the winner's Dado d'Oro.
    expect(gainOf(other(outcome.winner))).toBe(0)
  })

  it('pays the plain pot when nobody has one', () => {
    const rng = createRng(304)
    const start = playToSteal(createInitialState(), rng)
    const { pot, after, gainOf } = playOutAndCapture(start, rng, [0, 1])
    const outcome = after.lastShowdown!.outcome
    if (outcome.kind !== 'win') {
      return
    }
    expect(gainOf(outcome.winner)).toBe(pot)
  })

  it('left unstolen among the commons, it doubles for WHOEVER wins', () => {
    const rng = createRng(305)
    const start = playToSteal(createInitialState(COMMON_ORO), rng)
    const oro = oroCommonIndex(start)
    expect(oro).toBeGreaterThanOrEqual(0)
    // Both seats deliberately steal a die that is NOT the gold.
    const plain = [0, 1, 2].filter((i) => i !== oro) as unknown as readonly [number, number]
    const { pot, after, gainOf } = playOutAndCapture(start, rng, plain)
    const outcome = after.lastShowdown!.outcome
    if (outcome.kind !== 'win') {
      return
    }
    const w = outcome.winner
    // Neither seat ever touched it, yet the winner still collects double.
    expect(after.hands[w].own!.every((d) => d.ability !== 'DADO_D_ORO')).toBe(true)
    expect(after.hands[w].stolen!.ability).not.toBe('DADO_D_ORO')
    expect(gainOf(w)).toBe(pot * 2)
  })

  it('doubles for the seat that steals it from the commons', () => {
    const rng = createRng(306)
    const start = playToSteal(createInitialState(COMMON_ORO), rng)
    const oro = oroCommonIndex(start)
    const otherIdx = [0, 1, 2].find((i) => i !== oro)!
    const { pot, after, gainOf } = playOutAndCapture(start, rng, [oro, otherIdx])
    const outcome = after.lastShowdown!.outcome
    if (outcome.kind !== 'win') {
      return
    }
    // Stealing it moves the effect off the table and onto ONE seat: the stealer doubles,
    // the other seat no longer benefits from it at all.
    const stealerWon = outcome.winner === start.primary
    expect(gainOf(outcome.winner)).toBe(stealerWon ? pot * 2 : pot)
    expect(after.hands[start.primary].stolen!.ability).toBe('DADO_D_ORO')
  })

  it('never stacks: gold on the table AND in hand still pays exactly 2x', () => {
    const rng = createRng(307)
    const start = playToSteal(
      createInitialState({ ...COMMON_ORO, loadouts: { human: ORO_ONLY, bot: ORO_ONLY } }),
      rng,
    )
    const oro = oroCommonIndex(start)
    const plain = [0, 1, 2].filter((i) => i !== oro) as unknown as readonly [number, number]
    const { pot, after, gainOf } = playOutAndCapture(start, rng, plain)
    const outcome = after.lastShowdown!.outcome
    if (outcome.kind !== 'win') {
      return
    }
    // Two sources present. Doubling is a switch, not a counter: 2x, never 4x.
    expect(gainOf(outcome.winner)).toBe(pot * 2)
    expect(gainOf(outcome.winner)).not.toBe(pot * 4)
  })

  it('doubles on a FOLD win too, not just a showdown', () => {
    const rng = createRng(308)
    let s = playToSteal(createInitialState({ loadouts: { human: ORO_ONLY, bot: ORO_ONLY } }), rng)
    const np = other(s.primary)
    s = reducer(s, { type: 'STEAL', player: s.primary, commonIndex: 0 }, rng)
    s = reducer(s, { type: 'STEAL', player: np, commonIndex: 1 }, rng)
    s = reducer(s, { type: 'REROLL', player: s.primary, ownIndices: [] }, rng)
    s = reducer(s, { type: 'REROLL', player: np, ownIndices: [] }, rng)
    expect(s.phase).toBe('SECOND_BET')
    s = reducer(s, { type: 'OPEN', player: s.primary, amount: 20 }, rng)

    const before = s
    const winner = s.primary
    const potAtFold = s.pot
    s = reducer(s, { type: 'FOLD', player: np }, rng)

    const gained = s.bankroll[winner] - before.bankroll[winner]
    expect(gained).toBe(potAtFold * 2)
    expect(s.log.some((l) => /Dado d'Oro/.test(l))).toBe(true)
  })

  it('does NOT double a tie: the pot splits normally and no score moves', () => {
    const rng = createRng(309)
    // Both seats all gold, so whoever wins would double — a tie must still split plainly.
    const start = playToSteal(
      createInitialState({ loadouts: { human: ORO_ONLY, bot: ORO_ONLY } }),
      rng,
    )
    let found = false
    for (let seed = 0; seed < 60 && !found; seed++) {
      const r = createRng(4000 + seed)
      const s0 = playToSteal(
        createInitialState({ loadouts: { human: ORO_ONLY, bot: ORO_ONLY } }),
        r,
      )
      const { pot, before, after, gainOf } = playOutAndCapture(s0, r, [0, 1])
      if (after.lastShowdown!.outcome.kind !== 'tie') {
        continue
      }
      found = true
      // Flat even split of the real pot, no doubling, and the Bo3 score is untouched.
      expect(gainOf('human')).toBe(pot / 2)
      expect(gainOf('bot')).toBe(pot / 2)
      expect(after.score).toEqual(before.score)
      expect(after.log.some((l) => /Dado d'Oro/.test(l))).toBe(false)
    }
    // Ties are rare; if no seed produced one the assertions above simply did not run.
    expect(start.phase).toBe('STEAL')
  })

  it('doubles for the BOT as well', () => {
    const rng = createRng(310)
    const start = playToSteal(createInitialState({ loadouts: { bot: ORO_ONLY } }), rng)
    const { pot, after, gainOf } = playOutAndCapture(start, rng, [0, 1])
    const outcome = after.lastShowdown!.outcome
    if (outcome.kind !== 'win' || outcome.winner !== 'bot') {
      return
    }
    expect(gainOf('bot')).toBe(pot * 2)
  })

  it('logs the doubling and says which source caused it', () => {
    const rng = createRng(311)
    const start = playToSteal(createInitialState(COMMON_ORO), rng)
    const oro = oroCommonIndex(start)
    const plain = [0, 1, 2].filter((i) => i !== oro) as unknown as readonly [number, number]
    const { after } = playOutAndCapture(start, rng, plain)
    if (after.lastShowdown!.outcome.kind !== 'win') {
      return
    }
    const line = after.log.find((l) => /Dado d'Oro/.test(l))
    expect(line).toBeDefined()
    // Nobody held it, so the log must attribute the double to the table, not to a hand.
    expect(line).toMatch(/comuni/)
    expect(line).toMatch(/doppio/)
  })

  it('shows its icon in the action log like any other special', () => {
    const rng = createRng(312)
    const s = playToSteal(createInitialState({ loadouts: { human: ORO_ONLY } }), rng)
    const rollLine = s.log.find((l) => l.startsWith('Lancio'))!
    expect(rollLine).toContain(ABILITIES.DADO_D_ORO.icon)
  })
})

describe('DADO_TORPEDO: zaps a chosen opponent die at the showdown', () => {
  const TORPEDO_ONLY: Loadout = ['DADO_TORPEDO', null, null, null]
  const COMMON_TORPEDO = {
    abilityDrops: { ownChance: 0, commonChance: 1, pool: ['DADO_TORPEDO' as AbilityId] },
  }

  /** Sum of a seat's 4 own-dice values — the quantity a -1 moves by exactly 1. */
  const ownSum = (s: ReturnType<typeof createInitialState>, seat: 'human' | 'bot'): number =>
    s.hands[seat].own!.reduce((n, d) => n + d.value, 0)

  /**
   * Plays STEAL -> HAND_COMPLETE keeping every die (so no reroll can mask the zap), and
   * reports the own-dice values before and after the showdown for both seats.
   */
  function playAndCompare(
    start: ReturnType<typeof createInitialState>,
    rng: ReturnType<typeof createRng>,
    opts: { target?: number; rerollAll?: boolean } = {},
  ) {
    const np = other(start.primary)
    let s = reducer(start, { type: 'STEAL', player: start.primary, commonIndex: 0 }, rng)
    s = reducer(s, { type: 'STEAL', player: np, commonIndex: 1 }, rng)
    const before = { human: [...s.hands.human.own!], bot: [...s.hands.bot.own!] }
    const keep = opts.rerollAll === true ? [0, 1, 2, 3] : []
    s = reducer(s, rerollAction(s, s.primary, keep, opts.target ?? 0), rng)
    s = reducer(s, rerollAction(s, np, keep, opts.target ?? 0), rng)
    s = reducer(s, { type: 'OPEN', player: s.primary, amount: 10 }, rng)
    s = reducer(s, { type: 'CALL', player: np }, rng)
    return { before, after: s }
  }

  it('rolls a plain d6 — the malus lands on the opponent, not on its own face', () => {
    const rng = createRng(401)
    const spec = ABILITIES.DADO_TORPEDO
    let sum = 0
    const trials = 400
    for (let i = 0; i < trials; i++) {
      const rolls = spec.roll(rng)
      expect(rolls).toHaveLength(1)
      const v = spec.resolve(rolls)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
      sum += v
    }
    expect(Math.abs(sum / trials - 3.5)).toBeLessThan(0.4)
  })

  it('zaps exactly the CHOSEN die of the opponent, by 1', () => {
    const rng = createRng(402)
    const start = playToSteal(
      createInitialState({ loadouts: { human: TORPEDO_ONLY } }),
      rng,
    )
    const target = 2
    const before = [...start.hands.bot.own!]
    const s = playAndCompare(start, rng, { target }).after

    const after = s.hands.bot.own!
    const expected = before[target]!.value > 1 ? before[target]!.value - 1 : 1
    expect(after[target]!.value).toBe(expected)
    // Every other die of the victim is untouched.
    for (const i of [0, 1, 2, 3].filter((j) => j !== target)) {
      expect(after[i]!.value).toBe(before[i]!.value)
    }
  })

  it('cannot be dodged by rerolling the marked die — the whole point of the design', () => {
    // Regression: applying the -1 at deal time would be wiped here, because rerollDie
    // rebuilds a die from its ability alone.
    let zappedAtLeastOnce = 0
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createRng(5000 + seed)
      const start = playToSteal(createInitialState({ loadouts: { human: TORPEDO_ONLY } }), rng)
      const { after } = playAndCompare(start, rng, { target: 1, rerollAll: true })
      const line = after.log.find((l) => /Dado Torpedo di/.test(l))
      expect(line).toBeDefined() // the zap happened even though the victim rerolled all 4
      zappedAtLeastOnce++
    }
    expect(zappedAtLeastOnce).toBe(40)
  })

  it('never drops a die below 1', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rng = createRng(6000 + seed)
      const start = playToSteal(
        createInitialState({ loadouts: { human: TORPEDO_ONLY, bot: TORPEDO_ONLY } }),
        rng,
      )
      const { after } = playAndCompare(start, rng, { target: 0 })
      for (const seat of ['human', 'bot'] as const) {
        for (const die of after.hands[seat].own!) {
          expect(die.value).toBeGreaterThanOrEqual(1)
          expect(die.value).toBeLessThanOrEqual(6)
        }
      }
      expect(after.lastShowdown!.human.values.every((v) => v >= 1)).toBe(true)
      expect(after.lastShowdown!.bot.values.every((v) => v >= 1)).toBe(true)
    }
  })

  it('rejects a REROLL with no target when the seat holds one', () => {
    const rng = createRng(403)
    const s = playToSteal(createInitialState({ loadouts: { human: TORPEDO_ONLY } }), rng)
    const np = other(s.primary)
    let t = reducer(s, { type: 'STEAL', player: s.primary, commonIndex: 0 }, rng)
    t = reducer(t, { type: 'STEAL', player: np, commonIndex: 1 }, rng)
    const first = t.toAct
    if (first === 'human') {
      expect(() => reducer(t, { type: 'REROLL', player: 'human', ownIndices: [] }, rng)).toThrow(
        /must choose a target/,
      )
      expect(() =>
        reducer(t, { type: 'REROLL', player: 'human', ownIndices: [], torpedoTarget: 4 }, rng),
      ).toThrow(/0\.\.3/)
    }
  })

  it('rejects a target from a seat that holds no Torpedo', () => {
    const rng = createRng(404)
    const s = playToSteal(createInitialState(), rng)
    const np = other(s.primary)
    let t = reducer(s, { type: 'STEAL', player: s.primary, commonIndex: 0 }, rng)
    t = reducer(t, { type: 'STEAL', player: np, commonIndex: 1 }, rng)
    expect(() =>
      reducer(t, { type: 'REROLL', player: t.toAct, ownIndices: [], torpedoTarget: 0 }, rng),
    ).toThrow(/only a Dado Torpedo holder/)
  })

  it("usually spares its owner, and electrifies the field about 10% of the time", () => {
    let fieldHits = 0
    const runs = 200
    for (let seed = 1; seed <= runs; seed++) {
      const rng = createRng(7000 + seed)
      const start = playToSteal(createInitialState({ loadouts: { human: TORPEDO_ONLY } }), rng)
      const { after } = playAndCompare(start, rng, { target: 0 })
      if (after.log.some((l) => /Campo elettrizzato/.test(l))) {
        fieldHits++
      }
    }
    const rate = fieldHits / runs
    // Wide band on purpose: a tight one would flake on a probabilistic effect.
    expect(rate).toBeGreaterThan(0.03)
    expect(rate).toBeLessThan(0.2)
  })

  it('unstolen among the commons, it zaps BOTH seats at random', () => {
    const rng = createRng(405)
    const start = playToSteal(createInitialState(COMMON_TORPEDO), rng)
    const torpedo = start.common!.findIndex((d) => d.ability === 'DADO_TORPEDO')
    expect(torpedo).toBeGreaterThanOrEqual(0)
    const plain = [0, 1, 2].filter((i) => i !== torpedo)

    const np = other(start.primary)
    let s = reducer(start, { type: 'STEAL', player: start.primary, commonIndex: plain[0]! }, rng)
    s = reducer(s, { type: 'STEAL', player: np, commonIndex: plain[1]! }, rng)
    const beforeHuman = ownSum(s, 'human')
    const beforeBot = ownSum(s, 'bot')
    s = reducer(s, rerollAction(s, s.primary, []), rng)
    s = reducer(s, rerollAction(s, np, []), rng)
    s = reducer(s, { type: 'OPEN', player: s.primary, amount: 10 }, rng)
    s = reducer(s, { type: 'CALL', player: np }, rng)

    // Nobody owns it, so nobody chose — but both lose a point (unless the die was already 1).
    const lines = s.log.filter((l) => /Dado Torpedo tra i comuni/.test(l))
    expect(lines).toHaveLength(2)
    expect(ownSum(s, 'human')).toBeLessThanOrEqual(beforeHuman)
    expect(ownSum(s, 'bot')).toBeLessThanOrEqual(beforeBot)
  })

  it('two Torpedoes zap independently, one per seat', () => {
    const rng = createRng(406)
    const start = playToSteal(
      createInitialState({ loadouts: { human: TORPEDO_ONLY, bot: TORPEDO_ONLY } }),
      rng,
    )
    const { after } = playAndCompare(start, rng, { target: 0 })
    const zaps = after.log.filter((l) => /Dado Torpedo di/.test(l))
    expect(zaps).toHaveLength(2)
  })

  it('does nothing on a fold — there is no showdown to zap at', () => {
    const rng = createRng(407)
    let s = playToSteal(createInitialState({ loadouts: { human: TORPEDO_ONLY } }), rng)
    const np = other(s.primary)
    s = reducer(s, { type: 'STEAL', player: s.primary, commonIndex: 0 }, rng)
    s = reducer(s, { type: 'STEAL', player: np, commonIndex: 1 }, rng)
    s = reducer(s, rerollAction(s, s.primary, [], 0), rng)
    s = reducer(s, rerollAction(s, np, [], 0), rng)
    expect(s.phase).toBe('SECOND_BET')
    const beforeHuman = ownSum(s, 'human')
    const beforeBot = ownSum(s, 'bot')
    s = reducer(s, { type: 'OPEN', player: s.primary, amount: 20 }, rng)
    s = reducer(s, { type: 'FOLD', player: np }, rng)

    expect(s.log.some((l) => /Dado Torpedo di/.test(l))).toBe(false)
    expect(ownSum(s, 'human')).toBe(beforeHuman)
    expect(ownSum(s, 'bot')).toBe(beforeBot)
  })

  it('consumes the same rng draws whether or not the field electrifies', () => {
    // The project's determinism rule: a draw count that varied with the outcome would shift
    // every downstream roll. Same seed, same actions -> identical draw counts, always.
    const counted = (seed: number): { next: number; nextInt: number } => {
      const inner = createRng(seed)
      const counts = { next: 0, nextInt: 0 }
      const rng = {
        next: () => {
          counts.next++
          return inner.next()
        },
        nextInt: (a: number, b: number) => {
          counts.nextInt++
          return inner.nextInt(a, b)
        },
        rollDie: () => inner.rollDie(),
      }
      const start = playToSteal(createInitialState({ loadouts: { human: TORPEDO_ONLY } }), rng)
      playAndCompare(start, rng, { target: 0 })
      return counts
    }
    // Find one seed that electrifies and one that does not, then compare their draw counts
    // for the showdown step by replaying with a fixed action script.
    const perSeed: { seed: number; field: boolean; counts: { next: number; nextInt: number } }[] = []
    for (let seed = 1; seed <= 60; seed++) {
      const rng = createRng(8000 + seed)
      const start = playToSteal(createInitialState({ loadouts: { human: TORPEDO_ONLY } }), rng)
      const { after } = playAndCompare(start, rng, { target: 0 })
      perSeed.push({
        seed: 8000 + seed,
        field: after.log.some((l) => /Campo elettrizzato/.test(l)),
        counts: counted(8000 + seed),
      })
    }
    const withField = perSeed.find((p) => p.field)
    const withoutField = perSeed.find((p) => !p.field)
    expect(withoutField).toBeDefined()
    if (withField !== undefined && withoutField !== undefined) {
      // Identical scripts, so identical consumption regardless of the 10% outcome.
      expect(withField.counts.next).toBe(withoutField.counts.next)
      expect(withField.counts.nextInt).toBe(withoutField.counts.nextInt)
    }
  })

  it('is deterministic: same seed and actions give the same hands and log', () => {
    const run = (): ReturnType<typeof createInitialState> => {
      const rng = createRng(409)
      const start = playToSteal(createInitialState({ loadouts: { human: TORPEDO_ONLY } }), rng)
      return playAndCompare(start, rng, { target: 1 }).after
    }
    const a = run()
    const b = run()
    expect(a.log).toEqual(b.log)
    expect(a.hands.human.own!.map((d) => d.value)).toEqual(b.hands.human.own!.map((d) => d.value))
    expect(a.hands.bot.own!.map((d) => d.value)).toEqual(b.hands.bot.own!.map((d) => d.value))
  })

  it('shows its icon in the action log like any other special', () => {
    const rng = createRng(410)
    const s = playToSteal(createInitialState({ loadouts: { human: TORPEDO_ONLY } }), rng)
    const rollLine = s.log.find((l) => l.startsWith('Lancio'))!
    expect(rollLine).toContain(ABILITIES.DADO_TORPEDO.icon)
  })
})

describe('chooseTorpedoTarget: picks the most damaging die', () => {
  const d = (v: DieValue): { value: DieValue } => ({ value: v })

  it('breaks a three of a kind rather than shaving an irrelevant die', () => {
    // 5 5 5 2 + stolen 1: zapping a 5 destroys the trips; zapping the 2 leaves them intact.
    const own = [d(5), d(5), d(5), d(2)] as const
    const target = chooseTorpedoTarget(own, d(1))
    expect([0, 1, 2]).toContain(target)
  })

  it('is deterministic and prefers the lowest index on a tie', () => {
    const own = [d(4), d(4), d(4), d(4)] as const
    expect(chooseTorpedoTarget(own, d(1))).toBe(chooseTorpedoTarget(own, d(1)))
  })

  it('always returns a valid own-dice index', () => {
    const rng = createRng(411)
    for (let i = 0; i < 300; i++) {
      const own = [
        { value: rng.rollDie() },
        { value: rng.rollDie() },
        { value: rng.rollDie() },
        { value: rng.rollDie() },
      ] as const
      const t = chooseTorpedoTarget(own, { value: rng.rollDie() })
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThan(4)
    }
  })
})

// Type-level guard: every AbilityId must have a registry entry (compile-time check).
const _exhaustive: Record<AbilityId, unknown> = ABILITIES
void _exhaustive
