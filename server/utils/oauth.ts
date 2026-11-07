import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { useDb } from './db'
import { authSecret } from './secret'
import { memberById, type Member, type MemberRole } from './betterAuth'

export const SCOPES = ['read', 'comment', 'write', 'share'] as const
export type Scope = typeof SCOPES[number]
export const SCOPE = 'read comment write share'
/** What a member's role allows a grant to carry. Commenters can never publish or share. */
export const ROLE_SCOPES: Record<MemberRole, Scope[]> = { owner: [...SCOPES], editor: [...SCOPES], commenter: ['read', 'comment'] }
export const parseScopes = (s: string | null | undefined): Scope[] => (s ?? '').split(' ').filter((x): x is Scope => (SCOPES as readonly string[]).includes(x))
const CODE_TTL_S = 120
const ACCESS_TTL_S = 3600
const REFRESH_TTL_S = 30 * 24 * 3600
const MAX_CLIENTS = 500

const nowS = () => Math.floor(Date.now() / 1000)
export const sha256 = (v: string) => createHash('sha256').update(v).digest('base64url')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

/** Public base URL. Set NUXT_BASE_URL behind a proxy; otherwise derive it from the request. */
export function baseUrl(event: H3Event): string {
  const configured = useRuntimeConfig().baseUrl as string
  if (configured) return configured.replace(/\/+$/, '')
  return getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
}

export const resourceUrl = (event: H3Event) => `${baseUrl(event)}/mcp`

/** Discovery and token endpoints are called cross-origin by browser-based clients (e.g. MCP Inspector). No cookies are used there. */
export function cors(event: H3Event) {
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
    'Access-Control-Max-Age': '600',
  })
  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return true
  }
  return false
}

export function oauthError(event: H3Event, status: number, error: string, description: string) {
  setResponseStatus(event, status)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { error, error_description: description }
}

// ---- clients (dynamic registration, RFC 7591) ------------------------------------------------

export interface OAuthClient { client_id: string, name: string, redirect_uris: string[] }

export function validRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2000) return false
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.hash) return false
  if (u.protocol === 'https:') return true
  if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  // Native apps use private-use schemes (cursor://, vscode://). Never anything executable.
  return !['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:'].includes(u.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(u.protocol)
}

export function registerClient(name: string, redirectUris: string[]): OAuthClient {
  const db = useDb()
  const count = (db.prepare('SELECT COUNT(*) AS n FROM oauth_clients').get() as { n: number }).n
  if (count >= MAX_CLIENTS) {
    // Unused registrations are cheap to recreate; drop the oldest instead of refusing real clients.
    db.prepare('DELETE FROM oauth_clients WHERE client_id IN (SELECT client_id FROM oauth_clients ORDER BY created_at LIMIT 50)').run()
  }
  const client_id = randomUUID()
  db.prepare('INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)')
    .run(client_id, name.slice(0, 100) || 'MCP client', JSON.stringify(redirectUris), new Date().toISOString())
  return { client_id, name, redirect_uris: redirectUris }
}

export function getClient(id: string): OAuthClient | null {
  const row = useDb().prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(id) as { client_id: string, name: string, redirect_uris: string } | undefined
  return row ? { client_id: row.client_id, name: row.name, redirect_uris: JSON.parse(row.redirect_uris) } : null
}

// ---- authorization codes ---------------------------------------------------------------------

