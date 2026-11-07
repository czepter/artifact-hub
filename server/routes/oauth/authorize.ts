import { collect, check, redirectUrl } from '../../utils/oauthRequest'
import { currentMember } from '../../utils/auth'

// Entry point for OAuth clients. It validates the request, makes sure a member is signed in, and
// hands over to the consent screen in the app (/oauth/consent), where the member chooses what to allow.
export default defineEventHandler((event) => {
  if (event.method !== 'GET') throw createError({ statusCode: 405 })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const q = collect(getQuery(event))
  const r = check(event, q)
  if ('fatal' in r) return sendRedirect(event, `/oauth/consent?error=${encodeURIComponent(r.fatal!)}`, 302)
  if (r.redirectError) return sendRedirect(event, redirectUrl(q, { error: r.redirectError }), 302)
  const qs = new URLSearchParams(q).toString()
  if (!currentMember(event)) return sendRedirect(event, `/?next=${encodeURIComponent(`/oauth/consent?${qs}`)}`, 302)
  return sendRedirect(event, `/oauth/consent?${qs}`, 302)
})
