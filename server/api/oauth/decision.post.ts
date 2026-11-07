import { requireMember } from '../../utils/auth'
import { ROLE_SCOPES, createCode, parseScopes, verifyForm } from '../../utils/oauth'
import { check, collect, redirectUrl } from '../../utils/oauthRequest'
import { logEvent } from '../../utils/events'

// The member's answer from the consent screen. The signature binds the exact request they were shown (and is our CSRF check).
export default defineEventHandler(async (event) => {
  const member = requireMember(event)
  const b = await readBody<{ params?: Record<string, unknown>, exp?: string, sig?: string, scopes?: string[], decision?: string }>(event)
  const q = collect(b.params ?? {})
  if (!verifyForm(q, String(b.exp ?? ''), String(b.sig ?? ''))) throw createError({ statusCode: 400, statusMessage: 'This request expired. Start the connection again from your app.' })
  const r = check(event, q)
  if ('fatal' in r) throw createError({ statusCode: 400, statusMessage: r.fatal })
  if (r.redirectError) return { redirect: redirectUrl(q, { error: r.redirectError }) }
  if (b.decision !== 'allow') return { redirect: redirectUrl(q, { error: 'access_denied' }) }
  const allowed = new Set(ROLE_SCOPES[member.role])
  const chosen = new Set(parseScopes((b.scopes ?? []).join(' ')).filter(s => allowed.has(s)))
  chosen.add('read')
  const code = createCode({ clientId: q.client_id!, redirectUri: q.redirect_uri!, challenge: q.code_challenge!, resource: q.resource ?? null, userId: member.id, scope: [...chosen].join(' ') })
  logEvent('authorized', `${r.client!.name} (${[...chosen].join(', ')})`)
  return { redirect: redirectUrl(q, { code }) }
})
