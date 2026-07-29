// Core domain types for the pure rules engine.
// Portability note: everything here is plain data (numbers, string-literal unions,
// readonly arrays/objects) so it maps almost 1:1 to GDScript/C# structs & enums.

/** A single die face value. All dice are standard d6. */
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6

/**
 * Identifier of a die's special ability (roguelike upgrades).
 *
 * Data-driven on purpose: the roll behaviour of each ability lives in ONE table
 * (ABILITIES in abilities.ts), so adding the Nth ability is a new entry there, not a
 * new branch scattered across the engine. `null`/absent means a plain d6.
 *
 * Naming note: ids are stable strings (not numbers) so saved loadouts stay readable
 * and portable to GDScript/C# enums-by-name.
 */
export type AbilityId =
  /** Rolls 3 dice and keeps the highest. */
  | 'STELLA_ESSICCATA'
  /** A 4-sided die: rolls 1..4 instead of 1..6. */
  | 'D4'
  /**
   * Hides one of the OPPONENT's dice from them until the showdown.
   *
   * Unlike every other ability this one changes no value at all — it changes who knows
   * what. Its effect therefore lives outside AbilitySpec.roll (see `concealedIndices` on
   * PlayerHandState); the spec entry exists only so it can drop, be named and be drawn.
   */
  | 'NERO_DI_SEPPIA'
  /**
   * Doubles the pot the winner collects.
   *
   * Like NERO_DI_SEPPIA it changes no die value; unlike every other ability it moves
   * COINS, so its effect lives in the reducer at payout time (see `hasGoldenPayout` in
   * game.ts) rather than in AbilitySpec.roll. Held by a seat it doubles for that seat;
   * left unstolen among the commons it doubles for whoever wins.
   */
  | 'DADO_D_ORO'
  /**
   * Subtracts 1 from a die of the opponent's hand, chosen by this die's owner.
   *
   * The first ability that changes a VALUE, and someone else's at that — so like the two
   * above its effect cannot live in AbilitySpec.roll. Two moments, deliberately split (see
   * applyTorpedoes in game.ts): the owner picks the victim die during REROLL_SELECT, and
   * the -1 lands at the showdown. Applying it earlier would let the victim reroll the
   * zapped die and undo it for free, since a reroll rebuilds the die from its ability alone.
   *
   * Also the first ability that needs a player DECISION; the choice is stored as
   * `torpedoTarget` on PlayerHandState.
   */
  | 'DADO_TORPEDO'
  /**
   * Lets its owner roll THIS die a third time, after the normal reroll, if they dislike the
   * result.
   *
   * The first ability whose decision must be made with the outcome already known, which is
   * why it is the first one to change the PHASE ORDER rather than just a value: a
   * MULINELLO_SELECT phase asks the holder whether to spend the extra roll (see
   * handleMulinello in game.ts). Every earlier ability could be decided blind, so none of them
   * needed a moment that did not already exist.
   *
   * That phase sits AFTER the second bet, together with the reroll whose result it needs. It
   * briefly sat before the bet instead, which let it inform the wager — and cost the wager its
   * meaning, since the dice were then final while the betting was still open (see the Phase docs
   * in gameTypes.ts). So the Mulinello has no betting leverage: it improves a hand whose stake
   * is already set.
   *
   * The choice is one-shot, tracked as `mulinelloUsed` on PlayerHandState. Stealing one from
   * the commons works and hands the thief the choice; left unstolen it does nothing, since an
   * ability that IS a decision has nobody to make it.
   */
  | 'MULINELLO'
  /**
   * Soaks up one opponent ability of the holder's choosing, cancelling its effect.
   *
   * The first ability aimed at other ABILITIES rather than at dice, so it has to reach every
   * point where an effect is applied (see isNullified in game.ts). Which abilities it can
   * absorb is declared per-ability by `spongeable` on AbilitySpec, not listed here — an
   * ability whose face is decided at roll time cannot be cancelled after the fact, because
   * the face is already committed to Die.value and the rolled alternatives are gone.
   *
   * Nero di Seppia is the odd one out: it lands on entry into STEAL, long before a target can
   * be chosen, so the sponge REVERSES it (sight comes back) rather than preventing it. The
   * other three are all still pending when the choice is made.
   *
   * Chosen during REROLL_SELECT and stored as `spongeTarget` on PlayerHandState.
   */
  | 'DADO_SPUGNA'
  /**
   * One look at the opponent's whole 12-die deck, taken whenever its holder wants.
   *
   * The second ability that changes no value at all, only who knows what — see
   * NERO_DI_SEPPIA above, which is its mirror image. Where that one takes knowledge away
   * from its victim, this one takes knowledge away from a secret: `decks[opponent]` is the
   * only genuinely hidden state in the game, since the four dice in play are open
   * information both ways (see viewFor in view.ts).
   *
   * A GLANCE, not a note. Nothing about what was seen is stored: the deck is already on the
   * state and fixed for the match, so the UI reads it live while the panel is open and there
   * is nothing to reopen once closed. Only the spent-ness is state, as `lanternaUsed` on
   * PlayerHandState — once per hand, reset with the hand.
   *
   * Player-triggered, in any phase from STEAL to SECOND_BET (see handleLanternPeek and
   * inPeekablePhase in game.ts). Consumes no Rng, and is the only action in the reducer that
   * takes no turn — you can peek while waiting for the opponent.
   */
  | 'DADO_LANTERNA'
  /**
   * Fogs the OPPONENT for the whole hand: every die they roll rolls twice and keeps the
   * LOWEST face. E[value] 3.500 -> 2.528, P(6) 16.7% -> 2.8%.
   *
   * The first ability that changes HOW A DIE IS ROLLED, rather than what one die shows or
   * what the reducer does with the result afterwards. That makes it the first whose effect
   * fits neither home the other eight use: an AbilitySpec may only decide its OWN die's face
   * (so not `roll`), and there is no single moment for the reducer to act on (so not there
   * either) — the first roll, both rerolls and a Mulinello's third roll are all fogged. It
   * therefore lives at the one choke point every hand die passes through, as a RollModifiers
   * argument to rollDieWithAbility, with `isFogged` in game.ts answering who is fogged.
   *
   * Not held state: the fog is re-derived at every roll from whoever holds the die, which is
   * what lets a sponge lift it with nothing to clear. Note the two SOURCES, deliberately
   * different: the first roll happens before `hands` exist, so it reads the LOADOUTS; every
   * later roll reads seatHoldsActive, which also counts a die stolen from the commons.
   *
   * Consumes 2 draws per fogged die where a clear one consumes 1, so a hand containing one
   * has a different Rng stream than the same seed without it. Expected, and the same caveat
   * that already separates the `drops` and `deck` own-dice modes (see drawLoadouts).
   */
  | 'DADO_BRUMEGGIO'
  /**
   * Rolls 3 dice like the Stella Essiccata, but the OWNER chooses which one to keep — BLIND,
   * without seeing any of the three faces. The interactive twin of the Stella: where that one
   * keeps the max automatically (E 4.958), this one hands the pick to the player.
   *
   * Because the choice is blind, picking one of three is a uniform draw, so the kept value is
   * a plain d6 (E 3.500, P(6) 1/6) — exactly a neutral die. Classified `malus` because,
   * measured against the Stella it echoes, you give up the "keep the highest" edge. Its whole
   * content is the ACT of choosing, not the odds.
   *
   * The first ability whose die has NO decided value at roll time: the three faces are rolled
   * with the rest of the own dice (recorded in `rolls`), but the kept one is not known until
   * the player picks it in a PAGURO_SELECT phase (see handlePaguroChoose in game.ts) — like
   * the MULINELLO, a decision that cannot live in the pure `resolve`. Until then the die is
   * shown covered to everyone (see viewFor in view.ts), and `resolve` returns only a
   * placeholder face. The one-shot choice is tracked as `paguroChosen` on PlayerHandState.
   *
   * `ownOnly`: the pick needs an owner, and a common die at the centre is open information
   * resolved the instant it is rolled — there is nobody to choose it and no way to show it
   * covered. So it never drops among the commons, unlike the MULINELLO which merely lies dormant.
   */
  | 'DADO_PAGURO'

