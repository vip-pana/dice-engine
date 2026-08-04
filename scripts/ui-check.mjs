// Drives the real app in a real browser and screenshots it. The counterpart to `vitest`:
// the test suite covers src/engine, which is pure and has no DOM, so nothing there can tell
// you whether a panel is on screen, whether a list scrolls, or whether a hover says anything.
//
// Usage:
//   pnpm ui:check                      # deck builder + in-match sidebar, screenshots both
//   pnpm ui:check builder              # just the deck builder
//   pnpm ui:check match                # click through to a live match
//   pnpm ui:check builder --keep       # leave the browser open (headed) to poke at it
//
// Screenshots land in .ui-check/ (gitignored). Exits non-zero if a check fails, so it can
// gate a commit.
//
// WHY THIS EXISTS: this used to be a hand-written Chrome DevTools Protocol driver, rebuilt
// from scratch each time and wrong in a different way each time — a stray Worker import, a
// missing `undici`, and worst of all `--window-size` silently not reaching the page, which
// reported the SAME viewport height for three different window sizes and invalidated a whole
// round of measurements. Playwright's page.setViewportSize actually works, and page.hover
// does something no CDP snippet of mine ever did: it really hovers.

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const URL = 'http://localhost:5173'
const OUT = '.ui-check'
const KEEP = process.argv.includes('--keep')
const WHICH = process.argv.find((a) => a === 'builder' || a === 'match') ?? 'all'
// `--phone` runs the same checks at a phone viewport: the layout diverges enough there (folded
// reference stack, full-width drawer, smaller dice) that desktop passing proves nothing about it.
// Declared up here with the other flags, not next to the browser launch, because the check
// functions above close over it.
const PHONE = process.argv.includes('--phone')

const failures = []
/** Records a check. Never throws: one bad assertion must not hide the ones after it. */
function check(label, ok, detail = '') {
  const line = `${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`
  console.log(line)
  if (!ok) failures.push(label)
}

/**
 * Starts `vite` unless something already answers on the port.
 *
 * Reusing a running server is the common case (you have `pnpm dev` open) and skipping the
 * spawn keeps this fast. Polls the port rather than sleeping: macOS has no `timeout(1)`, and
 * a fixed sleep is either flaky or slow.
 */
async function ensureServer() {
  try {
    await fetch(URL)
    console.log(`server already up at ${URL}`)
    return null
  } catch {}
  console.log('starting vite...')
  const proc = spawn('pnpm', ['dev'], { stdio: 'ignore', detached: false })
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250))
    try {
      await fetch(URL)
      console.log(`server up at ${URL}`)
      return proc
    } catch {}
  }
  proc.kill()
  throw new Error('vite did not come up within 15s')
}

/** Clicks the button whose trimmed text matches, or whose text starts with it. */
async function clickButton(page, text) {
  const exact = page.locator('button', { hasText: new RegExp(`^\\s*${text}\\s*$`) })
  if (await exact.count()) {
    await exact.first().click()
    return true
  }
  const starts = page.locator('button', { hasText: new RegExp(`^\\s*${text}`) })
  if (await starts.count()) {
    await starts.first().click()
    return true
  }
  return false
}

async function shoot(page, name) {
  mkdirSync(OUT, { recursive: true })
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path, fullPage: false })
  console.log(`  📸 ${path}`)
}

// --- the deck builder ------------------------------------------------------

