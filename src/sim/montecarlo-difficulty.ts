// Monte Carlo harness for the DIFFICULTY levels. Runnable via `pnpm sim:difficulty` (tsx).
//
// Purpose: answer "is difficile actually harder than facile?" with a measurement instead of an
// argument. Unlike the other two harnesses this one drives the REAL reducer through the REAL
// chooseAction, because a difficulty level is a property of the whole match — betting, stealing,
// folding, the Bo3 — and playHeuristicHand models none of that.
//
// Three rules make the comparison honest, and each of them was a way to get it wrong:
//
//  1. EACH SEAT GETS ITS OWN BRAIN RNG, separate from the match Rng. The 'exact' reroll consumes
//     zero draws where 'sampled' consumes ~60 per keep-set, so a shared stream would make the
//     DICE depend on which levels were playing — the levels would then differ for a reason that
//     has nothing to do with skill.
//  2. THE SEATS SWAP every other match. The primary acts first all match long, so a fixed
//     assignment would fold that advantage into whichever level held the seat.
//  3. THE STAKES ARE THE DEFAULTS, not either level's. Two levels cannot both impose their own
//     money on one match, and the stakes are about tension rather than skill (the Bo3 is decided
//     on hand wins, not on bankruptcy). What this measures is the BOT SKILL axis alone; say so
//     rather than let a reader assume otherwise.
//
// Sampling noise is the same order the ability harness documents: at a few hundred matches the
// error bar is several points, so treat a 52% as "no measurable difference".

import {
  ALL_DIFFICULTIES,
  chooseAction,
  createInitialState,
  createRng,
  reducer,
  type Difficulty,
  type GameState,
  type PlayerId,
} from '../engine'

/** One match, with a named level in each seat. Returns the winner's seat. */
function playMatch(
  seed: number,
  levels: Readonly<Record<PlayerId, Difficulty>>,
): PlayerId | null {
  const rng = createRng(seed)
  // Distinct multipliers so the two brains are not the same stream offset by one.
  const brains: Record<PlayerId, ReturnType<typeof createRng>> = {
    human: createRng(seed * 7919 + 1),
    bot: createRng(seed * 6271 + 2),
  }
  let s: GameState = createInitialState({ firstPrimary: 'human' })
  let guard = 0
  while (s.phase !== 'MATCH_OVER' && guard < 400) {
    s =
      s.phase === 'HAND_COMPLETE'
        ? reducer(s, { type: 'NEXT_HAND' }, rng)
        : reducer(s, chooseAction(s, s.toAct, brains[s.toAct], levels[s.toAct]), rng)
    guard++
  }
  return s.matchWinner
}

/**
 * Win rate of `a` against `b` over `matches` matches, seats swapped on alternate matches.
 *
 * Ties are impossible at match level (the Bo3 always resolves), but a match that hits the guard
 * returns null and is dropped from both the numerator and the denominator rather than scored as
 * a loss for somebody.
 */
function duel(matches: number, seed: number, a: Difficulty, b: Difficulty): number {
  let winsForA = 0
  let played = 0
  for (let i = 0; i < matches; i++) {
    const aSeat: PlayerId = i % 2 === 0 ? 'human' : 'bot'
    const bSeat: PlayerId = aSeat === 'human' ? 'bot' : 'human'
    const winner = playMatch(seed + i, {
      [aSeat]: a,
      [bSeat]: b,
    } as Record<PlayerId, Difficulty>)
    if (winner === null) {
      continue
    }
    played++
    if (winner === aSeat) {
      winsForA++
    }
  }
  return played === 0 ? 0 : (winsForA / played) * 100
}

function pct(v: number): string {
  return `${v.toFixed(1).replace('.', ',')}%`
}

function main(): void {
  // Matches, not hands: a match is ~3 hands and the unit a player experiences. Far fewer than
  // the ability harness's 20.000 hands because each match runs the whole reducer.
  const matches = Number(process.env['SIM_TRIALS'] ?? 400)
  const seed = Number(process.env['SIM_SEED'] ?? 20260730)

  console.log(`\n═══ Livelli di difficoltà — ${matches} match per confronto, seed ${seed}`)
  console.log('    Solo l\'asse BRAVURA: la posta è quella di default per entrambi i seggi.')
  console.log('    Seggi scambiati a match alterni, un Rng-cervello per seggio.\n')

  const pairs: readonly (readonly [Difficulty, Difficulty])[] = [
    ['hard', 'easy'],
    ['hard', 'normal'],
    ['normal', 'easy'],
  ]

  const width = Math.max(...ALL_DIFFICULTIES.map((d) => d.length))
  for (const [a, b] of pairs) {
    const rate = duel(matches, seed, a, b)
    console.log(`  ${a.padEnd(width)} vs ${b.padEnd(width)}  ${pct(rate).padStart(7)}`)
  }

  // The control: a level against itself must land on ~50%. If it does not, the harness has a
  // seat bias and every number above it is suspect — which is exactly what the swap is for.
  const control = duel(matches, seed + 999, 'normal', 'normal')
  console.log(`\n  Controllo (normal vs normal): ${pct(control)} — atteso ≈50%`)
  console.log(
    '\n  Il rumore di campionamento a questo numero di match è di diversi punti:\n' +
      '  un 52% va letto come "nessuna differenza misurabile".',
  )
}

main()
