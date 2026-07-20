// Monte Carlo simulator for the LEVEL-1 OPTIMAL single-hand play (see optimal.ts).
// Runnable via `pnpm sim:optimal` (tsx).
//
// Difference from montecarlo.ts (the heuristic sim): decisions (which common to steal,
// which dice to reroll) are made by the EXACT expected-value solver — the theoretical
// best single-hand play — instead of the greedy heuristic. The dice themselves are still
// rolled from the injected Rng, so we measure the realized category distribution of
// optimal play.

import {
  evaluateHand,
  optimalPlay,
  rollOwnDice,
  rollCommonDice,
  createRng,
  OrdinaryRank,
  StraightKind,
  type Die,
  type EvaluatedHand,
  type Hand,
  type OwnDice,
  type Rng,
} from '../engine'

const ORDINARY_LABEL: Record<OrdinaryRank, string> = {
  [OrdinaryRank.HighCard]: 'Carta alta',
  [OrdinaryRank.Pair]: 'Coppia',
  [OrdinaryRank.TwoPair]: 'Doppia coppia',
  [OrdinaryRank.ThreeOfAKind]: 'Tris',
  [OrdinaryRank.FullHouse]: 'Full house',
  [OrdinaryRank.FourOfAKind]: 'Quattro uguali',
  [OrdinaryRank.FiveOfAKind]: 'Cinque uguali',
}
const STRAIGHT_LABEL: Record<StraightKind, string> = {
  [StraightKind.FiveHigh]: 'Scala di cinque',
  [StraightKind.SixHigh]: 'Scala di sei',
}
const CATEGORY_ORDER: readonly string[] = [
  ORDINARY_LABEL[OrdinaryRank.HighCard],
  ORDINARY_LABEL[OrdinaryRank.Pair],
  ORDINARY_LABEL[OrdinaryRank.TwoPair],
  ORDINARY_LABEL[OrdinaryRank.ThreeOfAKind],
  ORDINARY_LABEL[OrdinaryRank.FullHouse],
  ORDINARY_LABEL[OrdinaryRank.FourOfAKind],
  ORDINARY_LABEL[OrdinaryRank.FiveOfAKind],
  STRAIGHT_LABEL[StraightKind.FiveHigh],
  STRAIGHT_LABEL[StraightKind.SixHigh],
]
const GDD_TARGET: Record<string, number | undefined> = {
  'Full house': 16.5,
  'Scala di cinque': 6,
  'Scala di sei': 6,
}

function labelOf(e: EvaluatedHand): string {
  return e.category.kind === 'ordinary'
    ? ORDINARY_LABEL[e.category.rank]
    : STRAIGHT_LABEL[e.category.straight]
}

/** Applies a reroll selection to own dice using the Rng, returning the new own dice. */
function applyReroll(own: OwnDice, rerollIdx: readonly number[], rng: Rng): OwnDice {
  const set = new Set(rerollIdx)
  const after = own.map((die, i) => (set.has(i) ? { value: rng.rollDie() } : die))
  return [after[0]!, after[1]!, after[2]!, after[3]!]
}

/** Plays one hand with the optimal solver deciding steal + reroll; returns the final hand. */
function playOptimalHand(rng: Rng, maxReroll: number): Hand {
  const own = rollOwnDice(rng)
  const common: readonly Die[] = rollCommonDice(rng)
  const play = optimalPlay(own, common, maxReroll)
  const stolen = common[play.stealIndex]!
  const finalOwn = applyReroll(own, play.reroll.rerollIdx, rng)
  return [finalOwn[0], finalOwn[1], finalOwn[2], finalOwn[3], stolen]
}

function runSimulation(trials: number, seed: number, maxReroll: number): Map<string, number> {
  const rng = createRng(seed)
  const counts = new Map<string, number>()
  for (const label of CATEGORY_ORDER) counts.set(label, 0)
  for (let i = 0; i < trials; i++) {
    const label = labelOf(evaluateHand(playOptimalHand(rng, maxReroll)))
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return counts
}

function formatPct(n: number): string {
  return `${n.toFixed(2)}%`.padStart(7)
}

function main(): void {
  const trials = Number(process.env['SIM_TRIALS'] ?? 100_000)
  const seed = Number(process.env['SIM_SEED'] ?? 20260719)
  const maxReroll = Number(process.env['SIM_MAX_REROLL'] ?? 4)

  console.log(`Monte Carlo OTTIMALE — ${trials.toLocaleString('it-IT')} mani, seed ${seed}`)
  console.log(
    `Strategia: furto + reroll a EV esatto (livello 1, no avversario), fino a ${maxReroll} reroll.\n`,
  )

  const counts = runSimulation(trials, seed, maxReroll)
  const nameWidth = Math.max(...CATEGORY_ORDER.map((c) => c.length))
  console.log(
    `${'Categoria'.padEnd(nameWidth)}  ${'Osservato'.padStart(10)}  ${'GDD'.padStart(7)}  Conteggio`,
  )
  console.log('-'.repeat(nameWidth + 34))
  for (const label of CATEGORY_ORDER) {
    const count = counts.get(label) ?? 0
    const pct = (count / trials) * 100
    const target = GDD_TARGET[label]
    const targetStr = target === undefined ? '   —   ' : formatPct(target)
    console.log(
      `${label.padEnd(nameWidth)}  ${formatPct(pct).padStart(10)}  ${targetStr}  ${count.toLocaleString('it-IT')}`,
    )
  }
}

main()
