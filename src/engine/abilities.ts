// Die abilities (roguelike upgrades).
//
// Design: ONE table (ABILITIES) holds everything about every ability — its label, its
// rolling behaviour, and how many raw faces it consumes. Adding the Nth ability means
// adding one entry here; no other engine file needs a new branch.
//
// Constraint on THIS FILE: an AbilitySpec may only decide *what face a single die shows
// when rolled*. Nothing here touches hand evaluation, betting or phase order, which keeps
// hand.ts oblivious to the roguelike layer entirely.
//
// Seven abilities need more than a face, so their spec below is a plain-d6 stub and the real
// effect lives elsewhere, where the state it acts on exists:
//   - NERO_DI_SEPPIA hides INFORMATION -> applyConcealment in game.ts
//   - DADO_D_ORO moves COINS           -> goldenPayoutSource in game.ts
//   - DADO_TORPEDO moves a VALUE       -> applyTorpedoes in game.ts
//   - MULINELLO moves the PHASE ORDER  -> handleMulinello in game.ts
//   - DADO_SPUGNA cancels ANOTHER ABILITY -> hasSponged in game.ts
//   - DADO_LANTERNA reveals INFORMATION   -> handleLanternPeek in game.ts
//   - DADO_BRUMEGGIO reshapes the OPPONENT'S ROLLS -> RollModifiers below + isFogged in game.ts
// All seven are named here so the pattern is discoverable from the registry. A new ability
// that only decides a face still needs nothing but an entry in this table.
//
// DADO_BRUMEGGIO is the odd one out among those seven, and the reason the constraint above
// says "a single die" rather than "its own die": its effect is applied HERE, inside
// rollDieWithAbility, not in the reducer. It had nowhere else to go. A spec may only decide
// its own face, and the reducer has no single moment to act on — every roll of the hand is
// fogged. So the fog arrives as a RollModifiers argument, decided by the caller.

import type { AbilityId, Die, DieValue } from './types'
import type { Rng } from './rng'

/** Static, presentation-and-balance metadata plus the roll behaviour of an ability. */
export interface AbilitySpec {
  readonly id: AbilityId
  /** Short Italian name shown on the die. */
  readonly name: string
  /** One-line rules text for tooltips/UI. */
  readonly description: string
  /** Single glyph badge drawn on the die face in the UI. */
  readonly icon: string
  /**
   * Whether the ability helps or hurts the die that carries it. Drives the UI accent, so
   * a malus never reads as a buff at a glance. Kept here rather than in the UI so a new
   * ability declares its own colour along with its rules.
   */
  readonly kind: 'buff' | 'malus'
  /**
   * When true this ability may only sit on a player's OWN dice, never on a shared common
   * die. Needed by effects defined in terms of "the opponent": a common die has no owner
   * yet when it is rolled, so there is nobody to target.
   */
  readonly ownOnly?: boolean
  /**
   * Whether a Dado Spugna can cancel this ability.
   *
   * Declared per-ability rather than as a list inside the reducer, so adding the Nth ability
   * forces its author to answer the question here, next to the rules text, instead of
   * discovering months later that the sponge silently ignores it.
   *
   * False (or absent) for anything that decides its own FACE when rolled: by the time a
   * sponge target is chosen the face is already committed to `Die.value` and the alternatives
   * it beat are gone, so there is nothing left to cancel. True only for effects that are
   * still pending — or, for NERO_DI_SEPPIA, still reversible.
   */
  readonly spongeable?: boolean
  /**
   * How many raw d6 faces this ability consumes per roll. Used by the UI (to size the
   * split animation) and by simulations reasoning about entropy consumption.
   */
  readonly diceRolled: number
  /**
   * Rolls this ability, returning the faces produced (most relevant first is NOT assumed;
   * `resolve` decides the kept value). Pure apart from the injected Rng.
   */
  readonly roll: (rng: Rng) => readonly DieValue[]
  /** Picks the final face from the rolled faces. */
  readonly resolve: (rolls: readonly DieValue[]) => DieValue
}

