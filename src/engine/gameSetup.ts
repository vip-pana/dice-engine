// Building a match, and starting each hand within it: the options a caller supplies, the initial
// state, the per-hand loadout draw, and the reset between hands.

import { assertValidDeck, drawHandFromDeck, type Deck } from './deck'
import {
  DEFAULT_BET_CONFIG,
  DEFAULT_STARTING_BANKROLL,
  type BetConfig,
  type GameState,
  type OwnDiceSource,
  type PlayerHandState,
  type PlayerId,
} from './gameTypes'
import type { Rng } from './rng'
import { BOTH_SEATS, assert } from './stateOps'
import {
  NO_ABILITY_DROPS,
  PLAIN_LOADOUT,
  rollRandomLoadout,
  type AbilityDropConfig,
  type Loadout,
} from './strategy'

function emptyHandState(): PlayerHandState {
  return {
    own: null,
    stolen: null,
    committed: 0,
    rerollSelection: null,
    concealedIndices: [],
    torpedoTarget: null,
    mulinelloUsed: false,
    paguroChosen: false,
    spongeTarget: null,
    lanternaUsed: false,
  }
}

export interface NewGameOptions {
  readonly config?: BetConfig
  readonly startingBankroll?: number
  /**
   * Provisional primary before the first roll-off (only affects `toAct` display during
   * ROLL_OFF, which is a system roll). Defaults to 'human'. The actual primary of every
   * hand is decided by the ROLL_OFF.
   */
  readonly firstPrimary?: PlayerId
  /**
   * Per-seat FIXED die loadouts. Omitted seats get four plain dice, so leaving this out
   * yields the base game unchanged.
   *
   * A seat listed here is pinned: `abilityDrops` never overwrites it. That keeps the
   * deterministic setup used by tests and by balance runs available alongside the
   * random-drop mode.
   */
  readonly loadouts?: Partial<Record<PlayerId, Loadout>>
  /**
   * Per-seat 12-die decks. A seat with a deck draws 4 of its 12 dice fresh every hand,
   * ignoring `abilityDrops.ownChance`.
   *
   * Mutually exclusive with `loadouts` for the same seat — supplying both is a caller bug
   * and throws, rather than being silently resolved by a precedence rule.
   */
  readonly decks?: Partial<Record<PlayerId, Deck>>
  /**
   * Random ability drops. When set, every hand re-rolls the loadout of each seat that has
   * neither a pinned loadout nor a deck, and the common dice draw their own abilities.
   * Defaults to no drops (base game).
   */
  readonly abilityDrops?: AbilityDropConfig
}

/** Which source a seat's own dice come from, given the options supplied. */
function ownDiceSourceFor(options: NewGameOptions, seat: PlayerId): OwnDiceSource {
  const deck = options.decks?.[seat]
  const loadout = options.loadouts?.[seat]
  assert(
    deck === undefined || loadout === undefined,
    `${seat} was given both a deck and a pinned loadout; pick one`,
  )
  if (deck !== undefined) {
    return { kind: 'deck' }
  }
  return loadout !== undefined ? { kind: 'pinned' } : { kind: 'drops' }
}

/** Creates the initial match state at the start of hand 1 (ROLL_OFF phase). */
export function createInitialState(options: NewGameOptions = {}): GameState {
  const config = options.config ?? DEFAULT_BET_CONFIG
  const bankroll = options.startingBankroll ?? DEFAULT_STARTING_BANKROLL
  const primary = options.firstPrimary ?? 'human'

  const ownDiceSource = {
    human: ownDiceSourceFor(options, 'human'),
    bot: ownDiceSourceFor(options, 'bot'),
  }
  const decks = {
    human: options.decks?.human ?? null,
    bot: options.decks?.bot ?? null,
  }
  // The engine validates, not just the UI: an illegal deck must be impossible to play,
  // whatever the caller is.
  for (const seat of BOTH_SEATS) {
    const deck = decks[seat]
    if (deck !== null) {
      assertValidDeck(deck, seat)
    }
  }

  return {
    config,
    phase: 'ROLL_OFF',
    loadouts: {
      human: options.loadouts?.human ?? PLAIN_LOADOUT,
      bot: options.loadouts?.bot ?? PLAIN_LOADOUT,
    },
    ownDiceSource,
    decks,
    pinnedLoadouts: {
      human: ownDiceSource.human.kind === 'pinned',
      bot: ownDiceSource.bot.kind === 'pinned',
    },
    abilityDrops: options.abilityDrops ?? NO_ABILITY_DROPS,
    primary,
    rollOff: null,
    handNumber: 1,
    score: { human: 0, bot: 0 },
    bankroll: { human: bankroll, bot: bankroll },
    pot: 0,
    hands: { human: emptyHandState(), bot: emptyHandState() },
    common: null,
    stolenCommonIndices: [],
    currentBet: 0,
    raisesThisWindow: 0,
    aggressor: null,
    toAct: primary,
    firstBetAmount: 0,
    lastShowdown: null,
    log: ['Mano 1 — tira il dado per decidere chi inizia.'],
    matchWinner: null,
  }
}

/**
 * Loadouts for the hand about to start, per seat's configured source.
 *
 * Drawn human-then-bot so the Rng stream has a predictable shape. Note the two random
 * modes consume different numbers of draws, so a seed does not produce the same dice
 * across modes — expected, they are different games.
 */
export function drawLoadouts(state: GameState, rng: Rng): Readonly<Record<PlayerId, Loadout>> {
  return {
    human: drawLoadoutFor(state, 'human', rng),
    bot: drawLoadoutFor(state, 'bot', rng),
  }
}

function drawLoadoutFor(state: GameState, seat: PlayerId, rng: Rng): Loadout {
  switch (state.ownDiceSource[seat].kind) {
    case 'pinned':
      return state.loadouts[seat]
    case 'deck': {
      const deck = state.decks[seat]
      assert(deck !== null, `${seat} is in deck mode but has no deck`)
      return drawHandFromDeck(rng, deck)
    }
    case 'drops':
      return rollRandomLoadout(rng, state.abilityDrops)
  }
}

/**
 * Starts the next hand: resets per-hand state and returns to ROLL_OFF, where a fresh
 * die-off decides the new primary. (The primary is no longer alternated; it is won each
 * hand by the highest roll-off die.)
 */
export function handleNextHand(state: GameState): GameState {
  assert(state.phase === 'HAND_COMPLETE', 'NEXT_HAND only allowed after a hand completes')

  const nextHandNumber = state.handNumber + 1

  return {
    ...state,
    phase: 'ROLL_OFF',
    // primary keeps its previous value until the next roll-off resolves it.
    rollOff: null,
    handNumber: nextHandNumber,
    pot: 0,
    hands: { human: emptyHandState(), bot: emptyHandState() },
    common: null,
    stolenCommonIndices: [],
    currentBet: 0,
    raisesThisWindow: 0,
    aggressor: null,
    toAct: state.primary,
    firstBetAmount: 0,
    lastShowdown: null,
    log: [...state.log, `Mano ${nextHandNumber} — tira il dado per decidere chi inizia.`],
    matchWinner: null,
  }
}
