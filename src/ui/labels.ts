import {
  OrdinaryRank,
  StraightKind,
  stakesFor,
  type Difficulty,
  type EvaluatedHand,
  type HandCategory,
  type PlayerId,
} from '../engine'

// Presentation-only mappings from engine enums to Italian display strings.
// These are UI concerns (localized text), NOT game rules.

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

/** Italian name of a category (e.g. "Full house", "Scala di sei"). */
export function categoryName(category: HandCategory): string {
  return category.kind === 'ordinary'
    ? ORDINARY_LABEL[category.rank]
    : STRAIGHT_LABEL[category.straight]
}

/** Italian name of an evaluated hand's category. */
export function categoryLabel(hand: EvaluatedHand): string {
  return categoryName(hand.category)
}

/** Display name of a seat. */
export function playerLabel(p: PlayerId): string {
  return p === 'human' ? 'Tu' : 'Bot'
}

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Facile',
  normal: 'Normale',
  hard: 'Difficile',
}

/** Display name of a difficulty level. */
export function difficultyLabel(d: Difficulty): string {
  return DIFFICULTY_LABEL[d]
}

/**
 * How the Bot plays at this level, in one sentence.
 *
 * Names MECHANISMS rather than adjectives ("tiene al massimo due dadi", not "gioca male"), so a
 * player can watch for the behaviour and recognise it. "È il comportamento di sempre" for normale
 * mirrors the wording the mirrored-deck option already uses.
 */
const DIFFICULTY_BOT_BLURB: Record<Difficulty, string> = {
  easy: 'Al rilancio tiene troppi dadi (ne cambia al massimo 2), punta sulla mano che vede invece di quella che potrebbe ottenere, e non passa né rilancia mai: paga sempre.',
  normal: 'È il comportamento di sempre: sceglie il rilancio a stime, punta sulla mano che può raggiungere, passa le mani deboli quando il prezzo è alto.',
  hard: "Ruba calcolando anche il rilancio che il furto gli apre, sceglie il rilancio esatto invece di stimarlo, sa che nella nebbia i dadi valgono meno, e rilancia il doppio. Non vede più di te: calcola meglio.",
}

/**
 * The money side of a level, derived from the engine's own table rather than restated — a blurb
 * that disagreed with the stakes actually applied would be worse than no blurb.
 *
 * It names the two things the player will SEE change in the betting controls (the step of the
 * bet and the raise cap), because both bind the human too: without saying so, the raise button
 * greying out sooner on Facile reads as a bug.
 */
export function difficultyStakesBlurb(d: Difficulty): string {
  const { config, startingBankroll } = stakesFor(d)
  return `${startingBankroll} monete a testa, puntata minima ${config.minBet}, fino a ${config.maxRaisesPerWindow} rilanci per giro — minimo e tetto valgono anche per te.`
}

/** What the level does to the Bot's generated deck. */
const DIFFICULTY_DECK_BLURB: Record<Difficulty, string> = {
  easy: 'Il suo mazzo ha un dado speciale in meno del tuo.',
  normal: 'Il suo mazzo segue la modalità che scegli qui sotto.',
  hard: 'Il suo mazzo ha un dado speciale in più del tuo.',
}

export function difficultyBlurb(d: Difficulty): string {
  return `${DIFFICULTY_BOT_BLURB[d]} ${difficultyStakesBlurb(d)} ${DIFFICULTY_DECK_BLURB[d]}`
}