/**
 * A rolled die.
 *
 * `ability` is the ability of the PHYSICAL die that produced this value; it travels with
 * the die so the UI can mark it and so a reroll re-applies the same ability. Absent for
 * plain dice, which keeps every existing `{ value }` literal valid.
 *
 * `rolls` records the individual faces an ability produced (e.g. Stella Essiccata's 3 dice)
 * purely so the UI can *show* the split. It is never read by hand evaluation.
 */
export interface Die {
  readonly value: DieValue
  readonly ability?: AbilityId | undefined
  readonly rolls?: readonly DieValue[] | undefined
  /**
   * Set only on a die that has been MASKED for a particular viewer (see view.ts): its
   * `value` is a placeholder, not the real face. Never set on the reducer's true state —
   * if you find it there, something wrote a view back into the engine.
   */
  readonly concealed?: boolean | undefined
}

/**
 * A final 5-die hand: the player's 4 own dice plus the 1 stolen common die.
 * The engine treats a hand purely as its 5 values for evaluation.
 */
export type Hand = readonly [Die, Die, Die, Die, Die]

/**
 * Ordinary hand categories, from lowest to highest.
 *
 * Rank 0 "High card" is added on top of the GDD (which starts at Pair) so any roll
 * is comparable at showdown. Straights are NOT here — they are special categories
 * (see StraightKind) that outrank every ordinary category.
 */
