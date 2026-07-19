import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Guards the core architectural invariant: src/engine must stay a PURE, portable rules
// engine — no imports from React/DOM/Vite/UI, and no hidden nondeterminism
// (Date/window/Math.random). All randomness must flow through the injected Rng.

const ENGINE_DIR = join(__dirname, '..', 'src', 'engine')

function engineFiles(): string[] {
  return readdirSync(ENGINE_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(ENGINE_DIR, f))
}

/** Patterns that must never appear in engine source (excluding comments/allowed uses). */
const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bMath\.random\b/, reason: 'randomness must go through the injected Rng' },
  // Match DOM-global usage (property/index access), not the English word "window".
  { pattern: /\bwindow[.[]/, reason: 'engine must not touch the DOM' },
  { pattern: /\bdocument[.[]/, reason: 'engine must not touch the DOM' },
  { pattern: /\bnew Date\b/, reason: 'engine must be deterministic (no wall clock)' },
  { pattern: /\bDate\.now\b/, reason: 'engine must be deterministic (no wall clock)' },
  { pattern: /from ['"]react/, reason: 'engine must not import React' },
  { pattern: /from ['"]\.\.\/ui/, reason: 'engine must not import from the UI' },
]

/** Strips line and block comments so we only scan real code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('engine purity', () => {
  it('has no forbidden globals or UI imports in any engine file', () => {
    const violations: string[] = []
    for (const file of engineFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'))
      for (const { pattern, reason } of FORBIDDEN) {
        if (pattern.test(code)) {
          violations.push(`${file}: matches ${pattern} — ${reason}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
