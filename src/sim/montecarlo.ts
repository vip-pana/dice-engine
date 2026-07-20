// Monte Carlo probability simulator. Runnable via `npm run sim` / `pnpm sim` (tsx).
//
// Purpose: confirm that the implemented rules + the shared reroll heuristic produce a
// category distribution consistent with the GDD (e.g. Full House ~16.5%, each straight
// ~6% under the "max 3 reroll" constraint). This validates the engine, not the UI.

import {
  evaluateHand,
  playHeuristicHand,
  createRng,
  OrdinaryRank,
  StraightKind,
  type EvaluatedHand,
} from '../engine'

// Human-readable labels (Italian, as they may surface in UI/tooling).
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

/** All category labels in display order (weakest to strongest). */
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

function labelOf(e: EvaluatedHand): string {
  return e.category.kind === 'ordinary'
    ? ORDINARY_LABEL[e.category.rank]
    : STRAIGHT_LABEL[e.category.straight]
}

/** GDD reference targets, for eyeballing. Undefined where the GDD is silent. */
const GDD_TARGET: Record<string, number | undefined> = {
  'Full house': 16.5,
  'Scala di cinque': 6,
  'Scala di sei': 6,
}

function runSimulation(trials: number, seed: number, maxReroll: number): Map<string, number> {
  const rng = createRng(seed)
  const counts = new Map<string, number>()
  for (const label of CATEGORY_ORDER) {
    counts.set(label, 0)
  }
  for (let i = 0; i < trials; i++) {
    const finalHand = playHeuristicHand(rng, maxReroll)
    const label = labelOf(evaluateHand(finalHand))
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
  // Reroll cap for the sim only. Defaults to the game's current rule (4). Set to 3 to
  // measure the old "max 3" constraint without changing the engine rules.
  const maxReroll = Number(process.env['SIM_MAX_REROLL'] ?? 4)

  console.log(`Monte Carlo — ${trials.toLocaleString('it-IT')} mani, seed ${seed}`)
  console.log(`Strategia: furto greedy + reroll euristico (fino a ${maxReroll}), stessa del bot.\n`)

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
