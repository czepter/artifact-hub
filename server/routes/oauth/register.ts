import { cors, oauthError, registerClient, validRedirectUri, SCOPE } from '../../utils/oauth'

// RFC 7591 dynamic client registration. Public clients only (PKCE replaces a client secret).
export default defineEventHandler(async (event) => {
  if (cors(event)) return ''
  if (event.method !== 'POST') throw createError({ statusCode: 405 })
  const body = await readBody<{ client_name?: unknown, redirect_uris?: unknown }>(event).catch(() => null)
  const uris = body?.redirect_uris
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(validRedirectUri)) {
    return oauthError(event, 400, 'invalid_redirect_uri', 'redirect_uris must be 1-10 https URLs, http loopback URLs or app-scheme URLs')
  }
  const name = typeof body?.client_name === 'string' ? body.client_name.trim() : ''
  const c = registerClient(name, uris as string[])
  setResponseStatus(event, 201)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return {
    client_id: c.client_id,
    client_name: c.name,
    redirect_uris: c.redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: SCOPE,
  }
})