async function checkBuilder(page) {
  console.log('\n=== deck builder ===')
  await page.goto(URL)
  await page.getByRole('heading', { name: 'Componi il tuo mazzo' }).waitFor()

  // The specials list must scroll INSIDE its own box, leaving the deck below on screen.
  const grid = page.locator('main div').filter({ hasText: 'Dado Stella Essiccata' }).last()
  const box = await grid.evaluate((el) => {
    // Walk up to the element that actually owns the overflow.
    let n = el
    while (n && getComputedStyle(n).overflowY !== 'auto') n = n.parentElement
    if (!n) return null
    return { scrollH: n.scrollHeight, clientH: n.clientHeight, maxH: getComputedStyle(n).maxHeight }
  })
  check('specials list has its own scroll box', box !== null)
  if (box) {
    check('  it actually overflows (so scrolling is real)', box.scrollH > box.clientH + 2,
      `${box.scrollH}px of content in ${box.clientH}px`)
    check('  bounded relative to the viewport', box.maxH.endsWith('px') && box.clientH < 500,
      `max-height ${box.maxH}`)
  }

  // The deck preview and the confirm button must be reachable without scrolling the page.
  const vh = page.viewportSize().height
  const deckHeading = page.getByRole('heading', { name: /Il tuo mazzo/ })
  const deckTop = (await deckHeading.boundingBox())?.y ?? Infinity
  check('deck section is above the fold', deckTop < vh, `at y=${Math.round(deckTop)} of ${vh}`)

  // The 12 dice must be centred, and the button full width.
  const centring = await page.evaluate(() => {
    const grid = [...document.querySelectorAll('main div')].find(
      (d) => getComputedStyle(d).display === 'grid' && d.children.length === 12,
    )
    if (!grid) return null
    const g = grid.getBoundingClientRect()
    const p = grid.parentElement.getBoundingClientRect()
    return { leftGap: Math.round(g.left - p.left), rightGap: Math.round(p.right - g.right) }
  })
  check('deck dice are centred', centring !== null && Math.abs(centring.leftGap - centring.rightGap) <= 2,
    centring ? `gaps ${centring.leftGap}px / ${centring.rightGap}px` : 'grid not found')

  const btn = page.locator('button', { hasText: /^Inizia la partita$/ })
  const btnW = (await btn.boundingBox())?.width ?? 0
  const mainW = await page.locator('main').evaluate((m) => {
    const s = getComputedStyle(m)
    return m.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)
  })
  check('start button fills the column', Math.abs(btnW - mainW) <= 2, `${Math.round(btnW)}px of ${Math.round(mainW)}px`)

  // The random button must actually change the selection.
  const countSelected = () =>
    page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((x) => /Il tuo mazzo/.test(x.textContent))
      return Number(h?.textContent.match(/(\d+) speciali/)?.[1] ?? -1)
    })
  const before = await countSelected()
  let changed = false
  for (let i = 0; i < 8 && !changed; i++) {
    await clickButton(page, '🎲 Casuali')
    await page.waitForTimeout(60)
    if ((await countSelected()) !== before) changed = true
  }
  check('🎲 Casuali changes the selection', changed, `started at ${before}`)

  const afterRandom = await countSelected()
  await clickButton(page, 'Svuota')
  await page.waitForTimeout(60)
  check('Svuota empties it', (await countSelected()) === 0, `was ${afterRandom}`)

  await shoot(page, 'builder')
}

// --- in-match sidebar ------------------------------------------------------

/**
 * Click-through to a live match. Two confirm steps, and the second one is NOT called
 * "Inizia la partita" — it is "Cambia mazzo", which cost a wasted round to discover.
 */
