// The end of a hand: compare the two final hands, apply the Torpedoes, pay the pot out, and
// either start the next hand or end the match.

import { applyTorpedoes } from './abilityEffects'
import { seatHoldsActive, unclaimedCommonActiveFor } from './abilityQueries'
import { compareHands, evaluateHand } from './hand'
import {
  WINS_TO_TAKE_MATCH,
  otherPlayer,
  type GameState,
  type HandOutcome,
  type PlayerHandState,
  type PlayerId,
  type ShowdownInfo,
} from './gameTypes'
import { describeShowdown, diceStr } from './logFormat'
import type { Rng } from './rng'
import { assert, labelOf, setHand, withLog } from './stateOps'
import type { OwnDice } from './strategy'
import type { Hand } from './types'

/**
 * Assembles a seat's 5-die hand. No rolling: `own` is already final by the time the showdown
 * runs, since the reroll resolves back in REROLL_SELECT and any Mulinello in MULINELLO_SELECT.
 * Rolling here too would silently reroll every hand a second time.
 */
function finalHandOf(hand: PlayerHandState): Hand {
  assert(hand.own !== null && hand.stolen !== null, 'incomplete hand at showdown')
  const own = hand.own
  return [own[0], own[1], own[2], own[3], hand.stolen]
}

export function goToShowdown(state: GameState, rng: Rng): GameState {
  const rerolled = {
    human: finalHandOf(state.hands.human),
    bot: finalHandOf(state.hands.bot),
  }

  // Zap here, at the showdown, and not back when the dice were rerolled: applying a Torpedo
  // before the rolls settle would let the victim reroll the marked die — or spend a Mulinello
  // on it — and wipe the -1 for free, since a roll rebuilds a die from its ability alone.
  const zapped = applyTorpedoes(rerolled, state, rng)
  const humanHand = zapped.hands.human
  const botHand = zapped.hands.bot

  // Persist the rerolled own dice back into hand state so the UI can show final dice.
  const humanOwn: OwnDice = [humanHand[0], humanHand[1], humanHand[2], humanHand[3]]
  const botOwn: OwnDice = [botHand[0], botHand[1], botHand[2], botHand[3]]

  const humanEval = evaluateHand(humanHand)
  const botEval = evaluateHand(botHand)
  const cmp = compareHands(humanEval, botEval)

  const outcome: HandOutcome =
    cmp === 0 ? { kind: 'tie' } : { kind: 'win', winner: cmp > 0 ? 'human' : 'bot' }

  const showdown: ShowdownInfo = { human: humanEval, bot: botEval, outcome }

  let next: GameState = {
    ...state,
    // Never observable: resolveHand overwrites it with HAND_COMPLETE or MATCH_OVER in the same
    // step. Set anyway so no intermediate state lies about where the hand is.
    phase: 'SHOWDOWN',
    lastShowdown: showdown,
  }
  // THE REVEAL: the showdown is exactly when concealment ends, so clearing it here is
  // what makes a Nero di Seppia last "until the end of the hand" and no longer.
  next = setHand(next, 'human', { own: humanOwn, concealedIndices: [] })
  next = setHand(next, 'bot', { own: botOwn, concealedIndices: [] })
  // Torpedo lines come BEFORE the dice line, which already shows the reduced values: an
  // unexplained face that differs from what was on the table reads as a bug.
  for (const line of zapped.logs) {
    next = withLog(next, line)
  }
  // The reroll itself was already logged when it happened, back in REROLL_SELECT — but that
  // line masks dice a seat could not see. This one is the reveal: printed in full, after any
  // Torpedo, so a concealed die's true face and every zap are finally on the record.
  next = withLog(next, `Allo showdown — Tu: ${diceStr(humanOwn)}. Bot: ${diceStr(botOwn)}.`)
  next = withLog(next, describeShowdown(humanEval, botEval, outcome))

  return resolveHand(next, outcome)
}

/**
 * Where a Dado d'Oro is doubling the payout from, or null if nothing is.
 *
 * Two sources, checked in this order and NEVER combined — doubling is a switch, not a
 * counter, so a seat holding one while another sits unclaimed on the table still collects
 * exactly 2x:
 *
 *  - 'held':  among the winner's 4 own dice or their stolen die. Stealing it from the
 *             commons is the intended way to acquire one, so the stolen die counts.
 *  - 'table': still among the commons, unstolen. It belongs to nobody, so it doubles for
 *             WHOEVER wins — including the seat that never touched it.
 *
 * Defensive on incomplete hands: a fold can resolve before both hands are formed, in which
 * case `own`/`stolen` are null and only the table source can apply.
 */
function goldenPayoutSource(state: GameState, winner: PlayerId): 'held' | 'table' | null {
  // The seat doing the sponging is the LOSER — the only one who gains from cancelling a payout.
  // seatHoldsActive takes the ability's owner (the winner) and looks up the other seat itself;
  // the table branch takes the protected seat, so it needs the loser named explicitly. Two
  // different parameter meanings, which is why they read differently.
  const loser = otherPlayer(winner)
  if (seatHoldsActive(state, winner, 'DADO_D_ORO')) {
    return 'held'
  }
  return unclaimedCommonActiveFor(state, loser, 'DADO_D_ORO') !== null ? 'table' : null
}

/**
 * Awards the pot per the outcome, updates score, and moves to HAND_COMPLETE (or MATCH_OVER).
 *
 * A total tie splits the pot evenly and changes no score (the hand is replayed); a Dado d'Oro
 * does nothing there, because a tie is not a win.
 *
 * The winning branch is the ONLY place a payout multiplier applies, which is what makes it cover
 * both ways to win a hand — showdown (goToShowdown) and fold (handleFold) both land here. The
 * doubled coins are minted rather than taken from the loser: the loser is out exactly what they
 * bet, win or lose. Total coins on the table therefore grow, which is harmless because the match
 * ends on WINS_TO_TAKE_MATCH, not on bankruptcy.
 */
export function resolveHand(state: GameState, outcome: HandOutcome): GameState {
  let next = state

  if (outcome.kind === 'tie') {
    // Split the pot evenly. Because every hand reaches showdown with both players having
    // matched each betting round, the pot is always even and splits cleanly. No score change.
    const half = next.pot / 2
    next = {
      ...next,
      bankroll: {
        human: next.bankroll.human + half,
        bot: next.bankroll.bot + half,
      },
      pot: 0,
    }
  } else {
    const winner = outcome.winner
    const golden = goldenPayoutSource(next, winner)
    const pot = next.pot
    const payout = golden === null ? pot : pot * 2
    next = {
      ...next,
      bankroll: { ...next.bankroll, [winner]: next.bankroll[winner] + payout },
      pot: 0,
      score: { ...next.score, [winner]: next.score[winner] + 1 },
    }
    if (golden !== null) {
      // Say WHICH source doubled it: with a die on the table the winner may never have
      // touched a Dado d'Oro, and an unexplained double payout reads as a bug.
      const why = golden === 'held' ? 'in mano' : 'lasciato tra i comuni: vale per chi vince'
      next = withLog(
        next,
        `Dado d'Oro (${why}) — ${labelOf(winner)} incassa il doppio: ${payout} invece di ${pot}.`,
      )
    }
  }

  if (outcome.kind === 'win' && next.score[outcome.winner] >= WINS_TO_TAKE_MATCH) {
    return withLog(
      { ...next, phase: 'MATCH_OVER', matchWinner: outcome.winner },
      `${labelOf(outcome.winner)} vince il match ${next.score.human}-${next.score.bot}!`,
    )
  }

  return { ...next, phase: 'HAND_COMPLETE' }
}
