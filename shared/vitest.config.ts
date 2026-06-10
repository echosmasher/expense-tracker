import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only run source tests — dist/ contains compiled copies of the same files.
    include: ['src/**/*.test.ts'],
  },
})
