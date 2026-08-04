// Public API of the pure rules engine.
// This module (and everything under src/engine) MUST NOT import from React/DOM/Vite,
// and MUST NOT use Date/window/Math.random. All randomness flows through an injected Rng.
//
// The state machine is split across several modules, but only game.ts is re-exported here: it
// re-exports the engine's whole public surface, which keeps the helpers the split had to make
// `export`ed (assert, commit, setHand, seatHolds, …) out of this barrel.

export * from './types'
export * from './rng'
export * from './hand'
export * from './abilities'
export * from './strategy'
export * from './deck'
export * from './optimal'
export * from './gameTypes'
export * from './actions'
export * from './game'
export * from './view'
// Before bot.ts, which consumes it: difficulty is the bot's configuration, not the reducer's.
export * from './difficulty'
export * from './bot'