export function createCode(p: { clientId: string, redirectUri: string, challenge: string, resource: string | null, userId: string, scope: string }): string {
  const code = randomToken()
  useDb().prepare('INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, challenge, resource, expires_at, user_id, scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(code), p.clientId, p.redirectUri, p.challenge, p.resource, nowS() + CODE_TTL_S, p.userId, p.scope)
  return code
}

/** Single use: the row is deleted whether or not the rest of the exchange succeeds. */
export function consumeCode(code: string) {
  const db = useDb()
  const h = sha256(code)
  const row = db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').get(h) as
    { client_id: string, redirect_uri: string, challenge: string, resource: string | null, expires_at: number, user_id: string | null, scope: string } | undefined
  db.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').run(h)
  db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').run(nowS())
  return row && row.expires_at >= nowS() ? row : null
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false
  const a = Buffer.from(sha256(verifier))
  const b = Buffer.from(challenge)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---- tokens ----------------------------------------------------------------------------------

export function issueTokens(clientId: string, userId: string, scope: string, family: string = randomUUID()) {
  const db = useDb()
  const access = randomToken()
  const refresh = randomToken()
  const ins = db.prepare('INSERT INTO oauth_tokens (token_hash, kind, client_id, family, expires_at, user_id, scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  ins.run(sha256(access), 'access', clientId, family, nowS() + ACCESS_TTL_S, userId, scope, nowS())
  ins.run(sha256(refresh), 'refresh', clientId, family, nowS() + REFRESH_TTL_S, userId, scope, nowS())
  db.prepare('DELETE FROM oauth_tokens WHERE expires_at < ?').run(nowS() - 86400)
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope }
}

/** Refresh rotation with reuse detection: presenting a spent refresh token revokes the whole family. */
export function rotateRefresh(refreshToken: string, clientId: string) {
  const db = useDb()
  const row = db.prepare("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'").get(sha256(refreshToken)) as
    { client_id: string, family: string, expires_at: number, revoked: number, user_id: string | null, scope: string } | undefined
  if (!row || row.client_id !== clientId || !row.user_id) return null
  if (row.revoked) {
    db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE family = ?').run(row.family)
    return null
  }
  if (row.expires_at < nowS()) return null
  db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ?').run(sha256(refreshToken))
  return issueTokens(clientId, row.user_id, row.scope, row.family)
}

export function revokeToken(token: string) {
  const db = useDb()
  const row = db.prepare('SELECT family FROM oauth_tokens WHERE token_hash = ?').get(sha256(token)) as { family: string } | undefined
  if (row) db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE family = ?').run(row.family)
}

export interface McpCaller { member: Member, scopes: Scope[] }

/** /mcp accepts OAuth access tokens only. The caller is the member who approved the grant, limited to the scopes they chose and to what their role allows. In `nuxt dev` NUXT_DEV_TOKEN stands in for a grant. */
export function mcpCaller(event: H3Event): McpCaller | null {
  const bearer = getHeader(event, 'authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!bearer) return null
  if (import.meta.dev && process.env.NODE_ENV !== 'production' && process.env.NUXT_DEV_TOKEN && bearer === process.env.NUXT_DEV_TOKEN && event.context.member) {
    return { member: event.context.member, scopes: ROLE_SCOPES[event.context.member.role] }
  }
  const row = useDb().prepare("SELECT expires_at, revoked, user_id, scope FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'").get(sha256(bearer)) as
    { expires_at: number, revoked: number, user_id: string | null, scope: string } | undefined
  if (!row || row.revoked || row.expires_at < nowS() || !row.user_id) return null
  const member = memberById(row.user_id)
  if (!member) return null
  useDb().prepare('UPDATE oauth_tokens SET last_used = ? WHERE token_hash = ?').run(nowS(), sha256(bearer))
  const allowed = new Set(ROLE_SCOPES[member.role])
  return { member, scopes: parseScopes(row.scope).filter(x => allowed.has(x)) }
}

// ---- signed authorize form -------------------------------------------------------------------

function formSecret() {
  return createHash('sha256').update('hub-oauth-form:' + authSecret()).digest('hex')
}

export function signForm(fields: Record<string, string>, ttl = 600): { exp: string, sig: string } {
  const exp = String(nowS() + ttl)
  return { exp, sig: createHmac('sha256', formSecret()).update(canonical(fields) + '|' + exp).digest('base64url') }
}

export function verifyForm(fields: Record<string, string>, exp: string, sig: string): boolean {
  if (!/^\d+$/.test(exp) || Number(exp) < nowS()) return false
  const expected = createHmac('sha256', formSecret()).update(canonical(fields) + '|' + exp).digest('base64url')
  const a = Buffer.from(sig), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const canonical = (f: Record<string, string>) => JSON.stringify(Object.keys(f).sort().map(k => [k, f[k]]))

export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!))
