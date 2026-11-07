// End-to-end check of /api/artifacts/:id/render and the MCP render_artifact tool against a running dev:login server:
//   HUB=http://localhost:3000 node tests/render-test.mjs        (RENDER_OUT=dir keeps the files for a look)
import { writeFileSync, mkdirSync } from 'node:fs'
const B = process.env.HUB || 'http://localhost:3000', A = { authorization: 'Bearer devtoken' }
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1 }
const J = { 'content-type': 'application/json' }
const mcpRaw = async (name, args) => { const r = await fetch(`${B}/mcp`, { method: 'POST', headers: { ...J, accept: 'application/json, text/event-stream', ...A }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); const t = await r.text(); return JSON.parse(t.match(/data: (.*)/)[1]).result }
const mcp = async (name, args) => { const res = await mcpRaw(name, args); const txt = res.content[0].text; return res.isError ? { error: txt } : JSON.parse(txt) }
const get = (id, q, headers = A) => fetch(`${B}/api/artifacts/${id}/render?${new URLSearchParams(q)}`, { headers })
const out = process.env.RENDER_OUT; if (out) mkdirSync(out, { recursive: true })

const page = (h, body) => `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui;margin:0;background:#faf9f7}header{padding:24px 28px;background:#1c1b19;color:#fff}main{padding:24px 28px}button{padding:10px 16px;border-radius:8px;border:0;background:#c8553d;color:#fff}</style></head><body><header><h1 style="margin:0">${h}</h1></header><main>${body}</main></body></html>`
const canvas = {
  v: 3, title: 'Render test', launch: { view: 'canvas' },
  boards: { 'screens/Home.html': { x: 0, y: 0, w: 640, h: 420, title: 'Home' }, 'screens/Login.html': { x: 800, y: 40, w: 420, h: 380, title: 'Sign in' } },
  order: ['screens/Home.html', 'screens/Login.html'],
  notes: {
    n1: { kind: 'sticky', x: 0, y: -170, w: 260, text: 'Check the empty state and this long wrapping sentence, please <b>', fill: 'yellow' },
    n2: { kind: 'text', x: 320, y: -150, w: 420, text: 'Canvas title', size: 'l', bold: true },
    n3: { kind: 'rect', x: 0, y: 500, w: 220, h: 100, text: 'Label', fill: 'blue', roundness: 'round' },
    n4: { kind: 'arrow', x: 0, y: 0, w: 1, h: 1, bind: { start: { type: 'board', id: 'screens/Home.html' }, end: { type: 'board', id: 'screens/Login.html' } } },
    n5: { kind: 'pen', x: 800, y: 520, points: [[0, 0], [20, 30], [50, 10], [90, 40]], stroke: '#8b5cf6', strokeWidth: 4 },
  },
}
const created = await mcp('create_artifact', { title: 'Render test', files: [
  { path: 'canvas.json', content: JSON.stringify(canvas) },
  { path: 'screens/Home.html', content: page('Team lunch', '<p>Where should we eat on Friday?</p><button>Pizza</button>') },
  { path: 'screens/Login.html', content: page('Sign in', '<p>Forgot your password?</p>') },
] })
const id = created.id
const sig = (b) => b.readUInt32BE(0) === 0x89504e47 ? 'png' : b.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : ''

// formats
for (const f of ['png', 'webp', 'jpeg']) {
  const r = await get(id, { format: f, scale: '1' }); const b = Buffer.from(await r.arrayBuffer())
  ok(`${f}: 200, right content type and signature`, r.status === 200 && r.headers.get('content-type') === (f === 'jpeg' ? 'image/jpeg' : `image/${f}`) && sig(b) === f, [r.status, r.headers.get('content-type')])
  if (out) writeFileSync(`${out}/render.${f}`, b)
}
let r = await get(id, { format: 'svg' }); const svg = await r.text()
ok('svg: content type, nosniff and a sandbox CSP', r.headers.get('content-type').startsWith('image/svg+xml') && r.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(r.headers.get('content-security-policy')))
ok('svg: it is vector (text and shapes), has the board titles and no markup injection', svg.includes('<text') && svg.includes('>Home</text>') && svg.includes('please &lt;b&gt;') && !/<script|foreignObject/.test(svg), svg.slice(0, 300))
if (out) writeFileSync(`${out}/render.svg`, svg)
r = await get(id, { format: 'xml' }); const xml = await r.text()
ok('xml: scene document with boards and notes', r.headers.get('content-type').startsWith('application/xml') && xml.includes('<scene xmlns="urn:artifact-hub:scene:1"') && xml.includes('<board path="screens/Home.html"') && xml.includes('<note id="n1" kind="sticky"'), xml.slice(0, 200))
if (out) writeFileSync(`${out}/render.xml`, xml)

// options
r = await get(id, { format: 'png', scale: '2' }); let b = Buffer.from(await r.arrayBuffer())
const [w1, h1] = (await (await get(id, { format: 'png', scale: '1' })).headers.get('x-render-size')).split('x').map(Number)
const [w2, h2] = r.headers.get('x-render-size').split('x').map(Number)
ok('scale 2 doubles the pixel size (png header agrees)', Math.abs(w2 - 2 * w1) <= 2 && Math.abs(h2 - 2 * h1) <= 2 && b.readUInt32BE(16) === w2 && b.readUInt32BE(20) === h2, [w1, h1, w2, h2])
r = await get(id, { format: 'png', scale: '4', max: '300' }); b = Buffer.from(await r.arrayBuffer())
ok('max fits the longest edge', Math.max(b.readUInt32BE(16), b.readUInt32BE(20)) <= 300, [b.readUInt32BE(16), b.readUInt32BE(20)])
r = await get(id, { format: 'png', board: 'screens/Login.html' }); b = Buffer.from(await r.arrayBuffer())
ok('board renders just that board at its size', r.status === 200 && b.readUInt32BE(16) === 420 && b.readUInt32BE(20) === 380, [b.readUInt32BE(16), b.readUInt32BE(20)])
ok('a board render says whether the HTML was drawn', ['screenshot', 'outline'].includes(r.headers.get('x-render-boards')), r.headers.get('x-render-boards'))
if (out) writeFileSync(`${out}/render-board.png`, b)
r = await get(id, { format: 'png', background: 'transparent' }); b = Buffer.from(await r.arrayBuffer())
ok('transparent background gives an alpha png (colour type 6)', b[25] === 6, b[25])
r = await get(id, { format: 'png', theme: 'dark' }); b = Buffer.from(await r.arrayBuffer())
if (out) writeFileSync(`${out}/render-dark.png`, b)
ok('dark theme renders', r.status === 200 && sig(b) === 'png')

// errors
for (const [name, q, status] of [['unknown format', { format: 'gif' }, 400], ['bad scale', { scale: 'big' }, 400], ['bad background', { background: 'url(x)' }, 400], ['unknown board', { board: 'nope.html' }, 404], ['version in the future', { version: '99' }, 404], ['bad version', { version: '-1' }, 400]]) {
  r = await get(id, q); ok(`${name} -> ${status}`, r.status === status, r.status)
}
r = await get('does-not-exist', {}); ok('unknown artifact -> 404', r.status === 404, r.status)
r = await get(id, {}, {}); ok('no credentials -> 404 (does not reveal the artifact)', r.status === 404, r.status)
const giant = await get(id, { scale: '4', format: 'png', max: '99999' }); const gb = Buffer.from(await giant.arrayBuffer())
ok('absurd sizes are capped, not honoured', giant.status === 200 && gb.readUInt32BE(16) <= 8192 && gb.readUInt32BE(16) * gb.readUInt32BE(20) <= 36_000_000)

// caching and revalidation
r = await get(id, { format: 'svg' }); const etag = r.headers.get('etag')
const again = await get(id, { format: 'svg' }, { ...A, 'if-none-match': etag })
ok('ETag revalidation -> 304', again.status === 304 && !!etag, [again.status, etag])
ok('the live version is revalidated, not cached blindly', r.headers.get('cache-control').includes('no-cache'), r.headers.get('cache-control'))

// share links: view role may render, old versions are cacheable
const share = (await (await fetch(`${B}/api/artifacts/${id}/shares`, { method: 'POST', headers: { ...J, ...A }, body: JSON.stringify({ role: 'view' }) })).json()).token
r = await get(share, { format: 'png' }, {}); ok('share link renders without a login', r.status === 200 && sig(Buffer.from(await r.arrayBuffer())) === 'png', r.status)
await mcp('edit_file', { id, path: 'canvas.json', base_version: 1, edits: [{ old_text: '"Render test"', new_text: '"Render test v2"' }] })
r = await get(id, { format: 'xml', version: '1' }); ok('an old version stays renderable and is immutable-cached', r.status === 200 && r.headers.get('cache-control').includes('immutable') && (await r.text()).includes('title="Render test"'), r.headers.get('cache-control'))
r = await get(id, { format: 'xml' }); ok('the new live version is picked up', (await r.text()).includes('title="Render test v2"'))

// single page artifact + empty
const single = await mcp('create_artifact', { title: 'Page', files: [{ path: 'index.html', content: page('Just a page', '<p>Hello</p>') }] })
r = await get(single.id, { format: 'png', width: '800', height: '500' }); b = Buffer.from(await r.arrayBuffer())
ok('a single-page artifact renders at the page size', r.status === 200 && b.readUInt32BE(16) === 800 && b.readUInt32BE(20) >= 500, [r.status, b.readUInt32BE(16), b.readUInt32BE(20)])
if (out) writeFileSync(`${out}/render-page.png`, b)
const empty = await mcp('create_artifact', { title: 'Empty', files: [{ path: 'canvas.json', content: JSON.stringify({ v: 3, boards: {}, order: [], notes: {} }) }] })
r = await get(empty.id, { format: 'svg' }); ok('an empty canvas renders a placeholder', r.status === 200 && (await r.text()).includes('Empty canvas'))
const nothing = await mcp('create_artifact', { title: 'Data only', files: [{ path: 'readme.md', content: '# hi' }] }).catch(() => ({ error: 'x' }))
if (nothing.id) { r = await get(nothing.id, {}); ok('an artifact with neither canvas.json nor index.html -> 422', r.status === 422, r.status) }

// MCP
let m = await mcpRaw('render_artifact', { id, format: 'png', max: 600 })
ok('MCP render_artifact returns an image part plus a caption', m.content[0].type === 'image' && m.content[0].mimeType === 'image/png' && Buffer.from(m.content[0].data, 'base64').readUInt32BE(0) === 0x89504e47 && /boards:/.test(m.content[1].text), JSON.stringify(m).slice(0, 200))
m = await mcpRaw('render_artifact', { id, format: 'svg' })
ok('MCP svg comes back as text', m.content[0].type === 'text' && m.content[0].text.includes('<svg'))
m = await mcpRaw('render_artifact', { id, format: 'png', board: 'nope.html' })
ok('MCP errors are reported as errors', m.isError === true, JSON.stringify(m).slice(0, 200))
console.log(process.exitCode ? '\nFAILED' : '\nALL PASS')
