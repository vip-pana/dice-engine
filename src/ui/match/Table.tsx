import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { AbilityId, GameState } from '../../engine'
import { playerLabel } from '../labels'
import { useIsPhone } from '../responsive'
import { humanHoldsTorpedo, type UseGameDispatch } from '../handState'
import { RollOffView } from './rows/RollOffView'
import { CommonRow } from './rows/CommonRow'
import { BotRow } from './rows/BotRow'
import { HumanRow } from './rows/HumanRow'
import { AbilityModal, type AbilityFocus } from './AbilityModal'

export function Table({
  state,
  dispatch,
  grow = false,
  abilityFocus,
  onAbilityFocus,
}: {
  state: GameState
  dispatch: UseGameDispatch
  /** Stretch to fill the remaining column height (wide layout only). */
  grow?: boolean
  /**
   * The ability modal's open state, owned by Match (it is presentation state, like the log
   * drawer's) but rendered from here: this is where the torpedo aim and the sponge target live,
   * and the modal is a third consumer of them rather than a new owner.
   */
  abilityFocus: AbilityFocus
  onAbilityFocus: (focus: AbilityFocus) => void
}): JSX.Element {
  const primaryLabel = playerLabel(state.primary)
  const phone = useIsPhone()
  const humanIsToAct = state.toAct === 'human'

  // A Dado Torpedo is aimed at a BOT die but confirmed from the human row, so the choice
  // lives here, in the nearest common parent of the two rows.
  const aiming = state.phase === 'REROLL_SELECT' && humanIsToAct && humanHoldsTorpedo(state)
  const [torpedoTarget, setTorpedoTarget] = useState<number | null>(null)

  // The Spugna target is chosen in the same window and confirmed by the same button, so it
  // lives beside the aim rather than inside HumanRow — same reasoning, same lifetime.
  const [spongeTarget, setSpongeTarget] = useState<AbilityId | null>(null)
  const selectingReroll = state.phase === 'REROLL_SELECT' && humanIsToAct

  // Drop a stale aim when the hand moves on, so last hand's target cannot leak into the next.
  useEffect(() => {
    if (!aiming) setTorpedoTarget(null)
  }, [aiming, state.handNumber])
  useEffect(() => {
    if (!selectingReroll) setSpongeTarget(null)
  }, [selectingReroll, state.handNumber])

  return (
    <section
      style={grow ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}
    >
      <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 0 }}>
        Primario di mano: <strong>{primaryLabel}</strong>
      </p>

      <RollOffView state={state} />

      {/*
        Seated like a real table, read top to bottom: the OPPONENT across from you, the
        shared dice on the felt between you, your own dice nearest to you. That ordering
        is what makes the steal legible — the commons sit physically between the two
        hands competing for them.
      */}
      <div
        style={{
          borderRadius: 16,
          border: '1px solid #1e293b',
          background: 'linear-gradient(180deg, #101c2e 0%, #0d1826 55%, #101c2e 100%)',
          // Tighter felt padding on a phone: 16px a side is width the dice rows need more.
          padding: phone ? '12px 10px' : '14px 16px',
          // The rows wrap, so nothing should reach past the panel — but if a future row ever
          // does, it scrolls INSIDE the felt rather than dragging the whole page sideways and
          // making the browser zoom the app out.
          minWidth: 0,
          overflowX: 'auto',
          // When stretching, the panel fills the column and the bands share the extra
          // height (capped, see Band). `overflow: auto` keeps a tall hand scrollable on a
          // short viewport instead of spilling out of the panel.
          ...(grow
            ? {
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                overflow: 'auto',
              }
            : null),
        }}
      >
        <Band grow={grow}>
          <SeatLabel text="Bot" highlight={state.toAct === 'bot'} />
          <BotRow
            state={state}
            aiming={aiming}
            torpedoTarget={torpedoTarget}
            onAim={setTorpedoTarget}
          />
        </Band>

        <FeltDivider />

        <Band grow={grow}>
          <SeatLabel text="Dadi comuni" muted />
          <CommonRow
            state={state}
            canSteal={state.phase === 'STEAL' && humanIsToAct}
            dispatch={dispatch}
          />
        </Band>

        <FeltDivider />

        <Band grow={grow}>
          <SeatLabel text="I tuoi dadi" highlight={humanIsToAct} />
          <HumanRow
            state={state}
            dispatch={dispatch}
            aiming={aiming}
            torpedoTarget={torpedoTarget}
            spongeTarget={spongeTarget}
          />
        </Band>
      </div>

      {/*
        The gesture has to be told, once: a hover has no affordance and a hold even less. It sits
        under the felt rather than in the sidebar because that is where the dice are, and it is
        worded per input — "passa il mouse" on a phone would be advice for hardware the player
        does not have.
      */}
      <p style={{ margin: '10px 0 0', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
        {phone
          ? 'Tieni premuto un dado per leggere nome e abilità.'
          : 'Passa il mouse su un dado per leggerne nome e abilità.'}
      </p>

      {/* Portalled to the body, so rendering it from inside the felt's subtree costs nothing —
          and the felt is `overflow: auto`, which would clip a fixed child rendered in place. */}
      <AbilityModal
        state={state}
        dispatch={dispatch}
        focus={abilityFocus}
        onFocus={onAbilityFocus}
        onClose={() => onAbilityFocus(null)}
        torpedoTarget={torpedoTarget}
        onAimTorpedo={setTorpedoTarget}
        spongeTarget={spongeTarget}
        onSponge={setSpongeTarget}
      />
    </section>
  )
}

/** Small heading above a row of dice. Highlighted when it is that seat's turn to act. */
function SeatLabel({
  text,
  muted = false,
  highlight = false,
}: {
  text: string
  muted?: boolean
  highlight?: boolean
}): JSX.Element {
  return (
    // Centred over its own row of dice, which is centred too — a left-aligned label above a
    // centred row reads as a mistake rather than as a heading.
    <div style={{ marginBottom: 8, textAlign: 'center' }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          color: highlight ? '#fbbf24' : muted ? '#64748b' : '#94a3b8',
        }}
      >
        {text}
      </span>
    </div>
  )
}

/**
 * One horizontal band of the table (a seat, or the shared felt).
 *
 * When the board stretches, bands share the spare height and centre their content — but
 * they only GROW (flex-grow), never stretch from a zero basis. Sizing them from `0` split
 * the height into three equal thirds, which on a tall screen flung the rows so far apart
 * the table stopped reading as one surface.
 */
function Band({ grow, children }: { grow: boolean; children: ReactNode }): JSX.Element {
  return (
    <div
      style={
        grow
          ? {
              // Cap the BREATHING ROOM, never the content. 140px is the FLOOR that gives a short
              // row its airy spacing, and a tall row is free to exceed it. A `maxHeight` here
              // does not scroll and does not expand: a REROLL row (value chips plus a "preso" /
              // "rubato" caption, ~176px) simply painted OUTSIDE the band, over the neighbouring
              // section. A cap on a box whose content can grow has to be a cap on its SLACK.
              flex: '0 0 auto',
              minHeight: 140,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}

/** Hairline separating the three bands of the table. */
function FeltDivider(): JSX.Element {
  return (
    <div
      style={{
        height: 1,
        margin: '14px 0',
        background: 'linear-gradient(90deg, transparent, #1e293b 15%, #1e293b 85%, transparent)',
      }}
    />
  )
}
