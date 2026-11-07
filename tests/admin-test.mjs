// Admin APIs against `npm run dev:login` (default http://localhost:3000): node tests/admin-test.mjs [base]
import { createHash, randomBytes } from 'node:crypto'
const B = process.argv[2] ?? 'http://localhost:3000'
const H = { authorization: 'Bearer devtoken', 'content-type': 'application/json' }
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : '  ' + x}`); if (!c) fails++ }
const j = async r => { try { return await r.json() } catch { return {} } }

// publish something so the log and overview have content
let r = await fetch(`${B}/api/artifacts`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'Admin test ' + randomBytes(2).toString('hex'), files: [{ path: 'index.html', content: '<p>hi</p>' }] }) })
const art = await j(r); ok('publish an artifact', r.status === 200 && art.id, r.status)
r = await fetch(`${B}/api/artifacts/${art.id}/shares`, { method: 'POST', headers: H, body: JSON.stringify({ role: 'comment' }) }); const sh = await j(r)
ok('create a share link', r.status === 200 && sh.token, r.status)

r = await fetch(`${B}/api/admin/overview`, { headers: H }); const ov = await j(r)
ok('overview counts', r.status === 200 && ov.artifacts >= 1 && ov.fileBytes > 0 && ov.dbBytes > 0, JSON.stringify(ov))
r = await fetch(`${B}/api/shares`, { headers: H }); const shares = await j(r)
ok('share links list shows the link and its artifact', r.status === 200 && shares.some(s => s.token === sh.token && s.artifact_id === art.id), r.status)
r = await fetch(`${B}/api/admin/activity`, { headers: H }); const ev = await j(r)
ok('activity records publish and share', ev.some(e => e.kind === 'created' && e.subject.includes('Admin test')) && ev.some(e => e.kind === 'shared'), JSON.stringify(ev.slice(0, 3)))
ok('activity names the actor', ev[0]?.actor && ev[0].actor !== 'system', ev[0]?.actor)
r = await fetch(`${B}/api/artifacts/${art.id}/shares/${sh.token}`, { method: 'DELETE', headers: H })
r = await fetch(`${B}/api/shares`, { headers: H }); ok('revoked link disappears', !(await j(r)).some(s => s.token === sh.token))

// a grant shows up under Clients with its member and scopes, and can be revoked
const redirect = 'http://localhost:9/cb'
r = await fetch(`${B}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Admin test client', redirect_uris: [redirect] }) }); const cl = await j(r)
const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url')
const q = new URLSearchParams({ client_id: cl.client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource: `${B}/mcp` })
const req = await j(await fetch(`${B}/api/oauth/request?${q}`, { headers: H }))
const dec = await j(await fetch(`${B}/api/oauth/decision`, { method: 'POST', headers: H, body: JSON.stringify({ params: req.params, exp: req.exp, sig: req.sig, scopes: ['read', 'comment'], decision: 'allow' }) }))
const code = new URL(dec.redirect).searchParams.get('code')
const tok = await j(await fetch(`${B}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', client_id: cl.client_id, code, code_verifier: verifier, redirect_uri: redirect }) }))
await fetch(`${B}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) })
r = await fetch(`${B}/api/grants`, { headers: H }); const grants = await j(r)
const g = grants.find(x => x.client === 'Admin test client')
ok('grant listed with member, scopes, last use', !!g && g.scope === 'read comment' && g.member_email === 'dev@example.test' && g.last_used > 0 && g.authorized_at > 0, JSON.stringify(g))
r = await fetch(`${B}/api/grants/${g.family}`, { method: 'DELETE', headers: H }); ok('revoke a grant', r.status === 200, r.status)
r = await fetch(`${B}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }); ok('revoked grant stops working', r.status === 401, r.status)
r = await fetch(`${B}/api/grants`, { headers: H }); ok('revoked grant leaves the list', !(await j(r)).some(x => x.client === 'Admin test client'))
r = await fetch(`${B}/api/admin/activity`, { headers: H }); const ev2 = await j(r)
ok('activity records approval and revoke', ev2.some(e => e.kind === 'authorized') && ev2.some(e => e.kind === 'revoked'))
console.log(fails ? `\n${fails} failed` : '\nall passed'); process.exit(fails ? 1 : 0)
