// Opponent AI as pure logic. chooseAction(state, player, rng, difficulty) returns a single
// legal Action for the current phase. It reuses the shared strategy helpers (steal + reroll)
// so the bot plays the same policy the Monte Carlo simulator measures.
//
// HOW HARD IT PLAYS is a BotSkill, resolved once from the difficulty in chooseAction and passed
// down to the handlers (see difficulty.ts, which holds the three profiles and their numbers).
// The handlers therefore never learn which level they are: they receive behaviours. The default
// is 'normal', which reproduces the bot exactly as it played before difficulty existed.
//
// The bot is deterministic given the Rng.

import {
  chooseStolenDie,
  chooseRerollIndices,
  chooseTorpedoTarget,
  handScore,
} from './strategy'
import { exactRerollEV, optimalPlay, optimalReroll } from './optimal'
import { FOGGED_FACE_WEIGHTS } from './abilities'
import { botSkillFor, type BotSkill, type Difficulty } from './difficulty'
import type { Rng } from './rng'
import type { AbilityId, Hand } from './types'
import type { Action } from './actions'
import { maxBetFor, seatIsFogged } from './game'
import { viewFor } from './view'
import { otherPlayer, type GameState, type PlayerId } from './gameTypes'

/**
 * The betting thresholds under their historical name: they are now the 'normal' profile's, and
 * that is the definition of normal rather than a coincidence.
 *
 * Kept exported because it was, and because a test asserts on it — renaming it would be churn
 * in a test that is not about difficulty. New code should ask difficulty.ts instead.
 */
export const BOT_TUNING: BotSkill = botSkillFor('normal')

/**
 * Normalizes a hand's handScore into [0, 1] so thresholds are readable.
 * The min is the weakest possible 5-die score, the max the strongest (five sixes-ish);
 * we derive both from handScore of anchor hands to stay consistent with the scoring.
 */
const MIN_SCORE = handScore([{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 6 }])
// Strongest realistic hand: six-high straight is the top category in this game.
const MAX_SCORE = handScore([{ value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }, { value: 6 }])

/**
 * True when the opponent has already committed everything they have.
 *
 * Raising into an all-in opponent is pointless — there is nobody left to call the extra —
 * so the bot only ever matches. Without this it would keep "raising" against a player who
 * cannot respond, which reads as the bot bullying a broke opponent.
 */
function opponentIsAllIn(state: GameState, player: PlayerId): boolean {
  return state.bankroll[otherPlayer(player)] <= 0
}

/**
 * Turns a desired total bet into a legal action.
 *
 * Two clamps, both delegating the ceiling to the engine's maxBetFor (which caps at the
 * SHORTER stack, so the bot cannot bet chips the opponent could never cover):
 *  - cannot afford the raise -> call instead. This bot has no all-in strategy, and
 *    shoving its whole stack on a minimum-raise impulse is worse than matching.
 *  - opponent already all-in -> call, since a raise cannot be contested.
 *
 * Every bet at every difficulty still comes through here, which is what keeps "no negative
 * bankroll" and "never raise into an all-in" true at all three levels for free: the skill knobs
 * choose amounts and gates, they never bypass this clamp.
 */
function betOrCall(
  state: GameState,
  player: PlayerId,
  type: 'OPEN' | 'RAISE',
  amount: number,
): Action {
  const max = maxBetFor(state, player)

  if (type === 'RAISE' && opponentIsAllIn(state, player)) {
    return { type: 'CALL', player }
  }
  if (amount > max) {
    return type === 'OPEN' ? { type: 'OPEN', player, amount: max } : { type: 'CALL', player }
  }
  return type === 'OPEN' ? { type: 'OPEN', player, amount } : { type: 'RAISE', player, amount }
}

/**
 * The total this skill wants to raise to, falling back to a single min-raise when it cannot
 * afford its preferred size.
 *
 * The fallback is not politeness, it is a correctness fix: betOrCall above downgrades an
 * unaffordable RAISE to a CALL, so a profile that asks for two min-raises would end up CALLING
 * in spots where the one-raise profile RAISES — a "stronger" bot playing more passively, and
 * worst on exactly the short stacks that high stakes produce. Asking for less first keeps the
 * aggression; betOrCall still applies the real ceiling.
 */
