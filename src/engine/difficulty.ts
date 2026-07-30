// Difficulty levels: how well the bot plays, and how much money is on the table.
//
// ONE table (DIFFICULTY_TABLE) defines a level completely — its bot skill, its stakes, and
// what it does to the bot's deck. Split across two files, "difficile" would be defined twice
// and a fourth level could compile with half its numbers missing.
//
// Why the table lives in the engine rather than in the UI that offers the choice: the stakes
// are engine vocabulary (BetConfig, DEFAULT_BET_CONFIG, DEFAULT_STARTING_BANKROLL all live in
// gameTypes.ts), and a table inside a React file could not be imported by a test under
// tests/ without dragging React in — so "difficile really does put more money at stake than
// normale" would be unassertable. It is data only: no Rng, no state, nothing to execute.
//
// What this module deliberately does NOT hold: the Italian labels. Those are presentation
// and live in src/ui/labels.ts. Numbers here, words there.
//
// IMPORT DIRECTION: difficulty.ts -> gameTypes.ts / strategy.ts. It must never import bot.ts
// (bot.ts imports this), and it must never import game.ts.

import { DEFAULT_BET_CONFIG, DEFAULT_STARTING_BANKROLL, type BetConfig } from './gameTypes'
import { MAX_REROLL } from './strategy'

export type Difficulty = 'easy' | 'normal' | 'hard'

/**
 * Every level, in the order a UI should offer them.
 *
 * Exported so a picker and a completeness test both derive from one list instead of hardcoding
 * three strings each.
 */
export const ALL_DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard']

/**
 * How well the bot plays. Every field is consumed in bot.ts and nowhere else.
 *
 * These are BEHAVIOURS, not a difficulty name: the handlers in bot.ts receive a resolved
 * BotSkill and never learn which level produced it, so a test can pin "a bot that does not
 * fold" without knowing that easy is the level that asks for it.
 */
export interface BotSkill {
  /**
   * Second-bet strength gate: at/above this normalized hand strength ([0,1]) the bot raises;
   * below it, it just calls. Ignored when `raises` is false.
   */
  readonly raiseAtLeast: number
  /**
   * The initial bet is blind (before dice are rolled), so every level plays it flat: open or
   * call at the minimum, never raise pre-roll. Kept as a flag for clarity.
   */
  readonly raiseOnInitialBet: boolean
  /**
   * Whether the bot raises at all. A separate flag rather than an unreachable `raiseAtLeast`
   * of 2: a sentinel outside the documented [0,1] range would be a lie about what the number
   * means.
   */
  readonly raises: boolean
  /**
   * Raise size, in multiples of `config.minBet` above the amount being raised. 1 is a single
   * min-raise, which is what the bot has always done.
   */
  readonly raiseMultiple: number
  /**
   * Whether the bot ever folds. Also a flag, and here the flag is load-bearing rather than
   * tidy: the gate below is `strength <= foldBelow`, so a `foldBelow` of 0 would NOT disable
   * folding — the weakest possible hand normalizes to exactly 0 and would still fold.
   */
  readonly folds: boolean
  /**
   * Second-bet fold gate: at/below this normalized strength the bot considers folding rather
   * than paying. Only reachable in SECOND_BET while facing a bet, the only spot where folding
   * is legal.
   */
  readonly foldBelow: number
  /**
   * ...and only when the call costs at least this fraction of its remaining stack. Without a
   * price gate the bot would fold weak hands to trivial bets, which plays as needlessly timid
   * and hands the human free pots.
   *
   * Calibrated against actual play: at the default 200 stack / 10 minimum bet, the price of a
   * second-round call is ~5% of stack typically and 12.5% at the observed maximum, so anything
   * above that makes the rule dead code. 10% means the bot folds weak hands only to bets that
   * are genuinely large for it — which is what a human raising big wants.
   *
   * Note this is a RATIO of the stack, not an amount, which is why it survives a difficulty
   * that rescales the stakes with no recalibration.
   */
  readonly foldWhenPriceOverStack: number
  /**
   * `greedy` maximizes the hand as it stands (myopic — it cannot see the reroll the steal
   * enables). `joint` solves the steal and the reroll together with the exact solver.
   */
  readonly steal: 'greedy' | 'joint'
  /** `sampled` estimates each keep-set by sampling; `exact` enumerates every outcome. */
  readonly reroll: 'sampled' | 'exact'
  /** Samples per keep-set for the `sampled` reroll. Lower is noisier. Unused when `exact`. */
  readonly rerollSamples: number
  /** How many of its four own dice the bot is willing to replace. 4 = no limit. */
  readonly maxReroll: number
  /**
   * What the bot bets on at the second bet: the hand it can still REACH after its reroll
   * (correct — the whole reroll happens after this betting round), or the faces currently on
   * the table (the beginner's error, which undervalues exactly the busted hands a reroll
   * helps most).
   */
  readonly betsOn: 'current-hand' | 'reachable-hand'
  /**
   * Whether the bot's EV knows a Brumeggio's fog makes every face min-of-two (E 2.528 rather
   * than 3.500), instead of pricing a fogged reroll as a clean d6.
   *
   * Not the same thing as "keeps more in fog" — see optimalReroll: the fogged distribution is
   * bunched low, which makes fresh dice pair up MORE often, so knowing about the fog moves the
   * decision in both directions.
   */
  readonly fogAware: boolean
}

