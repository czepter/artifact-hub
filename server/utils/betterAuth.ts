import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { getMigrations } from 'better-auth/db/migration'
import { passkey } from '@better-auth/passkey'
import { useDb, now } from './db'
import { authSecret } from './secret'
import { logEvent } from './events'

export type MemberRole = 'owner' | 'editor' | 'commenter'

function originOf(event: H3Event): string {
  const configured = useRuntimeConfig().baseUrl as string
  if (configured) return new URL(configured).origin
  return getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
}

function build(origin: string) {
  const c = useRuntimeConfig()
  const gh = c.github as { clientId?: string, clientSecret?: string }
  return betterAuth({
    appName: 'Artifact Hub',
    baseURL: origin,
    secret: authSecret(),
    database: useDb(),
    emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 10 },
    socialProviders: gh.clientId && gh.clientSecret ? { github: { clientId: gh.clientId, clientSecret: gh.clientSecret } } : {},
    user: { additionalFields: { role: { type: 'string', defaultValue: 'commenter', input: false } } },
    plugins: [passkey({ rpID: new URL(origin).hostname, rpName: 'Artifact Hub', origin })],
    databaseHooks: {
      user: {
        create: {
          // The first account is the owner; after that nobody signs up without an invitation for their e-mail.
          before: async (user) => {
            const db = useDb()
            const n = (db.prepare('SELECT COUNT(*) AS n FROM "user"').get() as { n: number }).n
            if (n === 0) return { data: { ...user, role: 'owner' } }
            const inv = db.prepare('SELECT role FROM invites WHERE lower(email) = lower(?) AND accepted_at IS NULL').get(user.email) as { role: MemberRole } | undefined
            if (!inv) throw new APIError('FORBIDDEN', { message: 'Sign-up is by invitation only.' })
            return { data: { ...user, role: inv.role } }
          },
          after: async (user) => {
            logEvent('joined', user.email, user.name || user.email)
            useDb().prepare('UPDATE invites SET accepted_at = ? WHERE lower(email) = lower(?) AND accepted_at IS NULL').run(now(), user.email)
          },
        },
      },
    },
  })
}

type Auth = ReturnType<typeof build>
const instances = new Map<string, Promise<Auth>>()

let schemaReady: Promise<void> | null = null

/** Creates better-auth's tables (user, session, account, passkey...) once. Runs at startup so a fresh database works before any request. */
export function ensureAuthSchema(): Promise<void> {
  return (schemaReady ??= (async () => {
    const { runMigrations } = await getMigrations(build('http://localhost').options)
    await runMigrations()
  })())
}

export function getAuth(event: H3Event): Promise<Auth> {
  const origin = originOf(event)
  let p = instances.get(origin)
  if (!p) {
    p = ensureAuthSchema().then(() => build(origin))
    instances.set(origin, p)
  }
  return p
}

export interface Member { id: string, email: string, name: string, role: MemberRole }

export function memberById(id: string): Member | null {
  const r = useDb().prepare('SELECT id, email, name, role FROM "user" WHERE id = ?').get(id) as Member | undefined
  return r ?? null
}

export function memberCount(): number {
  return (useDb().prepare('SELECT COUNT(*) AS n FROM "user"').get() as { n: number }).n
}

export async function memberFromSession(event: H3Event): Promise<Member | null> {
  if (!getHeader(event, 'cookie')) return null
  const auth = await getAuth(event)
  const s = await auth.api.getSession({ headers: new Headers(getRequestHeaders(event) as Record<string, string>) })
  return s ? memberById(s.user.id) : null
}

// ---- development login --------------------------------------------------------------------------
// Only in `nuxt dev`, and only when NUXT_DEV_LOGIN_EMAIL is set. A production build compiles this
// away (import.meta.dev is false) and refuses to start if the variables are present (see plugins/dev-guard).

export const devLoginEnabled = () => import.meta.dev && process.env.NODE_ENV !== 'production' && !!process.env.NUXT_DEV_LOGIN_EMAIL

const devPassword = () => createHash('sha256').update('dev-login:' + authSecret()).digest('hex')

export async function devMember(event: H3Event): Promise<Member | null> {
  if (!devLoginEnabled()) return null
  const email = process.env.NUXT_DEV_LOGIN_EMAIL!.toLowerCase()
  const auth = await getAuth(event)
  const db = useDb()
  let row = db.prepare('SELECT id FROM "user" WHERE lower(email) = ?').get(email) as { id: string } | undefined
  if (!row) {
    if (memberCount() > 0) {
      db.prepare('INSERT INTO invites (id, email, role, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), email, 'editor', crypto.randomUUID(), 'dev-login', now())
    }
    await auth.api.signUpEmail({ body: { email, password: devPassword(), name: 'Dev' } })
    row = db.prepare('SELECT id FROM "user" WHERE lower(email) = ?').get(email) as { id: string }
  }
  return memberById(row.id)
}

/** Signs the dev member in and forwards the session cookie to the browser. */
export async function devSignIn(event: H3Event): Promise<Member | null> {
  const m = await devMember(event)
  if (!m) return null
  const auth = await getAuth(event)
  const res = await auth.api.signInEmail({ body: { email: m.email, password: devPassword() }, asResponse: true })
  for (const c of res.headers.getSetCookie()) appendResponseHeader(event, 'set-cookie', c)
  return m
}