function raiseTo(state: GameState, player: PlayerId, skill: BotSkill, base: number): number {
  const wanted = base + skill.raiseMultiple * state.config.minBet
  return wanted <= maxBetFor(state, player) ? wanted : base + state.config.minBet
}

function normalizedStrength(hand: Hand): number {
  return normalizeScore(handScore(hand))
}

/**
 * Maps a raw handScore (or an expected one) into [0, 1] against the same anchors.
 *
 * Split out from normalizedStrength so an EXPECTED score — which is an average and therefore
 * not any real hand's score — can be normalized on the identical scale. Sharing the scale is
 * what lets BOT_TUNING's thresholds keep their meaning whether the bot is pricing settled dice
 * or dice it is about to throw.
 */
function normalizeScore(raw: number): number {
  const clamped = Math.max(MIN_SCORE, Math.min(MAX_SCORE, raw))
  return (clamped - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)
}

/** The bot's current 5-die hand (own 4 + stolen), if both are known. */
function currentHand(state: GameState, player: PlayerId): Hand | null {
  const h = state.hands[player]
  if (h.own === null || h.stolen === null) {
    return null
  }
  return [h.own[0], h.own[1], h.own[2], h.own[3], h.stolen]
}

/**
 * Chooses a single legal action for `player` given the current phase.
 * Throws if asked to act when it is not the player's turn (defensive; the caller should
 * only invoke this when state.toAct === player).
 *
 * `difficulty` selects HOW WELL it plays, and defaults to 'normal' — the profile that is
 * defined as "the bot before difficulty existed", so every existing caller keeps the behaviour
 * it had. It is a parameter rather than a field on GameState for two reasons: the reducer would
 * never read it, and a state-level field would force BOTH seats to the same level, which makes
 * a hard-versus-easy comparison impossible to even express.
 */
export function chooseAction(
  state: GameState,
  player: PlayerId,
  rng: Rng,
  difficulty: Difficulty = 'normal',
): Action {
  // ROLL_OFF and HAND_COMPLETE are system transitions with no per-player turn.
  if (state.phase === 'ROLL_OFF') {
    return { type: 'ROLL_OFF' }
  }
  if (state.phase === 'HAND_COMPLETE') {
    return { type: 'NEXT_HAND' }
  }

  if (state.toAct !== player) {
    throw new Error('[bot] asked to act out of turn')
  }

  // EVERY decision below reads the FILTERED view, never the raw state. A die concealed
  // from the bot by the human's Nero di Seppia must be unknown to the bot too, otherwise
  // the ability would only work in one direction and the bot would be quietly cheating.
  // Filtering once here covers all four decision paths.
  const seen = viewFor(state, player)
  // The one line in this file that knows the difficulty table exists. Everything below is
  // parameterized by BEHAVIOUR, so a handler can be tested without naming a level.
  const skill = botSkillFor(difficulty)

  // Switch on the already-narrowed `state.phase` (ROLL_OFF/HAND_COMPLETE returned above),
  // but pass `seen` to every handler.
  //
  // Note what is NOT here: the bot never sends LANTERNA_PEEK. Nothing below reads
  // `state.decks`, so knowing the human's deck would feed no decision — and a peek dispatched
  // for appearances would be worse than its absence, implying the bot had weighed it. The
  // machine never waits for one either: a peek changes neither `phase` nor `toAct`, so no
  // phase can stall on an action the bot declines to send. A Lanterna in the bot's deck is
  // therefore dead weight for the bot, which is a real and accepted asymmetry.
  switch (state.phase) {
    case 'INITIAL_BET':
      return chooseInitialBet(seen, player, skill)
    case 'STEAL':
      return chooseSteal(seen, player, skill)
    case 'REROLL_SELECT':
      return chooseReroll(seen, player, rng, skill)
    case 'MULINELLO_SELECT':
      return chooseMulinello(seen, player, skill)
    case 'PAGURO_SELECT':
      return choosePaguro(seen, player, rng)
    case 'SECOND_BET':
      return chooseSecondBet(seen, player, skill)
    case 'SHOWDOWN':
    case 'MATCH_OVER':
      throw new Error(`[bot] no action to take in phase ${state.phase}`)
  }
}

