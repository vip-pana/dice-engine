import type { JSX } from 'react'
import { ALL_HAND_CATEGORIES, categoryPriority, type HandCategory } from '../../engine'
import { categoryName } from '../labels'

/**
 * The "which hand beats which" ladder, strongest at the top, with live markers showing
 * where each seat currently stands.
 *
 * Purely presentational: the ORDER is not written here, it comes from ALL_HAND_CATEGORIES
 * (engine/hand.ts), so retuning straight priority or adding a category updates this panel
 * without an edit. Seats are matched by categoryPriority rather than by object identity —
 * the categories handed in come from evaluateHand, not from ALL_HAND_CATEGORIES.
 */
export function HandRankingLegend({
  human,
  humanUncertain,
  bot,
}: {
  /** The human's current category, or null before the 5-die hand is formed. */
  human: HandCategory | null
  /** A die of the human's hand is concealed, so `human` is an estimate, not a fact. */
  humanUncertain: boolean
  /** The bot's current category, or null before its hand is formed. */
  bot: HandCategory | null
}): JSX.Element {
  const humanAt = human === null ? null : categoryPriority(human)
  const botAt = bot === null ? null : categoryPriority(bot)

  // Strongest first: a ranking reads top-down. The engine list is weakest-first because
  // that is the direction priority numbers grow.
  const strongestFirst = [...ALL_HAND_CATEGORIES].reverse()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {strongestFirst.map((category) => {
        const priority = categoryPriority(category)
        const isHuman = priority === humanAt
        const isBot = priority === botAt
        const marked = isHuman || isBot

        return (
          <div
            key={priority}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '3px 8px',
              borderRadius: 6,
              // A marked row is lifted out of the list; the rest stay quiet so the eye
              // lands on the two positions that matter.
              background: marked ? '#111c31' : 'transparent',
              border: `1px solid ${marked ? '#334155' : 'transparent'}`,
            }}
          >
            <span
              style={{
                fontSize: 12,
                lineHeight: 1.4,
                fontWeight: marked ? 600 : 400,
                color: marked ? '#e2e8f0' : '#64748b',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {categoryName(category)}
            </span>
            <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {isHuman && <Marker label={humanUncertain ? 'TU?' : 'TU'} uncertain={humanUncertain} />}
              {isBot && <Marker label="BOT" />}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Seat chip. Colours mirror HandBadge in App.tsx (teal = you, grey = bot) so the legend
 * and the badge next to the dice read as the same information.
 *
 * `uncertain` draws it dashed and dimmed: with a concealed die the position is computed
 * from a placeholder face, so it is a best guess and must not look like a fact.
 */
function Marker({ label, uncertain = false }: { label: string; uncertain?: boolean }): JSX.Element {
  const isHuman = label.startsWith('TU')
  return (
    <span
      title={uncertain ? 'Stima: un tuo dado è nascosto' : undefined}
      style={{
        padding: '1px 7px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        background: uncertain ? 'transparent' : isHuman ? '#164e63' : '#3f3f46',
        color: uncertain ? '#67e8f9' : '#e2e8f0',
        border: uncertain ? '1px dashed #0e7490' : '1px solid transparent',
        opacity: uncertain ? 0.75 : 1,
      }}
    >
      {label}
    </span>
  )
}