/**
 * Roll-time conditions imposed on a die by something OTHER than its own ability.
 *
 * The third home for an ability's effect, after AbilitySpec.roll (which decides a face) and
 * the reducer (which acts on state). It exists because DADO_BRUMEGGIO is the first ability
 * that changes how the OPPONENT's dice are rolled, and neither of the other two homes can
 * hold that: a spec may only decide its own die's face, and the reducer has no one moment to
 * act on, since the first roll, both rerolls and a Mulinello's third roll are all affected.
 *
 * An object rather than a positional boolean, so a call site says WHAT it is imposing —
 * `rollDieWithAbility(rng, ability, true)` reads as nothing at all — and so the next ability
 * of this shape adds a field instead of another parameter.
 */
export interface RollModifiers {
  /**
   * The seat rolling this die is fogged: an opponent holds an active Dado Brumeggio, so the
   * die rolls its ability TWICE and keeps the lower result. See rollDieWithAbility for the
   * composition rule, which is the part worth reading before changing anything here.
   */
  readonly fogged?: boolean | undefined
}

/** No modifiers — a plain roll. The default, so every existing call site is unchanged. */
export const NO_MODIFIERS: RollModifiers = {}

/** Rolls `n` raw faces. */
function rollFaces(rng: Rng, n: number): readonly DieValue[] {
  const faces: DieValue[] = []
  for (let i = 0; i < n; i++) {
    faces.push(rng.rollDie())
  }
  return faces
}

/** Highest of the rolled faces. */
function keepHighest(rolls: readonly DieValue[]): DieValue {
  return rolls.reduce<DieValue>((best, v) => (v > best ? v : best), 1)
}

/** Lowest of the rolled faces. Mirror of keepHighest; used by the fog, not by any spec. */
function keepLowest(rolls: readonly DieValue[]): DieValue {
  return rolls.reduce<DieValue>((worst, v) => (v < worst ? v : worst), 6)
}

/**
 * The ability registry. Every ability the game knows about lives here.
 *
 * Expected value note (for balance work): Stella Essiccata's max-of-3 on a d6 has
 * E[value] = 4.958 vs 3.5 for a plain die, and P(6) = 42%. That is a big buff —
 * measure it with the Monte Carlo sim before raising its drop rate.
 */
