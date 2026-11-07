import { createHash, randomBytes } from 'node:crypto'
const B = process.env.HUB ?? 'http://localhost:3111'
const ok = (name, cond, extra = '') => console.log(cond ? 'PASS' : 'FAIL', name, extra)
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } }

// 1. unauthenticated /mcp advertises discovery
let r = await fetch(`${B}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })
ok('mcp 401 + resource_metadata', r.status === 401 && (r.headers.get('www-authenticate') ?? '').includes(`resource_metadata="${B}/.well-known/oauth-protected-resource"`), r.headers.get('www-authenticate'))
const prm = await j(await fetch(`${B}/.well-known/oauth-protected-resource`)); ok('protected-resource metadata', prm.resource === `${B}/mcp` && prm.authorization_servers[0] === B)
const prm2 = await j(await fetch(`${B}/.well-known/oauth-protected-resource/mcp`)); ok('protected-resource /mcp variant', prm2.resource === `${B}/mcp`)
const as = await j(await fetch(`${B}/.well-known/oauth-authorization-server`)); ok('AS metadata', as.code_challenge_methods_supported?.[0] === 'S256' && as.registration_endpoint.endsWith('/oauth/register'))
r = await fetch(`${B}/oauth/token`, { method: 'OPTIONS', headers: { origin: 'http://x', 'access-control-request-method': 'POST' } }); ok('CORS preflight', r.status === 204 && r.headers.get('access-control-allow-origin') === '*', r.status)

// 2. DCR
r = await fetch(`${B}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test <b>Client</b>', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) })
const client = await j(r); ok('register', r.status === 201 && client.client_id, r.status)
r = await fetch(`${B}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['javascript:alert(1)'] }) }); ok('register rejects javascript: URI', r.status === 400)
r = await fetch(`${B}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.com/cb'] }) }); ok('register rejects plain-http non-loopback', r.status === 400)

// 3. authorize
const verifier = randomBytes(32).toString('base64url'); const challenge = createHash('sha256').update(verifier).digest('base64url')
const redirect = 'https://claude.ai/api/mcp/auth_callback'
const q = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: 'code', state: 'st4te', code_challenge: challenge, code_challenge_method: 'S256', resource: `${B}/mcp`, scope: 'artifacts' })
// The consent screen is a page in the app; these are the endpoints behind it. Run against `nuxt dev` with NUXT_DEV_LOGIN_EMAIL and NUXT_DEV_TOKEN=devtoken.
const dev = { authorization: 'Bearer devtoken', 'content-type': 'application/json' }
r = await fetch(`${B}/api/oauth/request?${q}`, { headers: dev }); const req = await j(r)
ok('consent request', r.status === 200 && req.client.includes('Client') && req.params.client_id === client.client_id && req.allowed.includes('write'), r.status)
r = await fetch(`${B}/oauth/authorize?${new URLSearchParams({ ...Object.fromEntries(q), redirect_uri: 'https://evil.example/cb' })}`, { redirect: 'manual' }); ok('unregistered redirect_uri -> error screen, no redirect to it', r.status === 302 && r.headers.get('location').startsWith('/oauth/consent?error='), r.headers.get('location'))
r = await fetch(`${B}/oauth/authorize?${new URLSearchParams({ ...Object.fromEntries(q), code_challenge_method: 'plain' })}`, { redirect: 'manual' }); ok('plain PKCE rejected', r.status === 302 && /error=invalid_request/.test(r.headers.get('location') ?? ''))
const post = async (extra = {}) => {
  const params = extra.state ? { ...req.params, state: extra.state } : req.params
  const x = await fetch(`${B}/api/oauth/decision`, { method: 'POST', headers: dev, body: JSON.stringify({ params, exp: req.exp, sig: req.sig, scopes: ['read', 'comment', 'write', 'share'], decision: extra.decision ?? 'allow' }) })
  const d = await j(x)
  return { status: x.status === 200 ? 302 : x.status, headers: { get: (k) => (k.toLowerCase() === 'location' ? (d.redirect ?? null) : null) } }
}
r = await post({ state: 'tampered' }); ok('tampered params rejected by signature', r.status === 400 && !r.headers.get('location'))
r = await post({ decision: 'deny' }); ok('deny -> access_denied', /error=access_denied/.test(r.headers.get('location') ?? '') && /state=st4te/.test(r.headers.get('location')))
r = await post(); const loc = new URL(r.headers.get('location')); const code = loc.searchParams.get('code')
ok('allow -> code + state', r.status === 302 && code && loc.searchParams.get('state') === 'st4te' && loc.origin + loc.pathname === redirect)

// 4. token
const tok = (body) => fetch(`${B}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
r = await tok({ grant_type: 'authorization_code', client_id: client.client_id, code, redirect_uri: redirect, code_verifier: 'x'.repeat(50) }); ok('wrong verifier rejected', r.status === 400 && (await j(r)).error === 'invalid_grant')
r = await tok({ grant_type: 'authorization_code', client_id: client.client_id, code, redirect_uri: redirect, code_verifier: verifier }); ok('code is single-use (burned by failed attempt)', r.status === 400)
// fresh code for the happy path
r = await post(); const code2 = new URL(r.headers.get('location')).searchParams.get('code')
r = await tok({ grant_type: 'authorization_code', client_id: client.client_id, code: code2, redirect_uri: redirect, code_verifier: verifier, resource: `${B}/mcp` })
const t1 = await j(r); ok('token exchange', r.status === 200 && t1.access_token && t1.refresh_token && t1.token_type === 'Bearer', r.status)
ok('token response not cacheable', r.headers.get('cache-control') === 'no-store')

// 5. use the OAuth token on /mcp
const mcp = (tokn, method = 'tools/list') => fetch(`${B}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tokn}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }) })
r = await mcp(t1.access_token); ok('/mcp works with OAuth access token', r.status === 200 && (await r.text()).includes('create_artifact'))
r = await mcp('garbage'); ok('/mcp rejects garbage token', r.status === 401)
r = await mcp(t1.refresh_token); ok('refresh token is not accepted as access token', r.status === 401)

// 6. refresh rotation + reuse detection
r = await tok({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: t1.refresh_token }); const t2 = await j(r); ok('refresh rotates', r.status === 200 && t2.refresh_token !== t1.refresh_token)
r = await tok({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: t1.refresh_token }); ok('replayed old refresh token rejected', r.status === 400)
r = await mcp(t2.access_token); ok('replay revoked the whole family (new access token dead too)', r.status === 401, r.status)

// 7. revoke
r = await post(); const code3 = new URL(r.headers.get('location')).searchParams.get('code')
const t3 = await j(await tok({ grant_type: 'authorization_code', client_id: client.client_id, code: code3, redirect_uri: redirect, code_verifier: verifier }))
r = await fetch(`${B}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t3.refresh_token }) }); ok('revoke returns 200', r.status === 200)
r = await mcp(t3.access_token); ok('revoked family cannot call /mcp', r.status === 401)
r = await mcp('devtoken'); ok('dev token stands in for a grant (dev only)', r.status === 200)
