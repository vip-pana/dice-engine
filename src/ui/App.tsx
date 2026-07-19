import type { JSX } from 'react'

// Thin UI shell. No game rules live here — all logic comes from src/engine.
// Real UI lands in Step 6.
export function App(): JSX.Element {
  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>Poker di Dadi</h1>
      <p>Prototipo in costruzione. Il gioco arriva allo Step 6.</p>
    </main>
  )
}