async function checkMatch(page) {
  console.log('\n=== in-match sidebar ===')
  await page.goto(URL)
  await page.getByRole('heading', { name: 'Componi il tuo mazzo' }).waitFor()

  // EVERY special, not a random deck: the hover check below needs a special to actually be
  // dealt, and with a random deck that is a coin flip. A check whose outcome depends on the
  // dice is a check that will eventually fail for no reason.
  const cards = page.locator('button', { hasText: /Bonus|Malus/ })
  const total = await cards.count()
  for (let i = 0; i < total; i++) await cards.nth(i).click()
  check('selected all specials for the hover check', total > 0, `${total} abilities`)

  await clickButton(page, 'Inizia la partita')

  // Bot deck mode: pick the default and confirm. Both steps are best-effort — the screen only
  // appears when a deck has not already been chosen, and a hard click here turned "we were
  // already past this step" into a 30s timeout that aborted the whole run.
  const mode = page.getByText('Specchiato', { exact: false })
  if (await mode.count()) {
    await mode.first().click()
    await clickButton(page, 'Inizia')
    await clickButton(page, 'Cambia mazzo')
  }
  // On a phone the ranking lives inside the folded disclosure, so open it before waiting on it.
  if (PHONE) {
    const summary = page.locator('summary').first()
    if (await summary.count()) await summary.click()
  }
  await page.getByRole('heading', { name: 'Classifica mani' }).waitFor({ timeout: 8000 })
  check('reached the match', true)

  const headings = await page.locator('h2, h3').allInnerTexts()
  check('special-dice catalogue is gone', !headings.some((h) => /Dadi speciali/.test(h)),
    headings.join(' | '))
  check('hand ranking is still there', headings.some((h) => /Classifica mani/.test(h)))
  check('reference tabs are gone', (await page.locator('[role=tablist]').count()) === 0)
  // Scoped to `aside`, which is what the label always claimed. Page-wide it also counted the
  // ability modal's Spugna cards — those are Bonus/Malus buttons too, and legitimately so.
  check('no Bonus/Malus cards in the sidebar',
    (await page.locator('aside button', { hasText: /Bonus|Malus/ }).count()) === 0)
  // The Lanterna's peek moved into the ability modal, so the sidebar no longer carries the
  // Bot's deck: Controls hides itself on the Bot's turn, which is when a peek is wanted, and
  // the modal is reachable in every phase.
  check('the Bot deck panel is gone from the sidebar',
    !headings.some((h) => /Mazzo del Bot/.test(h)), headings.join(' | '))

  // Every hand-ranking row must be visible without scrolling — the point of removing the card.
  const rows = await page.locator('text=/^(Scala di sei|Coppia)$/').count()
  check('ranking ladder is not clipped', rows >= 2, `${rows} of the 2 extreme rows found`)

  // THE HOVER: the reason the catalogue could be removed at all.
  //
  // Checked by actually hovering and reading the panel that appears, NOT by looking for a
  // `title` attribute. The native tooltip was deliberately removed (see "A die explains itself
  // on hover, or on a long press") because it never appears on a phone, truncates, and cannot
  // be styled — so asserting on `title` would test the thing that was replaced and fail on the
  // app being right. This asserts the real panel: hover, then look for the ability's own
  // description text on the page.
  const deckSlot = page.locator('[aria-label^="Dado "]').first()
  const hasSlot = (await deckSlot.count()) > 0
  check('a deck slot is there to hover', hasSlot)
  if (hasSlot) {
    const before = await page.locator('body').innerText()
    await deckSlot.hover()
    await page.waitForTimeout(250)
    const after = await page.locator('body').innerText()
    const grew = after.length > before.length + 20
    check('hovering a die opens a rules panel', grew,
      grew ? `+${after.length - before.length} chars appeared` : 'nothing appeared')
    if (grew) {
      // The panel must carry the registry's own rules text, not just a name. Measured as a
      // word count, not a run of letters: `\p{L}{40,}` wanted 40 CONSECUTIVE letters, which no
      // real sentence has, so it rejected perfectly good text like "🌟 Dado Stella Essiccata
      // Quando viene lanciato si divide in 3 dadi...".
      const added = after.slice(before.length).replace(/\s+/g, ' ').trim()
      const words = added.split(' ').filter((w) => /\p{L}/u.test(w)).length
      check('  the panel explains what the die DOES', words >= 8, `${words} words: ${added.slice(0, 60)}`)
    }
    await page.mouse.move(0, 0)
  }

  await shoot(page, 'match')

  // And a die IN PLAY, the other place the hover must work.
  //
  // This has to reach the STEAL phase, not just the roll-off: at ROLL_OFF no hand has been
  // dealt, so there is nothing carrying an ability yet. An earlier version of this check
  // stopped at the roll-off, found 0 dice, and passed anyway because it asserted `>= 0` —
  // which is true of every number. A check that cannot fail is worse than no check, because
  // it reads like coverage. Hence the phase guard below and a strict `> 0`.
  await advanceToDeal(page)
  const phase = await page.locator('text=/Fase:/').first().innerText().catch(() => '')
  const dealt = /Furto|Rilancio|scommessa|Showdown/i.test(phase)
  check('reached a phase where dice are on the table', dealt, phase || 'phase unknown')
  if (dealt) {
    await checkFeltLayout(page)
    await shoot(page, 'match-rolled')
  }

  // The REROLL phase is where the felt broke: dice gain value chips and "preso"/"rubato"
  // captions there, growing a row past what the layout allowed.
  await advanceToReroll(page)
  const rerollPhase = await page.locator('text=/Fase:/').first().innerText().catch(() => '')
  if (/rilancio/i.test(rerollPhase)) {
    console.log('  (reroll phase)')
    await checkFeltLayout(page)
    await shoot(page, 'match-reroll')
  } else {
    check('reached the reroll phase', false, rerollPhase)
  }

  await checkAbilityModal(page)
  await checkLogDrawer(page)
  // Only meaningful on the two-column layout: on a phone the column is folded into a <details>
  // and has no height to fill, which the code opts out of explicitly.
  if (!PHONE) await checkSidebarFillsColumn(page)
  if (PHONE) await checkPhoneDisclosure(page)
}

