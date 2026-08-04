import { useEffect, useRef, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { AbilityId, GameState } from '../../engine'
import { useIsPhone, usePrefersReducedMotion } from '../responsive'
import {
  heldActionableAbilities,
  usableAbilities,
  type ActionableAbilityId,
  type UseGameDispatch,
} from '../handState'
import { AbilityRow } from './rows/AbilityRow'

/** What the modal is showing: closed, the list, or the list with one row opened. */
export type AbilityFocus = ActionableAbilityId | 'list' | null

/**
 * One place to use an ability, instead of five.
 *
 * Every ability used to be somewhere else — the Torpedo aimed by clicking a Bot die, the Spugna a
 * row of cards under your own, Mulinello and Paguro buttons in the controls, the Lanterna in the
 * sidebar. With a hand holding several at once that reads as "I can do too many things and I am
 * not sure which of them I just did".
 *
 * IT STAGES, IT DOES NOT SUBMIT — for the two that ride on the reroll. Torpedo and Spugna are
 * optional FIELDS on the single REROLL action that also carries the dice to throw (see
 * RerollAction), so there is no "use torpedo" to dispatch: the modal picks the values, they stay
 * visible on the felt, and "Conferma rilancio" sends one action with everything. Mulinello,
 * Paguro and the Lanterna do have actions of their own and dispatch from here directly.
 */
export function AbilityModal({
  state,
  dispatch,
  focus,
  onFocus,
  onClose,
  torpedoTarget,
  onAimTorpedo,
  spongeTarget,
  onSponge,
}: {
  state: GameState
  dispatch: UseGameDispatch
  focus: AbilityFocus
  onFocus: (focus: AbilityFocus) => void
  onClose: () => void
  torpedoTarget: number | null
  onAimTorpedo: (index: number) => void
  spongeTarget: AbilityId | null
  onSponge: (ability: AbilityId | null) => void
}): JSX.Element | null {
  const phone = useIsPhone()
  const reducedMotion = usePrefersReducedMotion()
  const closeRef = useRef<HTMLButtonElement>(null)
  const open = focus !== null

  // Focus lands on the close button, so a keyboard user has somewhere to be inside the dialog
  // rather than still standing on the page behind it.
  useEffect(() => {
    if (open) {
      closeRef.current?.focus()
    }
  }, [open])

  // Escape closes, registered only while open — the same shape as LogDrawer's.
  useEffect(() => {
    if (!open) {
      return
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) {
    return null
  }

  const held = heldActionableAbilities(state)
  const usable = usableAbilities(held)

  return createPortal(
    // The scrim, which is ALSO the centring container.
    //
    // A flex parent rather than `top/left: 50%` with `translate(-50%, -50%)` on the sheet: with a
    // maxHeight and a scrolling body, the transform centres the sheet's UNCONSTRAINED height, so a
    // tall list ends up pushed off to one side and clipped at the bottom. Flex centres what is
    // actually rendered. The target check is what keeps a click INSIDE the sheet from closing it.
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#020617cc',
        display: 'flex',
        // Bottom sheet on a phone, centred sheet on a desktop.
        alignItems: phone ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: phone ? 0 : 16,
        // Above the outcome banner (160), below the log drawer (200): the drawer opens on top of
        // whatever you were doing, by design, and consulting the log from in here has to work.
        zIndex: 180,
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Le tue abilità"
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          background: '#0b1220',
          border: '1px solid #1e293b',
          boxShadow: '0 24px 60px #020617cc',
          // It has to hold five cards plus a 12-die deck preview, so it is tall either way and the
          // body scrolls inside rather than the sheet growing past the viewport.
          ...(phone
            ? { width: '100%', maxHeight: '88vh', borderRadius: '14px 14px 0 0' }
            : { width: 'min(92vw, 520px)', maxHeight: '86vh', borderRadius: 14 }),
          // phaseIn, not drawerIn: this arrives toward the reader rather than sliding in from an
          // edge, which is what a centred sheet should do.
          animation: reducedMotion ? undefined : 'phaseIn 180ms ease-out',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 16px',
            borderBottom: '1px solid #1e293b',
            flexShrink: 0,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
            Le tue abilità
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Chiudi le abilità"
            style={{
              minWidth: 44,
              minHeight: 44,
              borderRadius: 8,
              border: '1px solid #334155',
              background: 'transparent',
              color: '#94a3b8',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </header>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '12px 14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {held.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
              In questa mano non hai dadi con un'abilità da usare. Gli altri speciali agiscono da
              soli: passa il mouse su un dado per sapere cosa fa.
            </p>
          ) : (
            <>
              {usable.length === 0 && (
                <p style={{ margin: 0, fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                  Nessuna di queste è usabile in questo momento — sotto c'è il perché.
                </p>
              )}
              {held.map((ability) => (
                <AbilityRow
                  key={ability.id}
                  ability={ability}
                  state={state}
                  dispatch={dispatch}
                  focused={focus === ability.id}
                  onFocus={() => onFocus(focus === ability.id ? 'list' : ability.id)}
                  onClose={onClose}
                  torpedoTarget={torpedoTarget}
                  onAimTorpedo={onAimTorpedo}
                  spongeTarget={spongeTarget}
                  onSponge={onSponge}
                />
              ))}
            </>
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}
