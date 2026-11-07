import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

let cached: string | null = null

/** Signing secret for sessions, iframe tokens and OAuth forms. NUXT_SESSION_SECRET wins; otherwise one is generated once and kept next to the database. */
export function authSecret(): string {
  if (cached) return cached
  const configured = useRuntimeConfig().sessionSecret as string
  if (configured) return (cached = configured)
  const dir = dirname(process.env.HUB_DB ?? '.data/hub.sqlite')
  const file = join(dir, 'auth-secret')
  mkdirSync(dir, { recursive: true })
  if (existsSync(file)) return (cached = readFileSync(file, 'utf8').trim())
  const fresh = randomBytes(32).toString('hex')
  writeFileSync(file, fresh, { mode: 0o600 })
  return (cached = fresh)
}
