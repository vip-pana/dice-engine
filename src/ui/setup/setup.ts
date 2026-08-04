import {
  botDeckSpecialsOffsetFor,
  DEFAULT_ABILITY_DROPS,
  rollBotDeck,
  rollRandomBotDeck,
  stakesFor,
  type Deck,
  type Difficulty,
  type NewGameOptions,
  type Rng,
} from '../../engine'

/**
 * How the bot's 12-die deck comes into being. Chosen before the match.
 *
 * `mirrored` is the default. The other two exist because of the Dado Lanterna: with the count
 * mirrored, a player already knows how MANY specials the bot has, so revealing its deck tells
 * them only half of what it could. `random` hides both the count and the identities;
 * `custom` lets you set the deck you are about to go looking for, which is the only way to
 * check that the ability tells the truth.
 */
export type BotDeckMode = 'mirrored' | 'random' | 'custom'

/** What the player has settled on before the match starts. */
export type Setup = {
  readonly deck: Deck
  readonly botMode: BotDeckMode
  /** Only set when botMode is 'custom'. */
  readonly botDeck: Deck | null
  /** How well the Bot plays, how much money is at stake, and how strong its deck is. */
  readonly difficulty: Difficulty
}

/**
 * Stable identity for a setup, used to remount Match when the player changes anything.
 *
 * Includes the bot mode, its custom deck AND the difficulty, not just the human's deck:
 * switching only one of them has to restart the match too, and a key built from the human deck
 * alone would silently keep the old one running. The difficulty changes the stakes, which are
 * baked into the state at creation.
 */
export function setupKey(setup: Setup): string {
  const own = setup.deck.map((id) => id ?? '-').join('|')
  const bot = setup.botDeck?.map((id) => id ?? '-').join('|') ?? ''
  return `${own}#${setup.botMode}#${bot}#${setup.difficulty}`
}

/**
 * Match options for a chosen setup.
 *
 * A factory, not a plain object: the bot's deck is rolled from the MATCH Rng so that one
 * seed reproduces the whole match including both decks. `commonChance` stays live — common
 * dice belong to nobody and are never part of a deck — while `ownChance` is 0 because own
 * dice now come from the deck (deck mode ignores it either way; 0 is honesty, not effect).
 *
 * The difficulty's stakes enter here, and this is the only place in the UI that builds
 * NewGameOptions — which also means `newMatch()` (it re-runs this factory) keeps the level.
 */
export function optionsForSetup(setup: Setup): (rng: Rng) => NewGameOptions {
  const stakes = stakesFor(setup.difficulty)
  return (rng) => ({
    decks: { human: setup.deck, bot: botDeckFor(setup, rng) },
    abilityDrops: { ...DEFAULT_ABILITY_DROPS, ownChance: 0 },
    config: stakes.config,
    startingBankroll: stakes.startingBankroll,
  })
}

function botDeckFor(setup: Setup, rng: Rng): Deck {
  const offset = botDeckSpecialsOffsetFor(setup.difficulty)
  switch (setup.botMode) {
    case 'mirrored':
      return rollBotDeck(rng, setup.deck, offset)
    case 'random':
      return rollRandomBotDeck(rng, offset)
    case 'custom':
      // NO difficulty offset here, deliberately: you composed this deck yourself, and quietly
      // adding or removing a special from it would be the worst thing the level could do.
      // Non-null by construction: 'custom' is only ever set together with a deck.
      return setup.botDeck ?? rollBotDeck(rng, setup.deck, offset)
  }
}
