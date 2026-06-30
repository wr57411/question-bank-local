import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['unit-tests/**/*.spec.js'],
    globals: true,
  },
})
