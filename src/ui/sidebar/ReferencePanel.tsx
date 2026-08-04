import type { JSX } from 'react'
import { evaluateHand, type GameState, type HandCategory, type PlayerHandState } from '../../engine'
import { useIsPhone } from '../responsive'
import { HandRankingLegend } from '../components/HandRankingLegend'
import { liveFinalHand } from '../handState'

/**
 * The hand ranking ladder — the one static rules reference the sidebar still carries.
 *
 * A die now explains itself when you hover it or hold it down (see DieTooltip), which is why the
 * catalogue of all ten specials that used to share this panel on tabs is gone: the rules text
 * sits on the die you are already looking at. The ladder has no such home — it is about five dice
 * at once, not one — so it stays, and with one reference left the tabs went too.
 */
export function ReferencePanel({
  state,
  grow = false,
}: {
  state: GameState
  /** Take the leftover column height instead of sizing to content. */
  grow?: boolean
}): JSX.Element {
  const phone = useIsPhone()

  return (
    <section
      style={{
        padding: 14,
        borderRadius: 12,
        background: '#0b1220',
        border: '1px solid #1e293b',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        // A flex rather than a `maxHeight`: the flex is what keeps the column from ending in dead
        // space, and `minHeight: 0` is what lets the ladder scroll internally instead of
        // overflowing. Not growing (stacked layout): natural height, and the body caps itself.
        ...(grow ? { flex: '1 1 0', minHeight: 0 } : null),
      }}
    >
      <h2
        style={{
          margin: '0 0 8px',
          fontSize: 14,
          fontWeight: 700,
          color: '#94a3b8',
          letterSpacing: 0.3,
        }}
      >
        Classifica mani
      </h2>

      <div
        style={{
          overflowY: 'auto',
          minHeight: 0,
          // On a phone this panel already sits inside a folded disclosure, so capping it would
          // put a scroller inside a scroller — the one gesture guaranteed to trap a thumb. Let
          // it size to content there and leave the page as the only thing that scrolls.
          ...(grow ? { flex: 1 } : phone ? null : { maxHeight: 340 }),
        }}
      >
        <RankingReference state={state} />
      </div>
    </section>
  )
}

/**
 * The hand ranking ladder with live markers for both seats.
 *
 * IMPORTANT: it must be fed the human's VIEW of the state (what Match renders), never the
 * raw state. A Nero di Seppia hides one of your own dice, and viewFor replaces that face
 * with a placeholder — so the position computed here is an estimate, which is exactly why
 * the marker is drawn with a "?". Passing the true state would leak the hidden face by
 * pointing at the real category.
 */
function RankingReference({ state }: { state: GameState }): JSX.Element {
  const humanCategory = categoryOf(state.hands.human)
  const botCategory = categoryOf(state.hands.bot)
  const humanUncertain = state.hands.human.own?.some((d) => d.concealed) ?? false

  return (
    <>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
        {humanCategory === null
          ? 'Dalla più forte alla più debole. I marker appaiono quando la mano è completa.'
          : 'Chi sta più in alto vince. A parità di categoria decidono i dadi più alti.'}
      </p>
      <HandRankingLegend human={humanCategory} humanUncertain={humanUncertain} bot={botCategory} />
    </>
  )
}

/** Category of a seat's provisional 5-die hand, or null while it is still incomplete. */
function categoryOf(hand: PlayerHandState): HandCategory | null {
  const live = liveFinalHand(hand)
  return live === null ? null : evaluateHand(live).category
}