export const ABILITIES: Readonly<Record<AbilityId, AbilitySpec>> = {
  STELLA_ESSICCATA: {
    id: 'STELLA_ESSICCATA',
    name: 'Dado Stella Essiccata',
    description: 'Quando viene lanciato si divide in 3 dadi e tiene il valore più alto.',
    // Emoji, not a symbol glyph: the badge is 18px and one of seven, so it has to be
    // recognisable at a glance rather than merely distinct. A literal starfish beats an
    // abstract asterisk nobody can name, and matches the die's own name.
    icon: '🌟',
    kind: 'buff',
    diceRolled: 3,
    roll: (rng) => rollFaces(rng, 3),
    resolve: keepHighest,
  },
  D4: {
    id: 'D4',
    name: 'Dado D4',
    description: 'Dado a 4 facce: esce sempre un valore da 1 a 4.',
    // Reads as "capped", which is what a d4 does: it can never show a 5 or a 6. Chosen over a
    // triangle glyph (invisible next to six emoji) and over 🔻 (a warning sign, which oversells
    // a die that is merely weak).
    icon: '🔽',
    kind: 'malus',
    // One physical die, one face — but drawn from a 4-sided range instead of a d6.
    diceRolled: 1,
    // E[value] = 2.5 vs 3.5 for a plain d6, and it can never show a 5 or a 6. A malus
    // die: it caps the hand's top end, so it hurts high-card and pairs-of-sixes hands
    // most. Measure it with the Monte Carlo sim before tuning its drop rate.
    roll: (rng) => [rng.nextInt(1, 4) as DieValue],
    resolve: (rolls) => rolls[0]!,
  },
  NERO_DI_SEPPIA: {
    id: 'NERO_DI_SEPPIA',
    name: 'Dado Nero di Seppia',
    description:
      "Nasconde un dado dell'avversario fino allo showdown. Tra i dadi comuni acceca entrambi finché qualcuno non lo ruba.",
    icon: '🦑',
    kind: 'buff',
    // Not ownOnly: an unclaimed common Seppia belongs to nobody, so it blinds BOTH seats,
    // and narrows to the opponent alone once a player steals it (see applyConcealment and
    // releaseCommonConcealment in game.ts). That gives the "no owner" case a real target.
    // Value-wise a plain d6 — the die itself is ordinary. Its power is informational and
    // is applied by the reducer when the hand is dealt (see applyConcealment in game.ts),
    // because AbilitySpec is only allowed to decide faces.
    //
    // Spongeable by REVERSAL, not prevention: this lands on entry into STEAL, before a sponge
    // target can be named, so the Spugna gives sight back rather than stopping the blinding.
    spongeable: true,
    diceRolled: 1,
    roll: (rng) => [rng.rollDie()],
    resolve: (rolls) => rolls[0]!,
  },
  DADO_D_ORO: {
    id: 'DADO_D_ORO',
    name: "Dado d'Oro",
    description:
      'Se vinci la mano incassi il doppio del piatto. Se resta tra i dadi comuni vale per entrambi.',
    icon: '🪙',
    kind: 'buff',
    // Not ownOnly: an unstolen common Dado d'Oro doubles for WHOEVER wins, so it has a real
    // effect with no owner and must not be filtered out of the commons.
    // Value-wise a plain d6 — it never helps you win the hand, only what winning pays. The
    // payout is applied by the reducer at resolveHand time (see goldenPayoutSource in
    // game.ts), because AbilitySpec is only allowed to decide faces.
    // Spongeable: the doubling is still pending when a target is chosen.
    spongeable: true,
    diceRolled: 1,
    roll: (rng) => [rng.rollDie()],
    resolve: (rolls) => rolls[0]!,
  },
  DADO_TORPEDO: {
    id: 'DADO_TORPEDO',
    name: 'Dado Torpedo',
    description:
      "Scegli un dado dell'avversario: allo showdown perde 1. Il 10% delle volte elettrizza il campo e un tuo dado a caso perde 1 pure lui. Tra i comuni colpisce entrambi a caso.",
    icon: '⚡',
    // A malus: it damages a die, so it must read violet like the D4 and never as a reward.
    // Note the die it sits on is a normal d6 — the malus is inflicted on the OPPONENT.
    kind: 'malus',
    // Not ownOnly: an unstolen common Torpedo zaps both seats, so it has a real effect with
    // no owner and must not be filtered out of the commons.
    // Value-wise a plain d6. Its power is a -1 on someone else's die, applied by the reducer
    // at showdown time (see applyTorpedoes in game.ts), because AbilitySpec is only allowed
    // to decide faces — and because applying it any earlier would let a reroll undo it.
    // Spongeable: the -1 has not landed yet when a target is chosen. Note a sponged Torpedo
    // still CONSUMES its Rng draws (see applyTorpedoes) — only the damage is cancelled.
    spongeable: true,
    diceRolled: 1,
    roll: (rng) => [rng.rollDie()],
    resolve: (rolls) => rolls[0]!,
  },
  MULINELLO: {
    id: 'MULINELLO',
    name: 'Dado Mulinello',
    description:
      'Oltre al rilancio normale, se il secondo risultato non ti piace puoi tirare questo dado una terza volta. Scegli dopo aver visto il risultato. Tra i comuni non fa nulla finché non lo rubi.',
    // A fishing reel has no emoji, so the rod stands in for it — nearest thing that reads as
    // "reel it back and cast again", which is the ability. The gear glyph it replaces was
    // generic enough to mean anything.
    icon: '🎣',
    kind: 'buff',
    // Not ownOnly: an extra roll needs an owner to decide, and stealing one from the commons
    // supplies exactly that — seatHolds counts a stolen die, so the thief gets the choice.
    // Left unstolen it simply does nothing, which is the honest outcome for an ability whose
    // whole content is a decision: there is nobody to make it. Compare DADO_TORPEDO, which
    // stays effective unowned because a random victim needs no chooser.
    // Value-wise a plain d6, like the Torpedo. Its power is a THIRD roll of this same die,
    // offered in MULINELLO_SELECT (see handleMulinello in game.ts) — a spec may only decide
    // faces, and this one has to wait for the player to see the second result first.
    // Spongeable: cancelling it skips MULINELLO_SELECT for that seat entirely.
    spongeable: true,
    diceRolled: 1,
    roll: (rng) => [rng.rollDie()],
    resolve: (rolls) => rolls[0]!,
  },
  DADO_SPUGNA: {
    id: 'DADO_SPUGNA',
    name: 'Dado Spugna',
    description:
      "Scegli un'abilità dell'avversario: per questa mano non ha effetto. Non funziona su Dado Stella Essiccata e Dado D4, che hanno già deciso la loro faccia, e non può assorbire un altro Dado Spugna. Tra i comuni non fa nulla finché non lo rubi.",
    // A sponge emoji exists and means exactly the ability: it soaks something up. Replaces a
    // bare hexagon outline, which meant nothing and nearly vanished at badge size.
    icon: '🧽',
    kind: 'buff',
    // Not ownOnly, and not spongeable. Same reasoning as the Mulinello for the first: the
    // choice needs an owner, and stealing one supplies it, so it must be able to drop among
    // the commons. Not spongeable by explicit design call — a sponge war would resolve by
    // seat order, which would make the primary role decide it rather than the players.
    // Value-wise a plain d6. Its power is the absence of someone else's power, applied
    // wherever an effect is read (see isNullified in game.ts).
    diceRolled: 1,
    roll: (rng) => [rng.rollDie()],
    resolve: (rolls) => rolls[0]!,
  },
  DADO_LANTERNA: {
    id: 'DADO_LANTERNA',
    name: 'Dado Lanterna',
    description:
      "Illumina il mazzo dell'avversario: quando vuoi, dai una sbirciata a tutti i suoi 12 dadi. Una volta per mano, e quando chiudi non li rivedi più. Tra i comuni non fa nulla finché non lo rubi.",
    icon: '🏮',
    kind: 'buff',
    // Not ownOnly: the peek needs an observer, and stealing one supplies exactly that —
    // seatHolds counts a stolen die. Unclaimed among the commons it lights for nobody, the
    // same honest outcome as the MULINELLO.
    //
    // NOT spongeable, and NOT for the reason an earlier version of this comment gave. It is
    // not that "the information is already out" — the peek is player-triggered, so it may well
    // not have been taken when a Spugna is aimed in REROLL_SELECT. The real reason is that
    // cancelling it would resolve by WHEN THE PLAYER CLICKED: a peek taken in STEAL is already
    // spent and untouchable, one saved for SECOND_BET is not, and REROLL_SELECT is sequential
    // so the primary would sponge before the non-primary had the chance. "Your Spugna cancels
    // their Lanterna if and only if they hadn't got round to it" is not a rule anyone can play
    // to. DADO_SPUGNA is itself non-spongeable to avoid a race decided by seat order; a race
    // decided by click timing is strictly worse.
    //
    // The structural difference: the other four spongeable abilities each fire at ONE moment
    // the reducer picks (Torpedo at the showdown, d'Oro at payout, Mulinello in its phase,
    // Seppia on the deal). This is the first whose moment the PLAYER picks, and that is what
    // makes it un-spongeable as a rule rather than as an accident.
    //
    // Value-wise a plain d6. Its power is knowledge, spent by the player (see handleLanternPeek
    // in game.ts) — and it is the only ability that consumes NO Rng, since nothing about it is
    // rolled or chosen.
    diceRolled: 1,
    roll: (rng) => [rng.rollDie()],
    resolve: (rolls) => rolls[0]!,
  },
  DADO_BRUMEGGIO: {
    id: 'DADO_BRUMEGGIO',
    name: 'Dado Brumeggio',
    description:
      "Annebbia l'avversario: ogni suo dado esce due volte e tiene il più basso, per tutta la mano. Tra i comuni non fa nulla finché non lo rubi.",
    // A literal fog bank: horizontal grey bands, which nothing else in the badge set is.
    // Chosen over 🌁 (an unreadable smudge of bridge at 18px, and it names a PLACE rather than
    // a condition) and 💨 (reads as "fast", the opposite of what this does). Note it carries a
    // variation selector, so icon.length is 3 — nothing counts characters, only concatenates.
    icon: '🌫️',
    // A malus, and like the DADO_TORPEDO the die it sits on is a plain d6: the malus is
    // inflicted on the OPPONENT, not on this die. It must read violet, never gold.
    kind: 'malus',
    // Not ownOnly — and this is the one ability where the ownOnly doc above argues the other
    // way, so the reasoning is worth spelling out.
    //
    // The fog is defined as "the OPPONENT's rolls", and a die sitting at the centre has no
    // opponent. So unlike a Torpedo (whose random victim needs nobody to choose it, and which
    // therefore stays live unowned) an unstolen Brumeggio has nothing to point at: it does
    // NOTHING until somebody steals it. That is what makes it not-ownOnly rather than ownOnly
    // — it must still be able to DROP among the commons and be stolen, exactly like the
    // MULINELLO, the DADO_SPUGNA and the DADO_LANTERNA, and seatHolds counts a stolen die, so
    // a thief gets a real ability rather than a dead one.
    //
    // The exception being made deliberately: this project's usual reasoning is "an effect that
    // needs no chooser stays active unowned". The fog needs no chooser either — it is not a
    // decision. It needs an OWNER, because "the opponent" is not a thing a common die has.
    //
    // Value-wise a plain d6. Its power is applied at ROLL TIME to somebody else's dice, which
    // is a third home for an effect: not in `roll` below (a spec may only decide its own face)
    // and not at one moment in the reducer (there is no one moment — every roll of the hand is
    // fogged). See RollModifiers above and isFogged in game.ts.
    //
    // Spongeable by REVERSAL, like NERO_DI_SEPPIA and for the same reason: the fog is already
    // on the first roll, long before a sponge target can be named in REROLL_SELECT, so the
    // Spugna LIFTS it from that point on rather than preventing it. Dice already thrown are
    // not re-rolled. Note the consequence for Rng, which is the opposite of the Torpedo's: a
    // sponged fog consumes FEWER draws downstream, because here the draws ARE the dice, and
    // there is no later stream to keep aligned.
    spongeable: true,
    // 1, not 2: diceRolled describes THIS ability, which rolls a plain d6 like the other five
    // stubs. The doubling belongs to the fog and is applied to the VICTIM's dice, not here.
    diceRolled: 1,
    roll: (rng) => [rng.rollDie()],
    resolve: (rolls) => rolls[0]!,
  },
}

