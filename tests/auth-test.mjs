// Run against two instances on the same database:
//   A (dev login):  NUXT_DEV_LOGIN_EMAIL=dev@example.test NUXT_DEV_TOKEN=devtoken HUB_DB=... nuxt dev --port 3201
//   B (no dev env): HUB_DB=... nuxt dev --port 3202
// node tests/auth-test.mjs http://localhost:3201 http://localhost:3202
import { createHash, randomBytes } from 'node:crypto'
const [DEV = 'http://localhost:3201', PLAIN = 'http://localhost:3202'] = process.argv.slice(2)
let fails = 0
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  ' + extra}`); if (!cond) fails++ }
const j = async r => { try { return await r.json() } catch { return {} } }
const devH = { authorization: 'Bearer devtoken', 'content-type': 'application/json' }
const jar = {}
const withCookies = (h = {}) => ({ ...h, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') })
const keep = r => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1) } }

// dev login
let r = await fetch(`${DEV}/api/me`, { headers: devH }); const me = await j(r)
ok('dev bearer resolves the dev owner', r.status === 200 && me.role === 'owner', r.status)

// production-like instance: nothing without a session
r = await fetch(`${PLAIN}/api/me`); ok('no session -> 401', r.status === 401, r.status)
r = await fetch(`${PLAIN}/api/artifacts`, { headers: { authorization: 'Bearer devtoken' } }); ok('dev token is ignored without dev login', r.status === 401, r.status)
r = await fetch(`${PLAIN}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer devtoken' }, body: '{}' })
ok('/mcp rejects a static token', r.status === 401 && /resource_metadata/.test(r.headers.get('www-authenticate') ?? ''), r.status)
r = await fetch(`${PLAIN}/api/auth-config`); ok('setup is closed after the first owner', (await j(r)).setup === false)

// invite-only sign-up
const email = `mara-${randomBytes(3).toString('hex')}@example.test`, password = 'correct horse battery'
const signUp = (e = email) => fetch(`${PLAIN}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: PLAIN }, body: JSON.stringify({ email: e, password, name: 'Mara' }) })
r = await signUp(); ok('uninvited sign-up is refused', r.status >= 400 && r.status < 500, r.status)
r = await fetch(`${DEV}/api/invites`, { method: 'POST', headers: devH, body: JSON.stringify({ email, role: 'commenter' }) }); const inv = await j(r)
ok('owner creates an invitation link', r.status === 200 && /\/invite\//.test(inv.url ?? ''), r.status)
r = await fetch(`${PLAIN}/api/invites/lookup?token=${inv.url.split('/').pop()}`); const lk = await j(r)
ok('invite lookup shows e-mail and role', lk.email === email && lk.role === 'commenter')
r = await signUp(); keep(r); ok('invited sign-up works', r.status === 200, r.status)
r = await fetch(`${PLAIN}/api/me`, { headers: withCookies() }); const m2 = await j(r)
ok('new member is a commenter', r.status === 200 && m2.role === 'commenter' && m2.email === email, JSON.stringify(m2))
r = await fetch(`${PLAIN}/api/artifacts`, { headers: withCookies() }); ok('commenter can list artifacts', r.status === 200, r.status)
r = await fetch(`${PLAIN}/api/artifacts`, { method: 'POST', headers: withCookies({ 'content-type': 'application/json' }), body: JSON.stringify({ title: 'x' }) }); ok('commenter cannot create artifacts', r.status === 403, r.status)
r = await fetch(`${PLAIN}/api/members`, { headers: withCookies() }); ok('commenter cannot list members', r.status === 403, r.status)
r = await signUp('someone-else@example.test'); ok('invite works only for its e-mail', r.status >= 400, r.status)

// OAuth: grant tied to the member, capped by role
const redirect = 'http://localhost:9/cb'
r = await fetch(`${PLAIN}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test client', redirect_uris: [redirect] }) }); const cl = await j(r)
const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url')
const q = new URLSearchParams({ client_id: cl.client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's1', resource: `${PLAIN}/mcp` })
r = await fetch(`${PLAIN}/oauth/authorize?${q}`, { redirect: 'manual' }); ok('authorize without a session goes to sign-in', r.status === 302 && r.headers.get('location').startsWith('/?next='), r.headers.get('location'))
r = await fetch(`${PLAIN}/oauth/authorize?${q}`, { redirect: 'manual', headers: withCookies() }); ok('authorize with a session goes to consent', r.status === 302 && r.headers.get('location').startsWith('/oauth/consent?'), r.headers.get('location'))
r = await fetch(`${PLAIN}/api/oauth/request?${q}`, { headers: withCookies() }); const req = await j(r)
ok('consent request lists only what a commenter may grant', r.status === 200 && JSON.stringify(req.allowed) === '["read","comment"]', JSON.stringify(req.allowed))
r = await fetch(`${PLAIN}/api/oauth/decision`, { method: 'POST', headers: withCookies({ 'content-type': 'application/json' }), body: JSON.stringify({ params: req.params, exp: req.exp, sig: req.sig, scopes: ['read', 'comment', 'write', 'share'], decision: 'allow' }) }); const dec = await j(r)
const code = new URL(dec.redirect).searchParams.get('code'); ok('decision returns a code', !!code && new URL(dec.redirect).searchParams.get('state') === 's1', JSON.stringify(dec))
r = await fetch(`${PLAIN}/api/oauth/decision`, { method: 'POST', headers: withCookies({ 'content-type': 'application/json' }), body: JSON.stringify({ params: { ...req.params, state: 'tampered' }, exp: req.exp, sig: req.sig, decision: 'allow' }) }); ok('tampered request is refused', r.status === 400, r.status)
r = await fetch(`${PLAIN}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', client_id: cl.client_id, code, code_verifier: verifier, redirect_uri: redirect }) }); const tok = await j(r)
ok('token exchange; scope is capped at read+comment', r.status === 200 && tok.scope === 'read comment', JSON.stringify(tok))
const mcp = (method, params = {}) => fetch(`${PLAIN}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
r = await mcp('tools/list'); const txt = await r.text(); const names = [...txt.matchAll(/"name":"([a-z_]+)"/g)].map(x => x[1])
ok('tools follow the grant', r.status === 200 && names.includes('read_comments') && names.includes('reply_comment') && !names.includes('publish_files') && !names.includes('share_link'), names.join(','))
r = await fetch(`${DEV}/api/members`, { headers: devH }); const list = await j(r)
const mara = list.members.find(x => x.email === email)
r = await fetch(`${DEV}/api/members/${mara.id}`, { method: 'DELETE', headers: devH }); ok('owner removes the member', r.status === 200, r.status)
r = await mcp('tools/list'); ok('removing a member kills their grants', r.status === 401, r.status)
console.log(fails ? `\n${fails} failed` : '\nall passed'); process.exit(fails ? 1 : 0)
