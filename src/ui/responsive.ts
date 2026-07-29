// Viewport breakpoints, as hooks.
//
// This app styles everything inline, so breakpoints go through matchMedia in JS rather than a
// stylesheet — adding a CSS file for them would split where layout lives. That convention
// predates this module; what it adds is a SECOND breakpoint below the existing one.
//
// Why two and not one: with only `useIsWide` a 320px phone and a 1023px tablet rendered
// byte-identical layout, so every phone got a layout sized for a tablet. The concrete symptom
// was not a squashed column but a ZOOMED-OUT PAGE: content that cannot shrink below its
// intrinsic width (the deck grid's six fixed 52px slots came to 362px) is wider than a small
// phone, and a mobile browser resolves that by widening the layout viewport and scaling
// everything down — `window.innerWidth` reported 386 on a 320px device. Phone-specific sizing
// is what keeps the intrinsic width under the real viewport, which is the only thing that
// stops the zoom-out.

import { useEffect, useState } from 'react'

/** Breakpoint below which the sidebar stacks under the game instead of sitting beside it. */
export const WIDE_BREAKPOINT = 1024

/**
 * Breakpoint at or below which we render the phone layout: smaller dice, wrapping rows,
 * tighter page padding, full-width buttons, and the reference panels behind a disclosure.
 *
 * 600px rather than something narrower so small tablets in portrait get it too — they have the
 * same problem for the same reason, and a layout that only fixes 375px would leave 540px broken.
 */
export const PHONE_BREAKPOINT = 600

/** Subscribes to a media query. Re-reads on mount so SSR/hydration mismatches settle. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent): void => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** Whether the viewport is wide enough for the two-column game + sidebar layout. */
export function useIsWide(): boolean {
  return useMediaQuery(`(min-width: ${WIDE_BREAKPOINT}px)`)
}

/** Whether we are on a phone-sized viewport and should render the compact layout. */
export function useIsPhone(): boolean {
  return useMediaQuery(`(max-width: ${PHONE_BREAKPOINT - 1}px)`)
}

/**
 * Edge of a die, in px, per layout.
 *
 * Sized so a whole row fits a small phone without wrapping: five dice plus four 8px gaps is
 * 5*44 + 32 = 252px, inside the ~264px a 320px viewport leaves once page and panel padding are
 * taken out. At 52px the same row needs 308px and cannot fit, which is what forced the
 * zoom-out. 44 is also exactly the minimum comfortable touch target, so the dice stay tappable
 * during the steal and the reroll selection.
 */
export const DIE_SIZE = { phone: 44, default: 52 } as const
