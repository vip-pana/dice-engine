// Monte Carlo balance harness for die abilities. Runnable via `pnpm sim:abilities` (tsx).
//
// Purpose: answer "how much does this ability warp the game?" with two measurements:
//  1. Category distribution — how the hand mix shifts vs a plain loadout.
//  2. Head-to-head win rate — a loadout carrying the ability vs an all-plain loadout,
//     both playing the SAME heuristic strategy, so the only variable is the dice.
//
// Both players draw from one Rng stream and are dealt independently, so neither seat has
// a structural edge; a win rate above 50% is the ability's contribution.

import {
  ABILITIES,
  ALL_ABILITY_IDS,
  compareHands,
  createRng,
  evaluateHand,
  playHeuristicHand,
  OrdinaryRank,
  PLAIN_LOADOUT,
  DEFAULT_ABILITY_DROPS,
  rollRandomLoadout,
  StraightKind,
  type AbilityDropConfig,
  type AbilityId,
  type EvaluatedHand,
  type Loadout,
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

function labelOf(e: EvaluatedHand): string {
  return e.category.kind === 'ordinary'
    ? ORDINARY_LABEL[e.category.rank]
    : STRAIGHT_LABEL[e.category.straight]
}

/** A loadout with `count` copies of `ability` in the first slots, rest plain. */
function loadoutWith(ability: AbilityId, count: number): Loadout {
  const slots = [0, 1, 2, 3].map((i) => (i < count ? ability : null))
  return [slots[0]!, slots[1]!, slots[2]!, slots[3]!] as Loadout
}

// --- 1. Category distribution --------------------------------------------

function distribution(trials: number, rng: Rng, loadout: Loadout): Map<string, number> {
  const counts = new Map<string, number>()
  for (const label of CATEGORY_ORDER) counts.set(label, 0)
  for (let i = 0; i < trials; i++) {
    const label = labelOf(evaluateHand(playHeuristicHand(rng, 4, loadout)))
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return counts
}

// --- 2. Head-to-head ------------------------------------------------------

interface Duel {
  readonly wins: number
  readonly losses: number
  readonly ties: number
}

/**
 * Plays `trials` independent hands of loadout A vs loadout B under identical strategy.
 * Returns the record from A's point of view.
 */
function duel(trials: number, rng: Rng, a: Loadout, b: Loadout): Duel {
  let wins = 0
  let losses = 0
  let ties = 0
  for (let i = 0; i < trials; i++) {
    const handA = evaluateHand(playHeuristicHand(rng, 4, a))
    const handB = evaluateHand(playHeuristicHand(rng, 4, b))
    const cmp = compareHands(handA, handB)
    if (cmp > 0) wins++
    else if (cmp < 0) losses++
    else ties++
  }
  return { wins, losses, ties }
}

/** Win rate counting a tie as half a win — the natural scalar for balance. */
function winRate(d: Duel, trials: number): number {
  return ((d.wins + d.ties / 2) / trials) * 100
}

// --- Reporting ------------------------------------------------------------

function pct(n: number): string {
  return `${n.toFixed(2)}%`.padStart(8)
}

function main(): void {
  const trials = Number(process.env['SIM_TRIALS'] ?? 40_000)
  const seed = Number(process.env['SIM_SEED'] ?? 20260725)

  console.log(`Monte Carlo abilità — ${trials.toLocaleString('it-IT')} mani per scenario, seed ${seed}`)
  console.log('Strategia identica per entrambi (furto greedy + reroll euristico fino a 4).')
  console.log('L\'unica variabile è il loadout dei dadi.\n')

  // Baseline distribution, for the delta column.
  const baseRng = createRng(seed)
  const base = distribution(trials, baseRng, PLAIN_LOADOUT)

  const nameWidth = Math.max(...CATEGORY_ORDER.map((c) => c.length))

  for (const id of ALL_ABILITY_IDS) {
    const spec = ABILITIES[id]
    console.log(`\n═══ ${spec.icon} ${spec.name} — ${spec.description}`)
    console.log(`    (consuma ${spec.diceRolled} facce per lancio)\n`)

    // Distribution shift with a single copy of the ability.
    const distRng = createRng(seed + 1)
    const withOne = distribution(trials, distRng, loadoutWith(id, 1))

    console.log(
      `${'Categoria'.padEnd(nameWidth)}  ${'Base'.padStart(8)}  ${'1 dado'.padStart(8)}  ${'Δ'.padStart(8)}`,
    )
    console.log('-'.repeat(nameWidth + 30))
    for (const label of CATEGORY_ORDER) {
      const b = ((base.get(label) ?? 0) / trials) * 100
      const w = ((withOne.get(label) ?? 0) / trials) * 100
      const delta = w - b
      const sign = delta >= 0 ? '+' : ''
      console.log(
        `${label.padEnd(nameWidth)}  ${pct(b)}  ${pct(w)}  ${`${sign}${delta.toFixed(2)}`.padStart(8)}`,
      )
    }

    // The one head-to-head that matters for balance: ONE special die against an all-plain
    // loadout. Stacking multiple copies is not how the game is meant to be played, so
    // measuring a 1..4 curve would just report unreachable states.
    const d = duel(trials, createRng(seed + 100), loadoutWith(id, 1), PLAIN_LOADOUT)
    console.log(
      `\n  1 dado speciale vs 4 normali: ${pct(winRate(d, trials))}` +
        ` (V ${d.wins.toLocaleString('it-IT')} / S ${d.losses.toLocaleString('it-IT')} / P ${d.ties.toLocaleString('it-IT')})`,
    )
  }

  // Sanity control: plain vs plain must sit at ~50%, proving the harness has no seat bias.
  const control = duel(trials, createRng(seed + 999), PLAIN_LOADOUT, PLAIN_LOADOUT)
  console.log(
    `\nControllo (normali vs normali): ${pct(winRate(control, trials))} — atteso ≈ 50%`,
  )

  // Mirror matches: once several abilities exist, this is the table that says which one is
  // strongest — every ability plays one die of its own kind against every other. With a
  // single ability registered it degenerates to one self-match, so we skip it.
  if (ALL_ABILITY_IDS.length > 1) {
    printAbilityMatrix(trials, seed)
  }

  printDropRates(trials, seed)
}

/**
 * How the game ACTUALLY plays: both seats draw random specials every hand at the same rate.
 * The fixed-loadout numbers above isolate a single ability; this table answers the design
 * question — at what drop rate do specials shape the game without deciding it?
 *
 * Both seats use the same rate, so the win rate stays ~50% by symmetry. What moves is the
 * hand mix and how often a hand contains a special at all, which is what the columns show.
 */
function printDropRates(trials: number, seed: number): void {
  console.log('\n\n═══ Drop casuali — entrambi i giocatori pescano alla stessa probabilità\n')

  const rates = [0, 0.1, 0.15, 0.25, 0.4, 0.6] as const
  console.log(
    `${'p/dado'.padStart(7)}  ${'≥1 spec.'.padStart(9)}  ${'spec/mano'.padStart(10)}  ` +
      `${'Full+'.padStart(8)}  ${'Scala 6'.padStart(8)}  ${'Scala 5'.padStart(8)}`,
  )
  console.log('-'.repeat(60))

  for (const p of rates) {
    const rng = createRng(seed + 7000 + Math.round(p * 1000))
    const drops: AbilityDropConfig = { ownChance: p, commonChance: p / 2, pool: ALL_ABILITY_IDS }

    let handsWithSpecial = 0
    let specialDice = 0
    const counts = new Map<string, number>()
    for (const label of CATEGORY_ORDER) counts.set(label, 0)

    for (let i = 0; i < trials; i++) {
      const loadout = rollRandomLoadout(rng, drops)
      const specials = loadout.filter((a) => a !== null).length
      specialDice += specials
      if (specials > 0) handsWithSpecial++
      const label = labelOf(evaluateHand(playHeuristicHand(rng, 4, loadout)))
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }

    // "Full+" bundles every category from full house upward — the hands that actually win.
    const strong =
      ['Full house', 'Quattro uguali', 'Cinque uguali'].reduce(
        (sum, l) => sum + (counts.get(l) ?? 0),
        0,
      ) / trials
    const six = (counts.get(STRAIGHT_LABEL[StraightKind.SixHigh]) ?? 0) / trials
    const five = (counts.get(STRAIGHT_LABEL[StraightKind.FiveHigh]) ?? 0) / trials

    console.log(
      `${p.toFixed(2).padStart(7)}  ${pct((handsWithSpecial / trials) * 100).padStart(9)}  ` +
        `${(specialDice / trials).toFixed(2).padStart(10)}  ` +
        `${pct(strong * 100).padStart(8)}  ${pct(six * 100).padStart(8)}  ${pct(five * 100).padStart(8)}`,
    )
  }

  console.log(
    `\n  Default del gioco: own ${DEFAULT_ABILITY_DROPS.ownChance}, ` +
      `comuni ${DEFAULT_ABILITY_DROPS.commonChance}.`,
  )
}

/**
 * Win-rate matrix: row ability (1 special die) vs column ability (1 special die).
 * Read a row as "how this ability fares against each other one".
 */
function printAbilityMatrix(trials: number, seed: number): void {
  console.log('\n\n═══ Confronto tra abilità (1 dado speciale per parte)\n')

  const ids = ALL_ABILITY_IDS
  const nameWidth = Math.max(...ids.map((id) => ABILITIES[id].name.length))
  const header = ids.map((id) => ABILITIES[id].name.slice(0, 8).padStart(8)).join('  ')
  console.log(`${''.padEnd(nameWidth)}  ${header}`)

  ids.forEach((rowId, r) => {
    const cells = ids.map((colId, c) => {
      // Same-ability cell is 50% by symmetry; still simulated so noise is visible.
      const d = duel(trials, createRng(seed + 5000 + r * 31 + c), loadoutWith(rowId, 1), loadoutWith(colId, 1))
      return pct(winRate(d, trials))
    })
    console.log(`${ABILITIES[rowId].name.padEnd(nameWidth)}  ${cells.join('  ')}`)
  })
}

main()