// --- INITIAL_BET (blind) ---

function chooseInitialBet(state: GameState, player: PlayerId, skill: BotSkill): Action {
  // Primary opens at the minimum; non-primary calls. Blind, so keep it flat.
  if (player === state.primary && state.aggressor === null) {
    return betOrCall(state, player, 'OPEN', state.config.minBet)
  }
  if (
    skill.raises &&
    skill.raiseOnInitialBet &&
    state.raisesThisWindow < state.config.maxRaisesPerWindow
  ) {
    return betOrCall(state, player, 'RAISE', raiseTo(state, player, skill, state.currentBet))
  }
  return { type: 'CALL', player }
}

// --- STEAL: the best common die, by this skill's definition of "best" ---

function chooseSteal(state: GameState, player: PlayerId, skill: BotSkill): Action {
  const own = state.hands[player].own
  if (own === null || state.common === null) {
    throw new Error('[bot] steal requested before dice rolled')
  }
  // Only consider commons not already taken, keeping track of their original indices.
  const availableIndices = [0, 1, 2].filter((i) => !state.stolenCommonIndices.includes(i))
  const availableDice = availableIndices.map((i) => state.common![i]!)

  // Both policies return a LOCAL index into availableDice, mapped back below.
  //
  // 'joint' is the exact solver (optimalPlay), which prices each candidate steal together with
  // the reroll that steal would open — where 'greedy' maximizes the five dice as they stand and
  // cannot see the reroll coming at all. Same filtered view either way: this is a bot that
  // calculates better, not one that knows more.
  const localIndex =
    skill.steal === 'joint'
      ? optimalPlay(own, availableDice, skill.maxReroll, fogWeights(state, player, skill))
          .stealIndex
      : chooseStolenDie(own, availableDice).index
  return { type: 'STEAL', player, commonIndex: availableIndices[localIndex]! }
}

// --- REROLL_SELECT: reuse shared heuristic ---

function chooseReroll(
  state: GameState,
  player: PlayerId,
  rng: Rng,
  skill: BotSkill,
): Action {
  const h = state.hands[player]
  if (h.own === null || h.stolen === null) {
    throw new Error('[bot] reroll requested before steal')
  }
  // 'exact' enumerates every outcome instead of sampling 60 per keep-set, which also makes the
  // hard bot play and BET off the same number (prospectiveStrength already prices with
  // optimalReroll) — it removes an internal disagreement rather than adding a feature. Note it
  // consumes ZERO Rng draws where 'sampled' consumes ~60 per keep-set: harmless in the app,
  // where the bot has its own brain Rng, but any bot-vs-bot harness comparing two levels must
  // give each seat its own or the comparison is confounded.
  const indices =
    skill.reroll === 'exact'
      ? optimalReroll(h.own, h.stolen, skill.maxReroll, fogWeights(state, player, skill)).rerollIdx
      : chooseRerollIndices(h.own, h.stolen, rng, skill.rerollSamples, skill.maxReroll)

  // Holding a Torpedo makes the target mandatory (the reducer asserts it), so it is chosen
  // here in the same action. `state` is already the filtered view, so a die the bot cannot
  // see cannot inform the choice.
  //
  // Note the bot picks its victim well, but chooseRerollIndices above does NOT know the bot's
  // own hand may be zapped by an opponent Torpedo — the same blind spot it has for the Nero
  // di Seppia and the Dado d'Oro. Teaching the reroll heuristic about pending effects is a
  // separate change.
  //
  // FOG is now a per-skill matter rather than a flat blind spot: `fogAware` skills pass the true
  // face distribution into the exact EV (see fogWeights below), while the sampled path stays
  // blind, since its estimates come from the Rng rather than from a distribution it could be told
  // about. The Stella and the D4 remain mispriced at every level, for the reason exactRerollEV
  // documents.
  //
  // Worth stating because the obvious guess is wrong: fog does NOT simply mean "keep more". A
  // fogged face averages 2.53 against 3.50, but the fogged distribution is also concentrated on
  // the low faces, so a handful of fresh dice PAIR UP far more often (three fresh dice make at
  // least a pair 55% of the time in fog against 44% clear) — and handScore ranks by category
  // before face value. Measured over 300 seeded spots, fog-aware play changed the keep-set in
  // about a third of them, and it rerolled MORE dice rather than fewer in the majority of those.
  // The correction is worth making because the EV is wrong, not because the bot was too eager.
  const victim = otherPlayer(player)
  const victimHand = state.hands[victim]
  const sponge = chooseSponge(state, player)
  const base = { type: 'REROLL' as const, player, ownIndices: indices }
  const withSponge = sponge === null ? base : { ...base, spongeTarget: sponge }

  if (holdsAbility(h, 'DADO_TORPEDO') && victimHand.own !== null && victimHand.stolen !== null) {
    const target = chooseTorpedoTarget(victimHand.own, victimHand.stolen)
    return { ...withSponge, torpedoTarget: target }
  }
  return withSponge
}

