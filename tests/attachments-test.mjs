// Pasted files in comments: stage, post, serve, MCP. Needs a dev server: PORT=3111 npm run dev:login
const B = 'http://localhost:3111', A = { authorization: 'Bearer devtoken' }
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, x); if (!c) process.exitCode = 1 }
const J = { 'content-type': 'application/json' }
const mcpRaw = async (name, args) => { const r = await fetch(`${B}/mcp`, { method: 'POST', headers: { ...J, accept: 'application/json, text/event-stream', ...A }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); return JSON.parse((await r.text()).match(/data: (.*)/)[1]).result }
const mcp = async (n, a) => JSON.parse((await mcpRaw(n, a)).content[0].text)

const { id } = await mcp('create_artifact', { title: 'Att', files: [{ path: 'index.html', content: '<h1>x</h1>' }] })
const ref = (await mcp('share_link', { id, role: 'comment' })).url.split('/s/')[1]
const viewRef = (await mcp('share_link', { id, role: 'view' })).url.split('/s/')[1]
const cookie = (await fetch(`${B}/api/identity`, { method: 'POST', headers: J, body: JSON.stringify({ email: 'ada@example.com' }) })).headers.getSetCookie().find(c => c.startsWith('hub_email=')).split(';')[0]
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const up = (r, body, type, name, c = cookie) => fetch(`${B}/api/view/${r}/attachments`, { method: 'POST', headers: { 'content-type': type, 'x-filename': encodeURIComponent(name), cookie: c }, body })
const post = (b) => fetch(`${B}/api/view/${ref}/comments`, { method: 'POST', headers: { ...J, cookie }, body: JSON.stringify(b) })

ok('view-only link cannot upload', (await up(viewRef, png, 'image/png', 'a.png')).status === 403)
ok('no e-mail cannot upload', (await up(ref, png, 'image/png', 'a.png', '')).status === 401)
const img = await (await up(ref, png, 'image/png', 'shot ü.png')).json()
const svg = await (await up(ref, '<svg onload="alert(1)"/>', 'image/svg+xml', 'x.svg')).json()
ok('staged', img.id && img.size === png.length && img.name === 'shot ü.png', JSON.stringify(img))

ok('empty comment rejected', (await post({ body: '' })).status === 400)
ok('unknown attachment rejected', (await post({ body: 'x', attachmentIds: ['nope'] })).status === 400)
const r = await post({ body: '', attachmentIds: [img.id, svg.id] })
ok('image-only comment posts', r.status === 200)
ok('attachment cannot be reused', (await post({ body: 'again', attachmentIds: [img.id] })).status === 400)

const view = await (await fetch(`${B}/api/view/${ref}`, { headers: { cookie } })).json()
const c = view.comments[0]
ok('listed on comment', c.attachments.length === 2 && c.attachments[0].id === img.id, JSON.stringify(c.attachments))

const g = await fetch(`${B}/api/view/${viewRef}/attachments/${img.id}`)
ok('served inline to view link', g.status === 200 && g.headers.get('content-type') === 'image/png' && g.headers.get('content-disposition').startsWith('inline') && Buffer.from(await g.arrayBuffer()).equals(png))
const gs = await fetch(`${B}/api/view/${ref}/attachments/${svg.id}`)
ok('svg is a download, not rendered', gs.headers.get('content-type') === 'application/octet-stream' && gs.headers.get('content-disposition').startsWith('attachment') && gs.headers.get('x-content-type-options') === 'nosniff')

const other = (await mcp('create_artifact', { title: 'Other', files: [{ path: 'index.html', content: 'o' }] })).id
const otherRef = (await mcp('share_link', { id: other, role: 'view' })).url.split('/s/')[1]
ok('not readable through another artifact', (await fetch(`${B}/api/view/${otherRef}/attachments/${img.id}`)).status === 404)

const big = await up(ref, Buffer.alloc(11 * 1024 * 1024), 'application/octet-stream', 'big.bin')
ok('over 10 MB rejected', big.status === 413)

const rc = await mcp('read_comments', { id })
ok('mcp read_comments lists attachments', rc[0].attachments.length === 2)
const raw = await mcpRaw('read_comment_attachment', { id, attachment_id: img.id })
ok('mcp returns the image', raw.content[0].type === 'image' && raw.content[0].mimeType === 'image/png' && raw.content[0].data === png.toString('base64'))
