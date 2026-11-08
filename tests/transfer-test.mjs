// Run against a dev server with the development login: PORT=3111 HUB_DB=<scratch> npm run dev:login
const B = process.env.HUB ?? 'http://localhost:3111', A = { authorization: 'Bearer devtoken' }
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x) }
const J = { 'content-type': 'application/json' }
const api = async (method, path, body) => { const r = await fetch(`${B}${path}`, { method, headers: { ...J, ...A }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null } catch { b = t } return { status: r.status, body: b } }
const mcp = async (name, args) => { const r = await fetch(`${B}/mcp`, { method: 'POST', headers: { ...J, accept: 'application/json, text/event-stream', ...A }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); const t = await r.text(); const m = t.match(/data: (.*)/); const res = JSON.parse(m[1]).result; const txt = res.content[0].text; if (res.isError) return { error: txt }; try { return JSON.parse(txt) } catch { return txt } }
const get = async (id) => { const v = (await api('GET', `/api/view/${id}`)).body; return v }
const src = async (id, path) => (await api('GET', `/api/artifacts/${id}/source?path=${encodeURIComponent(path)}`)).body?.source
const tag = Math.random().toString(36).slice(2, 7)

const board = (t, extra = '') => `<!doctype html><link rel="stylesheet" href="css/app.css"><h1>${t}</h1>${extra}`
const canvasA = { v: 3, title: 'A', boards: { 'home.html': { x: 0, y: 0, w: 800, h: 600, title: 'Home', group: 'g1' }, 'screens/detail.html': { x: 900, y: 0, w: 800, h: 600, title: 'Detail', group: 'g1', locked: true }, 'other.html': { x: 0, y: 700, w: 400, h: 300, title: 'Other' } }, order: ['home.html', 'screens/detail.html', 'other.html'], notes: { n1: { kind: 'sticky', x: 10, y: -150, w: 200, h: 100, text: 'hi' }, n2: { kind: 'arrow', x: 5, y: 5, w: 50, h: 50, bind: { start: { type: 'note', id: 'n1' }, end: { type: 'board', id: 'home.html' } } } } }
const a = (await api('POST', '/api/artifacts', { title: `Src ${tag}`, files: [
  { path: 'canvas.json', content: JSON.stringify(canvasA) },
  { path: 'home.html', content: board('home', '<a href="screens/detail.html">d</a><img src="img/logo.svg">') },
  { path: 'screens/detail.html', content: board('detail').replace('css/app.css', '../css/app.css') },
  { path: 'other.html', content: '<h1>other</h1><a href="home.html">h</a>' },
  { path: 'css/app.css', content: '@import "fonts.css"; body{background:url(../img/bg.png)}' },
  { path: 'css/fonts.css', content: 'h1{font-family:x}' },
  { path: 'img/logo.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
  { path: 'img/bg.png', content: 'iVBORw0KGgo=', encoding: 'base64' },
  { path: 'unused.css', content: 'x{}' },
] })).body.id
const t = (await api('POST', '/api/artifacts', { title: `Tgt ${tag}`, files: [
  { path: 'canvas.json', content: JSON.stringify({ v: 3, title: 'T', boards: { 'home.html': { x: 0, y: 0, w: 500, h: 400, title: 'T home' } }, order: ['home.html'], notes: { n1: { kind: 'text', x: 0, y: 0, w: 100, text: 'mine' } } }) },
  { path: 'home.html', content: '<h1>target home</h1>' },
  { path: 'css/app.css', content: 'body{background:#fff}' },
] })).body.id

ok('same artifact refused', (await api('POST', `/api/artifacts/${a}/transfer-boards`, { target: a })).status === 400)
ok('unknown board 404', (await api('POST', `/api/artifacts/${a}/transfer-boards`, { target: t, boards: ['nope.html'] })).status === 404)
ok('unknown target 404', (await api('POST', `/api/artifacts/${a}/transfer-boards`, { target: 'nope', boards: ['home.html'] })).status === 404)

// copy two linked boards
let r = await api('POST', `/api/artifacts/${a}/transfer-boards`, { target: t, boards: ['home.html', 'screens/detail.html'] })
ok('copy succeeds', r.status === 200 && r.body.mode === 'copy', JSON.stringify(r.body))
ok('taken board path gets a free name', r.body.boards.find(b => b.from === 'home.html').to === 'home-2.html' && r.body.boards.find(b => b.from === 'screens/detail.html').to === 'screens/detail.html', JSON.stringify(r.body.boards))
ok('link between copied boards follows the rename', (await src(t, 'screens/detail.html')) !== undefined && (await src(t, 'home-2.html')).includes('href="screens/detail.html"'))
ok('dependencies come along (css via import + url, images)', ['css/fonts.css', 'img/logo.svg', 'img/bg.png'].every(f => r.body.files.includes(f)), r.body.files.join())
ok('unreferenced file stays behind', !r.body.files.includes('unused.css') && !r.body.files.includes('other.html'))
ok('conflicting dependency is kept and reported', !r.body.files.includes('css/app.css') && r.body.warnings.some(w => w.includes('css/app.css')) && (await src(t, 'css/app.css')).includes('#fff'))
const tv = await get(t)
const tb = tv.canvas.boards
ok('placed to the right of existing boards, layout kept', tb['home-2.html'].x === 500 + 120 && tb['screens/detail.html'].x === 500 + 120 + 900 && tb['home-2.html'].y === 0, JSON.stringify(tb))
ok('group ids are fresh and shared by the copies, locked is kept', tb['home-2.html'].group && tb['home-2.html'].group !== 'g1' && tb['home-2.html'].group === tb['screens/detail.html'].group && tb['screens/detail.html'].locked === true)
ok('notes are not copied for a board selection', Object.keys(tv.canvas.notes).join() === 'n1')
ok('source untouched by a copy', Object.keys((await get(a)).canvas.boards).length === 3)

// whole canvas, includes notes; a link to a board that is not copied is reported
const t2 = (await api('POST', '/api/artifacts', { title: `Empty ${tag}`, files: [{ path: 'index.html', content: '<h1>plain page</h1>' }] })).body.id
r = await api('POST', `/api/artifacts/${a}/transfer-boards`, { target: t2 })
ok('whole canvas into a plain page artifact', r.status === 200 && r.body.boards.length === 3 && r.body.notes === 2, JSON.stringify(r.body))
const v2 = await get(t2)
ok('the plain page became the first board', Object.keys(v2.canvas.boards)[0] === 'index.html' && Object.keys(v2.canvas.boards).length === 4)
const arrow = Object.values(v2.canvas.notes).find(n => n.kind === 'arrow')
ok('arrow bindings follow the copies', arrow.bind.end.id === 'home.html' && Object.keys(v2.canvas.notes).includes(arrow.bind.start.id))
const part = await api('POST', `/api/artifacts/${a}/transfer-boards`, { target: (await api('POST', '/api/artifacts', { title: `T3 ${tag}`, files: [{ path: 'index.html', content: 'x' }] })).body.id, boards: ['other.html'] })
ok('link to a board left behind is reported', part.body.warnings.some(w => w.includes('other.html → home.html')), JSON.stringify(part.body.warnings))

// move
r = await mcp('transfer_boards', { id: a, target: t, boards: ['other.html'], mode: 'move' })
ok('MCP move', r.mode === 'move' && r.boards[0].to === 'other.html' && r.sourceVersion > 1, JSON.stringify(r))
const sv = await get(a)
ok('moved board is gone from the source (canvas and file)', !sv.canvas.boards['other.html'] && !sv.files.some(f => f.path === 'other.html') && sv.files.some(f => f.path === 'css/app.css'))
ok('moved board exists in the target', (await src(t, 'other.html')).includes('other'))
const sv2 = await get(a)
r = await api('POST', `/api/artifacts/${a}/transfer-boards`, { target: t, mode: 'move' })
ok('move of everything empties the source canvas, notes included', r.status === 200 && Object.keys((await get(a)).canvas.boards).length === 0 && Object.keys((await get(a)).canvas.notes).length === 0, JSON.stringify(r.body))
const plain = (await api('POST', '/api/artifacts', { title: `Plain ${tag}`, files: [{ path: 'index.html', content: '<h1>p</h1>' }] })).body.id
ok('a single page can be copied but not moved', (await api('POST', `/api/artifacts/${plain}/transfer-boards`, { target: t, mode: 'move' })).status === 400 && (await api('POST', `/api/artifacts/${plain}/transfer-boards`, { target: t })).status === 200)
await api('DELETE', `/api/artifacts/${plain}`)

for (const id of [a, t, t2]) await api('DELETE', `/api/artifacts/${id}`)
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