/**
 * The face distribution this seat's next roll will actually follow, or undefined for a plain
 * uniform die — which is what every EV in this file assumed at every level before now.
 *
 * Only a `fogAware` skill gets the correction, and only while it really is fogged. Passing the
 * weights is legitimate rather than a peek: a Brumeggio is PUBLIC information, and stays so even
 * through a Nero di Seppia (view.ts keeps `ability` visible on a masked die), so this reads
 * nothing the human cannot see. `state` here is always the filtered view.
 *
 * The correction covers a PLAIN face. A Stella or a D4 in fog follows its own rule twice and
 * keeps the worse result, which is a different distribution per ability — those stay mispriced,
 * exactly as exactRerollEV says they are.
 */
function fogWeights(
  state: GameState,
  player: PlayerId,
  skill: BotSkill,
): readonly number[] | undefined {
  return skill.fogAware && seatIsFogged(state, player) ? FOGGED_FACE_WEIGHTS : undefined
}

/**
 * Which opponent ability to soak up with a Dado Spugna, or null when there is nothing to take.
 *
 * A RANKING, not an EV calculation, and deliberately so. `exactRerollEV` prices dice faces; it
 * cannot price information, coins, or damage that has not landed, and there is no opponent model
 * in this codebase to price them against. A fabricated EV number here would look rigorous and be
 * arbitrary, so the order below is stated as the judgement call it is:
 *
 *  1. DADO_BRUMEGGIO — first on the Torpedo's own criteria, which it wins on every count:
 *     strictly negative, aimed at us, certain, quantifiable — and far larger. A Torpedo is -1
 *     on one die, once. The fog is about -0.97 expected value on EVERY die we roll (E 3.500
 *     -> 2.528), and it applies again to every die we reroll. Lifting it also un-fogs the
 *     reroll we are about to choose, which no other sponge target does.
 *  2. TORPEDO — a strictly-negative effect aimed at us whose cost we can quantify (a -1 on the
 *     die chooseTorpedoTarget says we can least afford).
 *  3. DADO_D_ORO — doubles what they collect. Cancelling it is worth a whole pot, but only in
 *     the branch where they win, so it ranks below a certain loss.
 *  4. MULINELLO — priced with the same quantity chooseMulinello uses on our own behalf, so the
 *     bot never disagrees with itself about what an extra roll is worth.
 *  5. NERO_DI_SEPPIA — last because by now it has already cost us the reroll decision; the
 *     sponge only buys back sight for the betting.
 *
 * Reads the FILTERED view like every other bot decision, so a die the bot cannot see cannot
 * inform the choice.
 */
