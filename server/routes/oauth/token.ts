import { consumeCode, cors, getClient, issueTokens, oauthError, pkceMatches, resourceUrl, rotateRefresh } from '../../utils/oauth'

export default defineEventHandler(async (event) => {
  if (cors(event)) return ''
  if (event.method !== 'POST') throw createError({ statusCode: 405 })
  const b = (await readBody<Record<string, unknown>>(event).catch(() => ({}))) as Record<string, string | undefined>
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const client = b.client_id ? getClient(b.client_id) : null
  if (!client) return oauthError(event, 401, 'invalid_client', 'Unknown client_id')

  if (b.grant_type === 'authorization_code') {
    if (!b.code || !b.code_verifier || !b.redirect_uri) return oauthError(event, 400, 'invalid_request', 'code, code_verifier and redirect_uri are required')
    const row = consumeCode(b.code)
    if (!row || row.client_id !== client.client_id || row.redirect_uri !== b.redirect_uri || !pkceMatches(b.code_verifier, row.challenge)) {
      return oauthError(event, 400, 'invalid_grant', 'Invalid or expired authorization code')
    }
    if (b.resource && b.resource !== resourceUrl(event)) return oauthError(event, 400, 'invalid_target', 'Unknown resource')
    if (!row.user_id) return oauthError(event, 400, 'invalid_grant', 'Invalid or expired authorization code')
    return issueTokens(client.client_id, row.user_id, row.scope)
  }

  if (b.grant_type === 'refresh_token') {
    if (!b.refresh_token) return oauthError(event, 400, 'invalid_request', 'refresh_token is required')
    const t = rotateRefresh(b.refresh_token, client.client_id)
    return t ?? oauthError(event, 400, 'invalid_grant', 'Invalid, expired or reused refresh token')
  }

  return oauthError(event, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token')
})
