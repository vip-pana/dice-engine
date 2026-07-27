import {
  OrdinaryRank,
  StraightKind,
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
