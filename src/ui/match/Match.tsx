import { useState, type JSX } from 'react'
import { viewFor } from '../../engine'
import { useGame } from '../useGame'
import { difficultyLabel } from '../labels'
import { useIsPhone, useIsWide } from '../responsive'
import { optionsForSetup, type Setup } from '../setup/setup'
import { ReferenceStack } from '../sidebar/ReferenceStack'
import { DeckPanel } from '../sidebar/DeckPanel'
import { BotDeckPanel } from '../sidebar/BotDeckPanel'
import { ReferencePanel } from '../sidebar/ReferencePanel'
import { ScoreBar } from './ScoreBar'
import { BotAutoPlayer } from './BotAutoPlayer'
import { Table } from './Table'
import { PhaseBanner } from './PhaseBanner'
import { OutcomeBanner } from './OutcomeBanner'
import { Controls } from './Controls'
import { LastMove } from './LastMove'
import { LogDrawer } from './LogDrawer'

export function Match({
  setup,
  onRebuild,
}: {
  setup: Setup
  onRebuild: () => void
}): JSX.Element {
  const deck = setup.deck
  // No seed: every match deals differently. Pass one to replay a specific game.
  const { state: trueState, dispatch, newMatch } = useGame(undefined, optionsForSetup(setup))
  const wide = useIsWide()
  const phone = useIsPhone()

  // Presentation state, not game state, so it lives here and never reaches useGame: the engine
  // reducer has no business knowing whether a panel is open, and a match replayed from a seed
  // must not depend on it.
  const [logOpen, setLogOpen] = useState(false)

  // Which hand's result the player has waved away, so the final dice can be inspected without
  // advancing. Keyed on the hand NUMBER rather than a boolean: a plain `false` would have to be
  // reset on every new hand, and forgetting that reset means the next result never appears.
  const [outcomeDismissed, setOutcomeDismissed] = useState<number | null>(null)

  // Render the HUMAN's view, never the raw state: a die hidden by the bot's Nero di
  // Seppia must be unreadable here too — including indirectly, via the "current hand"
  // badge, which would otherwise reveal the hidden face by naming the category.
  // BotAutoPlayer still receives the raw state; the bot filters its own view internally.
  const state = viewFor(trueState, 'human')

  // Derived rather than stored, so it cannot fall out of step with the phase: the result is on
  // screen when the hand has one to show and the player has not waved it away.
  const outcomeShowing =
    (state.phase === 'SHOWDOWN' ||
      state.phase === 'HAND_COMPLETE' ||
      state.phase === 'MATCH_OVER') &&
    state.lastShowdown !== null &&
    outcomeDismissed !== state.handNumber

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        color: '#e2e8f0',
        background: '#0f172a',
        // dvh, not vh: on mobile browsers `100vh` is the viewport with the URL bar RETRACTED, so
        // a 100vh page is taller than the screen and jumps as the bar hides and shows. The
        // dynamic unit tracks the actually-visible height. Unsupported units are ignored, and
        // on a min-height that degrades to "no minimum", which is harmless.
        minHeight: '100dvh',
      }}
    >
      {/*
        Two columns on a wide screen, stacked on a narrow one. `minmax(0, 720px)` lets the
        game column shrink below its content width instead of forcing a horizontal scroll,
        which a bare `720px` track would do on a tablet.

        On wide the grid is exactly viewport-tall and both columns STRETCH to fill it, so
        the table and the reference panels reach the bottom of the page instead of ending
        in dead space. On narrow it keeps its natural height — a fixed-height stack would
        squeeze the panels into unreadable slivers.
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: wide ? 'minmax(0, 720px) minmax(240px, 300px)' : 'minmax(0, 1fr)',
          gap: phone ? 14 : 24,
          alignItems: 'stretch',
          maxWidth: 1100,
          margin: '0 auto',
          // 24px of side padding is 13% of a 360px screen spent on nothing. Phones get 12.
          padding: phone ? '12px 12px 28px' : '1.5rem',
          // `box-sizing: border-box` so the padding sits INSIDE the 100vh rather than
          // adding to it — otherwise the page scrolls by exactly the padding.
          ...(wide ? { height: '100vh', boxSizing: 'border-box' as const } : null),
        }}
      >
        <main style={{ minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* On a phone the title is pure overhead above the game, so it shrinks rather than
              eating a fifth of the first screenful. */}
          <h1
            style={{
              marginTop: 0,
              fontSize: phone ? '1.5rem' : undefined,
              marginBottom: phone ? 12 : undefined,
            }}
          >
            Poker di Dadi{' '}
            {/*
              The level, on the title line rather than as a sixth ScoreBar stat: that strip
              already barely fits five on a phone (see its own comment). Shown at EVERY level
              including Normale — hiding the default would leave the player unsure the setting
              took at all, which is worse than one word of chrome.
            */}
            <span style={{ fontSize: phone ? 13 : 14, fontWeight: 400, color: '#94a3b8' }}>
              · {difficultyLabel(setup.difficulty)}
            </span>
          </h1>
          <ScoreBar state={state} />
          <BotAutoPlayer state={trueState} dispatch={dispatch} difficulty={setup.difficulty} />
          <Table state={state} dispatch={dispatch} grow={wide} />
          {/* Both banners are portalled overlays, so they render nothing here — they sit in this
              spot only because this is where the game they describe is. */}
          <PhaseBanner phase={state.phase} />
          <OutcomeBanner
            state={state}
            dispatch={dispatch}
            open={outcomeShowing}
            onDismiss={() => setOutcomeDismissed(state.handNumber)}
            onNewMatch={() => newMatch()}
            onRebuildDeck={onRebuild}
          />
          {/* `showTerminalButtons` is false while the result overlay is up, because the overlay
              carries those very buttons. Without it "Mano successiva" is on screen twice, and the
              copy down here is the one hidden behind the overlay. */}
          <Controls
            state={state}
            dispatch={dispatch}
            showTerminalButtons={!outcomeShowing}
            onNewMatch={() => newMatch()}
            onRebuildDeck={onRebuild}
          />
          <LastMove log={state.log} onOpenLog={() => setLogOpen(true)} />
        </main>
        {/* Reference column: your deck, the bot's deck, the hand ranking. */}
        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <ReferenceStack phone={phone}>
            <DeckPanel
              deck={deck}
              onRebuildDeck={onRebuild}
              matchInProgress={state.phase !== 'MATCH_OVER'}
            />
            <BotDeckPanel state={state} dispatch={dispatch} />
            {/* Takes the remaining height, so the sidebar does not end in dead space below the
                ranking ladder. */}
            <ReferencePanel state={state} grow={wide} />
          </ReferenceStack>
        </aside>
      </div>

      <LogDrawer log={state.log} open={logOpen} onClose={() => setLogOpen(false)} />
    </div>
  )
}
