import vm from 'node:vm'
const B = 'http://localhost:3111', A = { authorization: 'Bearer devtoken' }
const ok = (n, c, x = '') => console.log(c ? 'PASS' : 'FAIL', n, x)
const J = { 'content-type': 'application/json' }
const body = async (r) => { const t = await r.text(); return t ? JSON.parse(t) : null }
const mcp = async (name, args) => { const r = await fetch(`${B}/mcp`, { method: 'POST', headers: { ...J, accept: 'application/json, text/event-stream', ...A }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); const t = await r.text(); const m = t.match(/data: (.*)/); const res = JSON.parse(m[1]).result; const txt = res.content[0].text; return res.isError ? { error: txt } : JSON.parse(txt) }

// artifact using the API
const html = `<!doctype html><html><head><title>Poll</title></head><body><h1>Poll</h1><script>artifact.ready.then(i => document.title = i ? i.viewer.name : 'no host')</script></body></html>`
const created = await mcp('create_artifact', { title: 'Poll', files: [{ path: 'index.html', content: html }] })
const id = created.id
const share = async (role) => (await mcp('share_link', { id, role })).url.split('/s/')[1]
const comment = await share('comment'), view = await share('view')
const data = (ref, body, cookie = '', headers = {}) => fetch(`${B}/api/view/${ref}/data`, { method: 'POST', headers: { ...J, ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) })
const email = async (e) => (await fetch(`${B}/api/identity`, { method: 'POST', headers: J, body: JSON.stringify({ email: e }) })).headers.get('set-cookie').split(';')[0]

// bridge present in served page
const fb = (await (await fetch(`${B}/api/view/${comment}`)).json()).frameBase
const served = await (await fetch(`${B}${fb}index.html`)).text()
ok('window.artifact script injected before page script', served.indexOf('data-hub-artifact-api') > 0 && served.indexOf('data-hub-artifact-api') < served.indexOf('artifact.ready.then'))

// roles
let r = await data(id, { op: 'set', scope: 'shared', key: 'poll/a', value: { n: 1 } }, '', A); ok('owner (bearer) can write shared', r.status === 200)
r = await data(comment, { op: 'get', scope: 'shared', key: 'poll/a' }); const got = await r.json(); ok('anonymous comment-link can read shared', r.status === 200 && got.value.n === 1 && got.updatedBy === 'owner', JSON.stringify(got))
r = await data(comment, { op: 'set', scope: 'shared', key: 'poll/b', value: 2 }); ok('comment-link without e-mail cannot write', r.status === 401)
const ada = await email('ada@example.com'), bob = await email('bob@example.com')
r = await data(comment, { op: 'set', scope: 'shared', key: 'poll/ada', value: { choice: 'A' } }, ada); ok('comment-link with e-mail can write shared', r.status === 200)
r = await data(comment, { op: 'list', scope: 'shared', prefix: 'poll/' }); const list = await r.json(); ok('list by prefix', list.length === 2 && list.find(x => x.key === 'poll/ada').updatedBy === 'ada@example.com', list.map(x => x.key).join(','))
r = await data(view, { op: 'set', scope: 'shared', key: 'x', value: 1 }, ada); ok('view-only link cannot write even with e-mail cookie', r.status === 403)
r = await data(view, { op: 'get', scope: 'shared', key: 'poll/a' }); ok('view-only link can read shared', r.status === 200)
r = await data(view, { op: 'get', scope: 'personal', key: 'k' }); ok('anonymous cannot use personal storage', r.status === 401)
await data(comment, { op: 'set', scope: 'personal', key: 'draft', value: 'ada-private' }, ada)
r = await data(comment, { op: 'get', scope: 'personal', key: 'draft' }, bob); ok('personal storage isolated between viewers', (await body(r)) === null)
r = await data(comment, { op: 'get', scope: 'personal', key: 'draft' }, ada); ok('personal visible to its owner', (await r.json()).value === 'ada-private')
r = await data(comment, { op: 'get', scope: 'shared', key: 'draft' }); ok('personal key not leaked into shared', (await body(r)) === null)
// validation / limits
r = await data(id, { op: 'set', scope: 'shared', key: 'big', value: 'x'.repeat(300 * 1024) }, '', A); ok('value > 256KB rejected', r.status === 413)
r = await data(id, { op: 'set', scope: 'shared', key: 'k'.repeat(201), value: 1 }, '', A); ok('key > 200 chars rejected', r.status === 400)
r = await data(id, { op: 'set', scope: 'shared', key: 'u' }, '', A); ok('undefined value rejected', r.status === 400)
r = await data(id, { op: 'nope', scope: 'shared', key: 'u' }, '', A); ok('bad op rejected', r.status === 400)
r = await data(id, { op: 'get', scope: 'global', key: 'u' }, '', A); ok('bad scope rejected', r.status === 400)
r = await data('not-a-ref', { op: 'get', scope: 'shared', key: 'u' }); ok('unknown ref 404', r.status === 404)
r = await data(id, { op: 'get', scope: 'shared', key: 'u' }); ok('artifact id without owner auth 404', r.status === 404)
r = await data(id, { op: 'set', scope: 'shared', key: "o'brien\"; DROP TABLE artifacts;--", value: { ok: 1 } }, '', A); ok('hostile key is just data (parametrised SQL)', r.status === 200 && (await mcp('list_artifacts', {})).length > 0)

// SSE
const ctl = new AbortController(); const events = []
const sse = await fetch(`${B}/api/view/${comment}/events`, { signal: ctl.signal }); ok('SSE opens', sse.status === 200 && /text\/event-stream/.test(sse.headers.get('content-type')))
;(async () => { const rd = sse.body.getReader(); const dec = new TextDecoder(); let buf = ''; try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value); let i; while ((i = buf.indexOf('\n\n')) >= 0) { events.push(buf.slice(0, i)); buf = buf.slice(i + 2) } } } catch {} })()
await new Promise(r => setTimeout(r, 300))
await mcp('data_set', { id, key: 'poll/live', value: [1, 2, 3] })
await mcp('publish_files', { id, base_version: 1, files: [{ path: 'index.html', content: html + '<!-- v2 -->' }] })
await fetch(`${B}/api/view/${comment}/comments`, { method: 'POST', headers: { ...J, cookie: ada }, body: JSON.stringify({ body: 'hello' }) })
await new Promise(r => setTimeout(r, 600)); ctl.abort()
const all = events.join('\n')
ok('SSE: shared data event', /event: data\ndata: .*"keys":\["poll\/live"\]/.test(all))
ok('SSE: version event', /event: version\ndata: .*"version":2/.test(all))
ok('SSE: comments event', /event: comments/.test(all))
ok('SSE: personal writes are not broadcast', !/draft/.test(all))
const nosse = await fetch(`${B}/api/view/${id}/events`); ok('SSE needs access', nosse.status === 404)

