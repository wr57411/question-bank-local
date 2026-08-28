import { defineConfig } from 'vitest/config'
import { readFileSync, existsSync } from 'fs'

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const k = t.substring(0, i).trim()
    const v = t.substring(i + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['unit-tests/**/*.spec.{js,ts}'],
    globals: true,
    testTimeout: 180000,
  },
})