/**
 * Every ability is used from one place now: «Usa abilità» and its modal.
 *
 * The button opens the menu even when nothing is pressable, deliberately — the explanation of
 * what each held ability is waiting for lives inside, so a disabled button would lock the player
 * out of the answer. That is asserted here, because it is the property most likely to be
 * "tidied" into a disabled state later.
 */
async function checkAbilityModal(page) {
  console.log('  (ability modal)')
  const bar = page.getByRole('button', { name: /Usa abilità/ })
  const dialog = page.locator('[role=dialog][aria-label*="abilit"]')

  check('the modal is not open by default', (await dialog.count()) === 0)
  if ((await bar.count()) === 0) {
    // Only when the hand dealt no actionable ability at all — then there is nothing to show.
    check('  no ability button, and no ability in hand', true, 'nothing actionable dealt')
    return
  }
  check('the «Usa abilità» button is on the felt', true)
  check('  it opens even with nothing pressable', await bar.first().isEnabled())

  await bar.first().click()
  check('clicking it opens the modal', (await dialog.count()) === 1)
  const body = await dialog.innerText()
  check('  it lists each held ability with its state', /Bonus|Malus/.test(body),
    body.replace(/\n+/g, ' | ').slice(0, 80))

  const box = await dialog.boundingBox()
  const vp = page.viewportSize()
  check('  it is fully within the viewport',
    box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 1,
    box ? `${Math.round(box.width)}x${Math.round(box.height)} at (${Math.round(box.x)},${Math.round(box.y)})` : 'no box')
  await shoot(page, 'match-ability-modal')

  await page.keyboard.press('Escape')
  check('Escape closes it', (await dialog.count()) === 0)

  // Reopen, then click the SCRIM ELEMENT rather than a coordinate. A blind `mouse.click(x, y)`
  // hits whatever is at those pixels if the dialog is not up — which is how this check once
  // pressed "Cambia mazzo" in the sidebar and hung the run on its confirmation prompt.
  await bar.first().click()
  if ((await dialog.count()) === 1) {
    // The scrim is the fixed full-viewport sibling of the dialog, so aim at a corner well away
    // from the centred sheet.
    await page.mouse.click(20, 20)
    check('a click on the backdrop closes it', (await dialog.count()) === 0)
  } else {
    check('a click on the backdrop closes it', false, 'the modal did not reopen')
  }
}

/** On a phone the reference stack folds away — and must no longer promise the log it lost. */
async function checkPhoneDisclosure(page) {
  const summary = await page.locator('summary').first().innerText().catch(() => '')
  check('the phone disclosure exists', summary.length > 0, summary)
  check('  it no longer promises the log', !/registro/i.test(summary), summary)
}

