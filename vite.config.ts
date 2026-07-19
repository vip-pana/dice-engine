/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// UI dev server / build config. The engine (src/engine) never imports from here.
export default defineConfig({
  plugins: [react()],
  test: {
    // Vitest picks up *.test.ts under tests/ and src/.
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
