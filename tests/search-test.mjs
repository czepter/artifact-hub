// Run against a dev server with the development login: PORT=3128 npm run dev:login (HUB_DB should be a scratch file).
const B = process.env.HUB ?? 'http://localhost:3128', A = { authorization: 'Bearer devtoken' }
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x) }
const J = { 'content-type': 'application/json' }
const api = async (method, path, body, headers = A) => { const r = await fetch(`${B}${path}`, { method, headers: { ...J, ...headers }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null } }
const page = (t) => [{ path: 'index.html', content: `<!doctype html><title>${t}</title><h1>${t}</h1>` }]
const tag = Math.random().toString(36).slice(2, 7)

const mk = async (title) => (await api('POST', '/api/artifacts', { title, files: page(title) })).body.id
const a1 = await mk(`Zq Pricing ${tag}`), a2 = await mk(`zq 100%_off ${tag}`), a3 = await mk(`Zq Plain ${tag}`)
let r = await api('GET', `/api/search?q=${encodeURIComponent('PRICING ' + tag)}`)
ok('case-insensitive title match', r.status === 200 && r.body.artifacts.length === 1 && r.body.artifacts[0].id === a1, JSON.stringify(r.body))
ok('artifact shape', ['id', 'title', 'current_version', 'updated_at', 'pinned'].every(k => k in r.body.artifacts[0]))
r = await api('GET', `/api/search?q=${encodeURIComponent('100%_off ' + tag)}`)
ok('wildcards are literal', r.body.artifacts.length === 1 && r.body.artifacts[0].id === a2, JSON.stringify(r.body.artifacts))
r = await api('GET', `/api/search?q=${encodeURIComponent('%')}`)
ok('lone % matches only titles containing it', r.body.artifacts.every(a => a.title.includes('%')) && r.body.artifacts.some(a => a.id === a2))
r = await api('GET', '/api/search?q=')
ok('empty q returns recent artifacts (max 8)', r.body.artifacts.length > 0 && r.body.artifacts.length <= 8 && r.body.artifacts[0].id !== undefined)
r = await api('GET', `/api/search?q=${encodeURIComponent('nope-' + tag)}`)
ok('no match is empty', r.body.artifacts.length === 0 && r.body.threads.length === 0)

// a guest comment on a share link shows up as a waiting thread
const sh = await api('POST', `/api/artifacts/${a3}/shares`, { role: 'comment' })
const token = sh.body.token ?? sh.body.url?.split('/').pop()
const word = `needle${tag}`
const guestEmail = `guest-${tag}@example.com`
const cookie = (await fetch(`${B}/api/identity`, { method: 'POST', headers: J, body: JSON.stringify({ email: guestEmail }) })).headers.getSetCookie().find(c => c.startsWith('hub_email=')).split(';')[0]
r = await api('POST', `/api/view/${token}/comments`, { body: `Please check the ${word} spacing` }, { cookie })
ok('guest comment created', r.status === 200, JSON.stringify(r.body))
r = await api('GET', `/api/search?q=${word}`)
ok('thread found by body', r.body.threads.length === 1 && r.body.threads[0].artifact_id === a3 && r.body.threads[0].body.includes(word), JSON.stringify(r.body.threads))
ok('thread shape', ['id', 'artifact_id', 'title', 'author_email', 'body', 'last_at'].every(k => k in r.body.threads[0]))
r = await api('GET', `/api/search?q=${encodeURIComponent('guest-' + tag)}`)
ok('thread found by author', r.body.threads.length === 1)
r = await api('GET', '/api/search?q=')
ok('empty q lists waiting threads', r.body.threads.some(t => t.artifact_id === a3) && r.body.threads.length <= 5)
// member replies -> no longer waiting
const tid = (await api('GET', `/api/search?q=${word}`)).body.threads[0].id
await api('POST', `/api/view/${a3}/comments`, { body: 'On it', parentId: tid })
r = await api('GET', `/api/search?q=${word}`)
ok('answered thread is not waiting', r.body.threads.length === 0, JSON.stringify(r.body.threads))
process.exit(failed ? 1 : 0)