/** How much money is on the table. Both fields are already accepted by createInitialState. */
export interface Stakes {
  readonly config: BetConfig
  readonly startingBankroll: number
}

export interface DifficultyProfile {
  readonly bot: BotSkill
  readonly stakes: Stakes
  /**
   * Added to the special COUNT of the bot's generated deck: -1 gives it one fewer special
   * than the mirrored count, +1 one more.
   *
   * Only applies to the GENERATED bot decks (see rollBotDeck / rollRandomBotDeck). A deck the
   * player composed by hand is never adjusted — quietly editing a deck someone chose would be
   * the worst thing this feature could do.
   */
  readonly botDeckSpecialsOffset: number
}

/**
 * The three levels.
 *
 * 'normal' IS the definition of "how the game played before difficulty existed" — every one of
 * its fields is chosen to reproduce the old code exactly, not to be a reasonable middle:
 *
 *  1. raiseAtLeast / raiseOnInitialBet / foldBelow / foldWhenPriceOverStack are verbatim the
 *     four constants that used to be BOT_TUNING;
 *  2. raiseMultiple 1 reproduces the old hardcoded `+ config.minBet` in both raise branches;
 *  3. rerollSamples 60 and maxReroll 4 ARE the current defaults of chooseRerollIndices, so
 *     passing them explicitly changes nothing — including the number of Rng draws consumed,
 *     which matters because a bot that draws once more shifts the whole dice stream in any
 *     harness that shares one Rng between the bot and the match (tests/bot.test.ts does);
 *  4. greedy / sampled / reachable-hand select exactly the code paths that used to be the
 *     only ones;
 *  5. the stakes REFERENCE the default constants rather than restating 10 and 200 — equality
 *     by construction, not by two numbers that can drift apart.
 *
 * There is deliberately NO random mistake rate at any level. Injected blunders read as a
 * broken game; myopia reads as a beatable opponent, and a player can actually learn to spot
 * "he keeps too many dice". If easy still plays too well, the next dial is maxReroll: 1.
 */
