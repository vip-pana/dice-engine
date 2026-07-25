// Public API of the pure rules engine.
// This module (and everything under src/engine) MUST NOT import from React/DOM/Vite,
// and MUST NOT use Date/window/Math.random. All randomness flows through an injected Rng.
// Game state machine (game.ts) and bot (bot.ts) are added in later steps.

export * from './types'
export * from './rng'
export * from './hand'
export * from './abilities'
export * from './strategy'
export * from './optimal'
export * from './gameTypes'
export * from './actions'
export * from './game'
export * from './view'
export * from './bot'