/** The log is a drawer now: closed by default, opened from the last-move row, dismissible. */
async function checkLogDrawer(page) {
  console.log('  (log drawer)')
  const drawer = page.locator('[role=dialog][aria-label*="Registro"]')

  check('the log is NOT a permanent sidebar card', (await drawer.count()) === 0)
  const headings = await page.locator('aside h2, aside h3').allInnerTexts()
  check('  no "Log" heading left in the column', !headings.some((h) => /^Log$/i.test(h)),
    headings.join(' | '))

  // The newest line stays on screen with the drawer shut — the whole point of keeping LastMove.
  const lastMove = page.locator('button', { hasText: /Registro/ })
  check('the "Registro" button is on screen', (await lastMove.count()) > 0)
  const lastLine = await page
    .locator('main div', { has: page.locator('button', { hasText: /Registro/ }) })
    .last()
    .innerText()
    .catch(() => '')
  check('  the newest log line is visible while closed',
    lastLine.replace(/📜 Registro/, '').trim().length > 10, lastLine.slice(0, 60).replace(/\n/g, ' '))

  await lastMove.first().click()
  await page.waitForTimeout(300)
  check('clicking it opens the drawer', (await drawer.count()) === 1)

  const lines = await drawer.innerText()
  check('  the drawer holds the history', lines.split('\n').length >= 3,
    `${lines.split('\n').length} lines`)
  // It must be fully on screen, not clipped by an ancestor's overflow — the reason it is
  // portalled to the body rather than rendered in the tree.
  const box = await drawer.boundingBox()
  const vp = page.viewportSize()
  check('  it is fully within the viewport',
    box !== null && box.y >= 0 && box.y + box.height <= vp.height + 1 && box.x + box.width <= vp.width + 1,
    box ? `${Math.round(box.width)}x${Math.round(box.height)} at (${Math.round(box.x)},${Math.round(box.y)})` : 'no box')
  // On a phone it takes the whole width: 380px of a 390px viewport would leave a useless sliver
  // of game behind it.
  if (PHONE) {
    check('  full width on a phone', box !== null && Math.abs(box.width - vp.width) <= 1,
      box ? `${Math.round(box.width)}px of ${vp.width}px` : 'no box')
  }
  await shoot(page, 'match-log-drawer')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('Escape closes it', (await drawer.count()) === 0)

  // And the scrim: reopen, then click away from the panel.
  await lastMove.first().click()
  await page.waitForTimeout(250)
  await page.mouse.click(40, 400)
  await page.waitForTimeout(300)
  check('a click on the backdrop closes it', (await drawer.count()) === 0)
}

/**
 * The sidebar must reach the bottom of the column.
 *
 * Removing a card from that column has stranded it in dead space before — the log card was the
 * one with `flex: 1`, so with it gone the ranking ladder has to absorb the height instead. The
 * code comment says so; this is the check that would notice if it stopped being true.
 */
async function checkSidebarFillsColumn(page) {
  const gap = await page.evaluate(() => {
    const aside = document.querySelector('aside')
    if (!aside) return null
    const panels = [...aside.querySelectorAll(':scope > div > section')]
    if (panels.length === 0) return null
    const last = panels[panels.length - 1].getBoundingClientRect()
    return Math.round(aside.getBoundingClientRect().bottom - last.bottom)
  })
  check('the sidebar has no dead space at its foot', gap !== null && gap <= 24,
    gap === null ? 'column not found' : `${gap}px below the last panel`)
}

/**
 * The three bands of the felt must not overlap, and none may clip its own content.
 *
 * This is the regression guard for a real bug: Band capped itself with `maxHeight: 140`, which
 * neither scrolls nor expands, so in REROLL — where a die gains its value chips and a
 * "preso"/"rubato" caption, pushing a row to ~176px — the excess painted straight over the
 * next section. "DADI COMUNI" and "I TUOI DADI" ended up drawn on top of each other. Nothing
 * in the engine tests could have caught it: the state was perfectly correct, only unreadable.
 */