/** Whether a Dado Spugna is allowed to cancel `ability`. */
export function isSpongeable(ability: AbilityId): boolean {
  return ABILITIES[ability].spongeable === true
}

/** Looks up an ability spec, or null for a plain die. */
export function abilitySpec(ability: AbilityId | null | undefined): AbilitySpec | null {
  return ability == null ? null : ABILITIES[ability]
}

/**
 * Rolls a single die, applying its ability if it has one, under any imposed `mods`.
 *
 * This is THE roll entry point for any die that belongs to a player: it keeps the
 * ability attached to the resulting Die (so a later reroll re-applies it) and records
 * the individual faces in `rolls` for the UI to display the split.
 *
 * A plain die (no ability) records no `rolls` — it stays a bare `{ value }`, so nothing
 * downstream sees a behavioural change from this module existing.
 */
export function rollDieWithAbility(
  rng: Rng,
  ability?: AbilityId | undefined,
  mods: RollModifiers = NO_MODIFIERS,
): Die {
  const spec = abilitySpec(ability)

  // The clear path is the ONLY path a die took before the Brumeggio existed, and it is still
  // bit-for-bit what it was: one rng.rollDie() for a plain die, no `rolls` array, a bare
  // { value }. Several things downstream key off that absence (maskDie in view.ts, dieStr's
  // split, DieView's split), so it must stay exactly this shape.
  if (mods.fogged !== true) {
    if (spec === null) {
      return { value: rng.rollDie() }
    }
    const rolls = spec.roll(rng)
    return { value: spec.resolve(rolls), ability: spec.id, rolls }
  }

  // FOGGED. The composition rule, stated here because this is the only place in the codebase
  // where two face-deciding rules meet: the die rolls its OWN ability TWICE, independently,
  // and the fog keeps the lower of the two RESULTS. Not "pool every face and take the minimum".
  //
  // Why result-of-two rather than min-of-the-pool: each ability keeps its own identity. A
  // fogged Stella still splits into 3 and keeps its max — twice — and the fog then picks the
  // worse of those two, E = 4.356 against its clear 4.958. Pooling all six faces and taking
  // the minimum would give 1.440, which is not "a Stella in fog", it is the fog eating the
  // Stella whole. Same for the D4: two d4s, keep the lower, E = 1.875, and still never above
  // 4. Every ability's rule survives the fog; the fog only chooses between two honest
  // outcomes of it. (There is a test pinning exactly this difference.)
  //
  // FIXED DRAW COUNT: always exactly 2 * diceRolled faces, never "roll once and maybe again".
  // A draw count that varied with the faces would shift the downstream stream and break
  // seeded replay — the project's fixed-draw rule, see applyTorpedoes in game.ts.
  if (spec === null) {
    const rolls = [rng.rollDie(), rng.rollDie()] as const
    // A fogged plain die DOES carry a `rolls` array, unlike a clear one: the split is the only
    // way the UI and the log can show "rolled 5/2, kept 2", and a die rolled in fog is not an
    // ordinary die however plain the physical die is.
    return { value: keepLowest(rolls), rolls }
  }
  const first = spec.roll(rng)
  const second = spec.roll(rng)
  const a = spec.resolve(first)
  const b = spec.resolve(second)
  return {
    value: a <= b ? a : b,
    ability: spec.id,
    // BOTH attempts, concatenated, so the log and the UI show every face the fog produced.
    // Note this is 2 * spec.diceRolled entries on a die whose spec says diceRolled: 1. That
    // is correct and must not be "fixed": diceRolled describes the ABILITY, and the fog is
    // not the ability. Nothing compares rolls.length to diceRolled outside the registry
    // self-consistency test, which calls spec.roll() directly and never reaches this path.
    rolls: [...first, ...second],
  }
}

/**
 * Rerolls a die in place, preserving its ability.
 * Used by the reroll step, where the physical die (and thus its ability) is kept.
 *
 * The fog is NOT carried on the Die — it is a property of the seat, re-derived at each roll.
 * That is what makes a sponged fog lift cleanly: a die rerolled after the sponge comes back
 * clear, with no per-die state anywhere to clear.
 */
export function rerollDie(rng: Rng, die: Die, mods: RollModifiers = NO_MODIFIERS): Die {
  return rollDieWithAbility(rng, die.ability, mods)
}

/** All ability ids, in registry order. Handy for UI pickers and simulations. */
export const ALL_ABILITY_IDS: readonly AbilityId[] = Object.keys(ABILITIES) as AbilityId[]