export enum OrdinaryRank {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  FullHouse = 4,
  FourOfAKind = 5,
  FiveOfAKind = 6,
}

/**
 * Special straight categories. They outrank all ordinary categories.
 * Their relative priority is data-driven (see STRAIGHT_PRIORITY in hand.ts),
 * so tweaking "six beats five" is a one-line change, not scattered logic.
 *
 * TODO(roguelike): the GDD also mentions a rare "Niente ★" category with an
 * undefined effect. Excluded from the MVP on purpose.
 */
export enum StraightKind {
  /** {1,2,3,4,5} */
  FiveHigh = 'FIVE_HIGH',
  /** {2,3,4,5,6} */
  SixHigh = 'SIX_HIGH',
}

/**
 * The evaluated category of a hand: either a straight or an ordinary rank.
 * Discriminated union on `kind` for exhaustive, portable branching.
 */
export type HandCategory =
  | { readonly kind: 'straight'; readonly straight: StraightKind }
  | { readonly kind: 'ordinary'; readonly rank: OrdinaryRank }

/**
 * Fully evaluated hand, ready for comparison.
 *
 * `tiebreakers` is an ordered list of die values used to break ties WITHIN the same
 * category, most significant first. Examples:
 *  - Pair:        [pairValue, kicker1, kicker2, kicker3]
 *  - Two pair:    [highPairValue, lowPairValue, kicker]
 *  - Full house:  [tripleValue, pairValue]
 *  - Straights:   [] (a straight of a given kind never ties-breaks on values)
 *
 * compareHands walks `tiebreakers` element by element. This keeps all tiebreak
 * rules in one place (evaluateHand) rather than scattered across comparison code.
 */
export interface EvaluatedHand {
  readonly category: HandCategory
  readonly tiebreakers: readonly DieValue[]
  /** The sorted die values (descending), kept for debugging/UI display. */
  readonly values: readonly DieValue[]
}

/** Result of comparing two hands. Sign convention matches Array.sort comparators. */
export type CompareResult = -1 | 0 | 1