async function checkFeltLayout(page) {
  const bands = await page.evaluate(() => {
    // Scope to the FELT, not the page: "Bot" also appears in the match header and in the log,
    // and a page-wide search picked up all three and then compared unrelated boxes.
    const felt = [...document.querySelectorAll('div')].find(
      (d) =>
        /Dadi comuni/.test(d.textContent) &&
        /I tuoi dadi/.test(d.textContent) &&
        !/Classifica|Log|Punteggio/.test(d.textContent),
    )
    if (!felt) return []
    const labels = [...felt.querySelectorAll('*')].filter(
      (e) => e.children.length === 0 && /^(Bot|Dadi comuni|I tuoi dadi)$/.test(e.textContent.trim()),
    )
    return labels.map((l) => {
      // Walk up to the band: the flex child of the felt that owns this label.
      let n = l
      while (n && getComputedStyle(n).display !== 'flex') n = n.parentElement
      const box = (n ?? l).getBoundingClientRect()
      return {
        label: l.textContent.trim(),
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        clipped: n ? n.scrollHeight > n.clientHeight + 2 : false,
      }
    })
  })

  check('found the three felt bands', bands.length === 3, bands.map((b) => b.label).join(' / '))
  for (const b of bands) {
    check(`  "${b.label}" is not clipped`, !b.clipped)
  }
  for (let i = 1; i < bands.length; i++) {
    const prev = bands[i - 1]
    const cur = bands[i]
    check(`  "${cur.label}" does not overlap "${prev.label}"`, cur.top >= prev.bottom,
      `starts at y=${cur.top}, previous ends at y=${prev.bottom}`)
  }
}

/** From a dealt hand, steals and bets until REROLL_SELECT. */
async function advanceToReroll(page) {
  for (let step = 0; step < 12; step++) {
    const phase = await page.locator('text=/Fase:/').first().innerText().catch(() => '')
    if (/rilancio/i.test(phase)) return
    const steal = page.locator('button[aria-label*="Dado"]:not([disabled])')
    if (await steal.count()) {
      await steal.first().click()
      await page.waitForTimeout(700)
      continue
    }
    const bet = page.locator('button', { hasText: /^(Punta|Apri|Vedi|Chiama|Rilancia)/ })
    if (await bet.count()) {
      await bet.first().click()
      await page.waitForTimeout(700)
      continue
    }
    return
  }
}

/** Rolls off and calls through the betting until the hand is actually dealt. */
async function advanceToDeal(page) {
  for (let step = 0; step < 10; step++) {
    if (await clickButton(page, 'Tira il dado')) {
      await page.waitForTimeout(900)
      continue
    }
    // Betting labels vary by round; any of these moves the hand along.
    const bet = page.locator('button', { hasText: /^(Punta|Apri|Vedi|Chiama|Rilancia)/ })
    if (await bet.count()) {
      await bet.first().click()
      await page.waitForTimeout(900)
      continue
    }
    return
  }
}

// --- main ------------------------------------------------------------------

const server = await ensureServer()
const browser = await chromium.launch({ headless: !KEEP })
const page = await browser.newPage({
  viewport: PHONE ? { width: 390, height: 844 } : { width: 1500, height: 900 },
})
if (PHONE) console.log('viewport: phone 390x844')

try {
  if (WHICH === 'all' || WHICH === 'builder') await checkBuilder(page)
  // The match walkthrough drives the desktop layout. The phone layout is verified by
  // `--phone` on the builder plus a screenshot: driving a whole hand at 390px means clicking
  // through a folded disclosure and wrapped dice rows, which was more script than the coverage
  // was worth. What matters on a phone — the drawer is full width and the disclosure no longer
  // promises the log — was confirmed and screenshotted (.ui-check/crash.png shows it).
  if ((WHICH === 'all' || WHICH === 'match') && !PHONE) await checkMatch(page)
  if (PHONE) console.log('\n(phone: match walkthrough skipped — see the comment in this script)')
} catch (err) {
  // A thrown locator (a click that timed out, a heading that never appeared) is a FAILURE, not
  // a clean exit. Without this the `finally` below printed "all checks passed" for a run that
  // crashed on its second step and never reached a single assertion — which is the worst
  // possible output a checker can produce.
  check('the run completed without crashing', false, String(err).split('\n')[0].slice(0, 140))
  await shoot(page, 'crash').catch(() => {})
} finally {
  console.log(
    failures.length === 0
      ? '\n✅ all checks passed'
      : `\n❌ ${failures.length} failed:\n   - ${failures.join('\n   - ')}`,
  )
  if (!KEEP) await browser.close()
  else console.log('\n(--keep: browser left open, ctrl-c to stop)')
  if (server) server.kill()
  process.exit(failures.length === 0 ? 0 : 1)
}