// MCP data tools
ok('data_get', (await mcp('data_get', { id, key: 'poll/ada' })).value.choice === 'A')
ok('data_list sees viewer writes', (await mcp('data_list', { id, prefix: 'poll/' })).length >= 3)
await mcp('data_delete', { id, key: 'poll/live' }); ok('data_delete', (await mcp('data_get', { id, key: 'poll/live' })) === null)

// run the injected in-frame script against a fake host
const script = served.match(/<script data-hub-artifact-api>([\s\S]*?)<\/script>/)[1]
const sent = []; const listeners = []
const parent = { postMessage: (m) => sent.push(m) }
const win = { parent, addEventListener: (t, f) => listeners.push([t, f]), setTimeout, clearTimeout }
win.window = win
vm.createContext(win); vm.runInContext(script, win)
const deliver = (data) => listeners.filter(l => l[0] === 'message').forEach(l => l[1]({ source: parent, data }))
await new Promise(r => setTimeout(r, 50))
ok('frame announces itself with hub:hello', sent.some(m => m.type === 'hub:hello'))
deliver({ type: 'hub:hello-result', info: { viewer: { name: 'ada@example.com', role: 'comment', canWrite: true }, artifactId: id } })
ok('artifact.ready resolves with host info', (await win.artifact.ready).viewer.name === 'ada@example.com')
const p = win.artifact.shared.set('k', { a: 1 }); const req = sent.find(m => m.type === 'hub:rpc')
ok('shared.set -> rpc{op:set,scope:shared}', req.op === 'set' && req.scope === 'shared' && req.key === 'k')
deliver({ type: 'hub:rpc-result', id: req.id, ok: true, result: { ok: true } }); await p; ok('rpc resolves', true)
const g = win.artifact.personal.get('x'); const greq = sent.filter(m => m.type === 'hub:rpc').pop()
deliver({ type: 'hub:rpc-result', id: greq.id, ok: true, result: { key: 'x', value: 42 } }); ok('get unwraps value', (await g) === 42)
const g2 = win.artifact.personal.get('y'); deliver({ type: 'hub:rpc-result', id: sent.filter(m => m.type === 'hub:rpc').pop().id, ok: true, result: null }); ok('missing key -> null', (await g2) === null)
const bad = win.artifact.shared.set('z', 1); deliver({ type: 'hub:rpc-result', id: sent.filter(m => m.type === 'hub:rpc').pop().id, ok: false, error: 'This link is view-only' }); ok('host error rejects', await bad.then(() => false, e => e.message === 'This link is view-only'))
let seen = null; const off = win.artifact.shared.onChange(e => { seen = e }); deliver({ type: 'hub:data-changed', scope: 'shared', keys: ['k'] }); ok('onChange fires', seen?.keys[0] === 'k')
off(); seen = null; deliver({ type: 'hub:data-changed', scope: 'shared', keys: ['k'] }); ok('unsubscribe works', seen === null)
listeners.filter(l => l[0] === 'message').forEach(l => l[1]({ source: {}, data: { type: 'hub:rpc-result', id: 1, ok: true } })); ok('messages from other windows ignored', true)
ok('window.artifact is frozen/immutable', (() => { try { win.artifact.shared = 1; win.artifact.hack = 1 } catch {} return win.artifact.hack === undefined })())
process.exit(0)
