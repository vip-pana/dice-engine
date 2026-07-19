/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// UI dev server / build config. The engine (src/engine) never imports from here.
//
// `base` is set to the GitHub Pages project path only for production builds, so assets
// resolve under https://<user>.github.io/dice-engine/. The dev server stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/dice-engine/' : '/',
  plugins: [react()],
  test: {
    // Vitest picks up *.test.ts under tests/ and src/.
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
}))
