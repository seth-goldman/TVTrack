import { defineConfig } from 'vitest/config'

// Only the pure logic modules are unit-tested; the UI is verified by running
// the app. Keeping the environment on 'node' keeps the suite fast.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