export const DIFFICULTY_TABLE: Record<Difficulty, DifficultyProfile> = {
  /**
   * A calling station with tunnel vision.
   *
   * It cannot throw away more than two dice, so it never rebuilds a busted hand — the most
   * recognisable novice mistake, and one that shows on the table rather than hiding in the
   * arithmetic. It bets on the faces it can see, which is the error the comment above
   * `betsOn` describes. And it neither folds nor raises: it pays off your value bets and
   * never punishes a bluff.
   *
   * The cost of never raising, recorded because it is real: your own bet sizing is
   * consequence-free here. If that empties out the betting phase in playtest, the fix is one
   * line — `raises: true` with `raiseAtLeast` around 0.85, which raises rarely rather than
   * never.
   */
  easy: {
    bot: {
      raises: false,
      raiseAtLeast: 0.62,
      raiseOnInitialBet: false,
      raiseMultiple: 1,
      folds: false,
      foldBelow: 0.3,
      foldWhenPriceOverStack: 0.1,
      steal: 'greedy',
      reroll: 'sampled',
      // Noisier than normale's 60. When it errs it picks a keep-set ADJACENT in EV — a
      // plausible worse choice rather than a random one, which is the difference between a
      // weak opponent and a broken one.
      rerollSamples: 12,
      maxReroll: 2,
      betsOn: 'current-hand',
      fogAware: false,
    },
    // Small pots and a deep cushion: 200 / 5 is 40 minimum bets, twice normale's 20, so
    // nobody runs out of coins and every mistake is cheap. Note the raise cap of 2 binds the
    // HUMAN too — the raise button greys out sooner, which is why the level's blurb says so.
    stakes: {
      config: { ...DEFAULT_BET_CONFIG, minBet: 5, maxRaisesPerWindow: 2 },
      startingBankroll: DEFAULT_STARTING_BANKROLL,
    },
    botDeckSpecialsOffset: -1,
  },

  /** The game as it played before this module existed. See the five points above. */
  normal: {
    bot: {
      raises: true,
      raiseAtLeast: 0.62,
      raiseOnInitialBet: false,
      raiseMultiple: 1,
      folds: true,
      foldBelow: 0.3,
      foldWhenPriceOverStack: 0.1,
      steal: 'greedy',
      reroll: 'sampled',
      rerollSamples: 60,
      maxReroll: MAX_REROLL,
      betsOn: 'reachable-hand',
      fogAware: false,
    },
    stakes: { config: DEFAULT_BET_CONFIG, startingBankroll: DEFAULT_STARTING_BANKROLL },
    botDeckSpecialsOffset: 0,
  },

  /**
   * Plays the hand-building phase exactly, and prices the fog.
   *
   * Three upgrades, all of them arithmetic the codebase already had and the bot simply was not
   * using: it values a steal together with the reroll that steal opens (instead of grabbing
   * whatever helps the current five dice), it picks the reroll by exact enumeration instead of
   * a 60-sample estimate, and its EV knows when it is rolling in fog.
   *
   * It does NOT see more than before. Every decision still reads the filtered view, so a die
   * hidden by your Nero di Seppia is hidden from this bot too — it is stronger because it
   * calculates better, which is the only kind of stronger worth playing against.
   */
  hard: {
    bot: {
      raises: true,
      // Slightly wider than normale, and a raise worth two minimums instead of one.
      raiseAtLeast: 0.55,
      raiseOnInitialBet: false,
      raiseMultiple: 2,
      folds: true,
      foldBelow: 0.34,
      foldWhenPriceOverStack: 0.08,
      steal: 'joint',
      reroll: 'exact',
      // Dead fields under `exact` (which samples nothing). Left at normale's values rather
      // than at a fake huge sample count that would imply the exact path uses them.
      rerollSamples: 60,
      maxReroll: MAX_REROLL,
      betsOn: 'reachable-hand',
      fogAware: true,
    },
    // 250 / 25 is a cushion of TEN minimum bets against normale's twenty. That is the one
    // channel through which money is really difficulty here: the match is decided on hand
    // wins, not on bankruptcy, but at ten minimums a couple of big pots can strip a seat —
    // and a seat with no chips behind cannot bet or bluff at all (see noChipsBehind in
    // game.ts). Six raises per window on top, so a raise war can actually get somewhere.
    stakes: {
      config: { ...DEFAULT_BET_CONFIG, minBet: 25, maxRaisesPerWindow: 6 },
      startingBankroll: 250,
    },
    botDeckSpecialsOffset: 1,
  },
}

/** The bot behaviour for a level. */
export function botSkillFor(difficulty: Difficulty): BotSkill {
  return DIFFICULTY_TABLE[difficulty].bot
}

/** The money on the table for a level, shaped for NewGameOptions. */
export function stakesFor(difficulty: Difficulty): Stakes {
  return DIFFICULTY_TABLE[difficulty].stakes
}

/** How many specials to add to (or remove from) a GENERATED bot deck at this level. */
export function botDeckSpecialsOffsetFor(difficulty: Difficulty): number {
  return DIFFICULTY_TABLE[difficulty].botDeckSpecialsOffset
}
