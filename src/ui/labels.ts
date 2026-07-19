import {
  OrdinaryRank,
  StraightKind,
  type EvaluatedHand,
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

/** Italian name of a hand's category (e.g. "Full house", "Scala di sei"). */
export function categoryLabel(hand: EvaluatedHand): string {
  return hand.category.kind === 'ordinary'
    ? ORDINARY_LABEL[hand.category.rank]
    : STRAIGHT_LABEL[hand.category.straight]
}

/** Display name of a seat. */
export function playerLabel(p: PlayerId): string {
  return p === 'human' ? 'Tu' : 'Bot'
}