function chooseSponge(state: GameState, player: PlayerId): AbilityId | null {
  const hand = state.hands[player]
  if (!holdsAbility(hand, 'DADO_SPUGNA')) {
    return null
  }
  const opponent = otherPlayer(player)
  const oppHand = state.hands[opponent]

  // An ability threatens us if the opponent holds it, or if it sits unstolen among the commons
  // (where several abilities still hit both seats).
  const threatens = (ability: AbilityId): boolean =>
    holdsAbility(oppHand, ability) ||
    (state.common ?? []).some(
      (d, i) => d.ability === ability && !state.stolenCommonIndices.includes(i),
    )

  for (const ability of SPONGE_PRIORITY) {
    if (threatens(ability)) {
      return ability
    }
  }
  return null
}

/**
 * See chooseSponge for why this order, and why it is a ranking rather than a computation.
 *
 * A plain array, NOT a Record over AbilityId, so a new spongeable ability compiles fine while
 * being silently un-sponged forever. Exported so a test can assert the list is complete —
 * which is the only thing that turns that omission into a failure.
 */
export const SPONGE_PRIORITY: readonly AbilityId[] = [
  'DADO_BRUMEGGIO',
  'DADO_TORPEDO',
  'DADO_D_ORO',
  'MULINELLO',
  'NERO_DI_SEPPIA',
]

/** Whether this hand carries `ability`, among its own dice or as its stolen die. */
function holdsAbility(hand: GameState['hands'][PlayerId], ability: AbilityId): boolean {
  return (
    (hand.own ?? []).some((d) => d.ability === ability) || hand.stolen?.ability === ability
  )
}


// --- MULINELLO_SELECT: spend the extra roll only when it pays ---

/**
 * Takes the Mulinello's third roll when its exact EV beats keeping the hand as it stands.
 *
 * No new EV code: `exactRerollEV` (optimal.ts) prices "reroll exactly this die" by enumerating
 * all 6 faces, and `handScore` prices standing pat. Both are the same metric the solver and
 * the reroll heuristic already use, so the bot cannot drift away from them.
 *
 * Identical at every difficulty, and that is a decision: nerfing it would mean inventing a wrong
 * Mulinello rule, and a bot visibly declining a free improving roll reads as a bug rather than
 * as easy mode. The only thing the skill changes here is whether the EV knows about fog.
 *
 * Two known limits remain, both inherited rather than introduced. `state` is the filtered view,
 * so a Mulinello concealed by the human's Nero di Seppia is priced from its masked face — the
 * same blind spot chooseReroll has. And the EV ignores a pending Torpedo, exactly as noted above.
 */
function chooseMulinello(state: GameState, player: PlayerId, skill: BotSkill): Action {
  const h = state.hands[player]
  if (h.own === null || h.stolen === null) {
    throw new Error('[bot] Mulinello requested before the dice were rolled')
  }

  const index = h.own.findIndex((d) => d.ability === 'MULINELLO')
  // A stolen Mulinello sits outside `own`, which is what exactRerollEV indexes into. Rather
  // than price it with the wrong arithmetic, keep: the die is already the one the bot chose
  // to steal, so standing pat is a defensible default rather than a silent mistake.
  if (index === -1) {
    return { type: 'MULINELLO_PASS', player }
  }

  const keep = handScore([h.own[0], h.own[1], h.own[2], h.own[3], h.stolen])
  const reroll = exactRerollEV(h.own, h.stolen, [index], fogWeights(state, player, skill))
  return reroll > keep
    ? { type: 'MULINELLO_ROLL', player }
    : { type: 'MULINELLO_PASS', player }
}

// --- PAGURO_SELECT: a blind pick among three covered faces ---

/**
 * Picks one of the Dado Paguro's three covered faces. BLIND by construction: the bot reads the
 * filtered view, where its own pending Paguro is masked, so it cannot see the faces even if it
 * wanted to — and it wouldn't matter, since a blind pick is a uniform draw whatever the index.
 *
 * There is therefore no strategy to have and none is faked. The index is drawn from the Rng so
 * two Paguri in one hand do not both grab the same slot for no reason, but any fixed index would
 * be exactly as strong. Consumes one draw, in a player-action path — the same reproducibility
 * rule the Mulinello's branch follows.
 */
