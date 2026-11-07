// duplicateBoard end to end through the canvas endpoint: the file is copied byte for byte, also for a board added in the same batch.
import { api, B } from './bh.mjs'
import { ok, results } from './cvh.mjs'
const list = await api('/api/artifacts'); const src = list.find(a => a.title === 'Test canvas')
const id = (await api(`/api/artifacts/${src.id}/duplicate`, {}, 'POST')).id
const post = async (ops) => { const v = (await api(`/api/view/${id}`)).artifact.version; return fetch(`${B}/api/artifacts/${id}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer devtoken' }, body: JSON.stringify({ baseVersion: v, ops }) }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) })) }
const file = async (p) => { const r = await fetch(`${B}/api/view/${id}`, { headers: { authorization: 'Bearer devtoken' } }).then(r => r.json()); const f = r.files.find(f => f.path === p); return f ? f : null }
const raw = async (p) => (await fetch(`${B}${(await api(`/api/view/${id}`)).frameBase}${p}`, { headers: { authorization: 'Bearer devtoken' } })).text()
const v0 = (await api(`/api/view/${id}`)).artifact.version
let r = await post([{ type: 'duplicateBoard', path: 'screens/Poll.html' }])
ok('duplicateBoard answers 200 and makes one version', r.status === 200 && r.body.version === v0 + 1, r)
const a = await raw('screens/Poll.html'), b = await raw('screens/Poll-copy.html')
ok('the copy is byte for byte the source', a.length > 100 && a === b, [a.length, b.length])
const c = (await api(`/api/view/${id}`)).canvas
ok('the copy has its own board entry after the original in order', c.boards['screens/Poll-copy.html'].x === c.boards['screens/Poll.html'].x + 40 && c.order.at(-1) === 'screens/Poll-copy.html', c.order)
r = await post([{ type: 'addBoard', path: 'new.html', title: 'New', x: 0, y: 2000, w: 200, h: 200 }, { type: 'duplicateBoard', path: 'new.html' }])
ok('a board added in the same batch can be duplicated', r.status === 200 && (await raw('new-copy.html')) === (await raw('new.html')) && (await raw('new.html')).includes('<!doctype html>'), r)
r = await post([{ type: 'duplicateBoard', path: 'screens/Poll.html' }, { type: 'duplicateBoard', path: 'screens/Poll-copy-2.html' }])
ok('a copy of a copy in one batch works and is byte exact', r.status === 200 && (await raw('screens/Poll-copy-3.html')) === (await raw('screens/Poll.html')), r)
r = await post([{ type: 'duplicateBoard', path: 'nope.html' }])
ok('duplicating an unknown board is a 404 and changes nothing', r.status === 404, r)
r = await post(Array.from({ length: 201 }, (_, i) => ({ type: 'addNote', id: 'q' + i, note: {} })))
ok('201 operations are refused with 413', r.status === 413, r)
process.exit(results.fails ? 1 : 0)
