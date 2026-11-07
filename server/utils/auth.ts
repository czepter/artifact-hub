import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { getShare, requireArtifact } from './store'
import { authSecret } from './secret'
import type { Member, MemberRole } from './betterAuth'

function safeEqual(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

const secret = () => authSecret()

/** Cookies are `secure` only when the request really came in over HTTPS, so plain-http LAN testing still works. */
export function secureCookie(event: H3Event): boolean {
  return getRequestProtocol(event, { xForwardedProto: true }) === 'https'
}

/** The signed-in member, resolved by server/middleware/member.ts (session cookie, or the dev login in `nuxt dev`). */
export function currentMember(event: H3Event): Member | null {
  return event.context.member ?? null
}

const RANK: Record<MemberRole, number> = { commenter: 0, editor: 1, owner: 2 }

function need(event: H3Event, min: MemberRole): Member {
  const m = currentMember(event)
  if (!m) throw createError({ statusCode: 401, statusMessage: 'Sign in required' })
  if (RANK[m.role] < RANK[min]) throw createError({ statusCode: 403, statusMessage: `Requires the ${min} role` })
  return m
}

export const isOwner = (event: H3Event) => currentMember(event)?.role === 'owner'
/** Owners and editors can change artifacts. */
export const canEdit = (event: H3Event) => { const m = currentMember(event); return !!m && RANK[m.role] >= RANK.editor }
export const requireMember = (event: H3Event) => need(event, 'commenter')
export const requireEditor = (event: H3Event) => need(event, 'editor')
export const requireOwner = (event: H3Event) => need(event, 'owner')

// --- frame tokens: the artifact iframe is sandboxed (opaque origin), so it cannot rely on cookies.
// The viewer API hands out a short-lived signed token that goes into the iframe URL path instead.

export function signFrameToken(artifactId: string, ttlSeconds = 12 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const body = `${artifactId}.${exp}`
  const sig = createHmac('sha256', secret()).update(body).digest('base64url')
  return `ft_${body}.${sig}`
}

export function verifyFrameToken(ref: string): string | null {
  if (!ref.startsWith('ft_')) return null
  const rest = ref.slice(3)
  const i = rest.lastIndexOf('.')
  if (i < 0) return null
  const body = rest.slice(0, i)
  const sig = rest.slice(i + 1)
  const expected = createHmac('sha256', secret()).update(body).digest('base64url')
  if (sig.length !== expected.length || !safeEqual(sig, expected)) return null
  const [artifactId, exp] = body.split('.')
  if (!artifactId || Number(exp) < Date.now() / 1000) return null
  return artifactId
}

export type Role = 'owner' | 'comment' | 'view'
export interface Access { artifactId: string, role: Role, email: string | null, shareToken: string | null }

export function readIdentityEmail(event: H3Event): string | null {
  const v = getCookie(event, 'hub_email')
  return v && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v) ? v.toLowerCase() : null
}

/** `ref` is a share token or, for a signed-in member, an artifact id. */
export function resolveAccess(event: H3Event, ref: string): Access {
  const share = getShare(ref)
  if (share) {
    return { artifactId: share.artifact_id, role: share.role, email: readIdentityEmail(event), shareToken: share.token }
  }
  const m = currentMember(event)
  if (m) {
    requireArtifact(ref)
    // Owners and editors get the full viewer; commenters can read and comment.
    return { artifactId: ref, role: RANK[m.role] >= RANK.editor ? 'owner' : 'comment', email: m.email, shareToken: null }
  }
  // Do not reveal whether an id exists.
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

/** Frame access: share token or signed frame token. No cookies. */
export function resolveFrameAccess(ref: string): string {
  const share = getShare(ref)
  if (share) return share.artifact_id
  const id = verifyFrameToken(ref)
  if (id) return id
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}