function choosePaguro(_state: GameState, player: PlayerId, rng: Rng): Action {
  return { type: 'PAGURO_CHOOSE', player, index: rng.nextInt(0, 2) }
}

// --- SECOND_BET: threshold on the strength this hand can still REACH after its reroll ---

/**
 * Normalized strength to bet on at the second bet — the strength this hand can still REACH.
 *
 * The dice on the table are not what this hand will be compared with: the whole reroll comes
 * after this betting round, so every seat still has four dice it may replace. Pricing the visible
 * faces would systematically undervalue a bad hand, which is exactly the hand a reroll helps
 * most: a busted 1-2-4-6 that can throw all four away is not worth what its faces say.
 *
 * `optimalReroll` searches every legal keep-set and returns the best expected handScore, computed
 * exactly by enumerating all 6^k outcomes. Same arithmetic the solver and chooseMulinello use, so
 * the bot cannot drift away from them, and the same documented blind spots are inherited: it
 * assumes a uniform 1..6 face, so a Stella, a D4 or a Paguro among the dice — and any die rolled
 * in a Brumeggio's fog — is mispriced.
 *
 * The `rerollSelection` branch is for the case where a selection somehow already exists (it does
 * not in the current phase order): then the choice is made and only THAT reroll should be priced.
 *
 * A `betsOn: 'current-hand'` skill deliberately skips all of that and prices the visible faces.
 * That is not an arbitrary handicap — it is precisely the error described two paragraphs up, so
 * an easy bot under-bets the busted hands a reroll would rescue and over-bets the pretty ones,
 * which is the mistake a beginner actually makes and one a human can learn to read.
 */
function prospectiveStrength(
  state: GameState,
  player: PlayerId,
  hand: Hand,
  skill: BotSkill,
): number {
  const h = state.hands[player]
  if (skill.betsOn === 'current-hand' || h.own === null || h.stolen === null) {
    return normalizedStrength(hand)
  }
  const weights = fogWeights(state, player, skill)
  const chosen = h.rerollSelection
  if (chosen !== null) {
    return normalizeScore(exactRerollEV(h.own, h.stolen, chosen, weights))
  }
  return normalizeScore(optimalReroll(h.own, h.stolen, skill.maxReroll, weights).ev)
}

function chooseSecondBet(state: GameState, player: PlayerId, skill: BotSkill): Action {
  const hand = currentHand(state, player)
  if (hand === null) {
    throw new Error('[bot] second bet requested before hand is formed')
  }
  const strength = prospectiveStrength(state, player, hand, skill)
  const canRaise = state.raisesThisWindow < state.config.maxRaisesPerWindow
  const wantsRaise = skill.raises && strength >= skill.raiseAtLeast && canRaise

  // No bet on the table yet: the bot (as primary) MUST open (no check). It opens at the
  // minimum, or higher when its hand is strong.
  if (state.aggressor === null) {
    const min = state.firstBetAmount // second-bet minimum
    const amount = wantsRaise ? raiseTo(state, player, skill, min) : min
    return betOrCall(state, player, 'OPEN', amount)
  }

  // Facing a bet: raise when strong.
  if (wantsRaise) {
    return betOrCall(state, player, 'RAISE', raiseTo(state, player, skill, state.currentBet))
  }

  // Weak hand facing a bet it has to pay for: fold rather than pay off a big bet.
  // Gated on the price being meaningful relative to the stack, so the bot does not fold
  // to a token bet it could call for almost nothing. A skill with `folds: false` never gets
  // here — it is a calling station by design, and pays off every value bet.
  const owed = state.currentBet - state.hands[player].committed
  const stack = state.bankroll[player]
  const priceRatio = stack > 0 ? owed / stack : 0
  if (
    skill.folds &&
    owed > 0 &&
    strength <= skill.foldBelow &&
    priceRatio >= skill.foldWhenPriceOverStack
  ) {
    return { type: 'FOLD', player }
  }

  return { type: 'CALL', player }
}
