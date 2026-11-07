import { requireMember } from '../../utils/auth'
import { ROLE_SCOPES, parseScopes, signForm, SCOPES } from '../../utils/oauth'
import { check, collect } from '../../utils/oauthRequest'

// What the consent screen shows: the client, who is approving, and which scopes that member may hand out.
export default defineEventHandler((event) => {
  const member = requireMember(event)
  const q = collect(getQuery(event))
  const r = check(event, q)
  if ('fatal' in r) throw createError({ statusCode: 400, statusMessage: r.fatal })
  if (r.redirectError) throw createError({ statusCode: 400, statusMessage: `Invalid request: ${r.redirectError}` })
  const redirect = new URL(q.redirect_uri!)
  const requested = parseScopes(q.scope)
  return {
    client: r.client!.name,
    redirectTo: redirect.host || redirect.protocol,
    redirectUri: q.redirect_uri,
    member: { name: member.name, email: member.email, role: member.role },
    allowed: ROLE_SCOPES[member.role],
    requested: requested.length ? requested : [...SCOPES],
    params: q,
    ...signForm(q),
  }
})
