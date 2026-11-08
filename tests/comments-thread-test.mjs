const B = process.env.HUB || 'http://localhost:3122', A = { authorization: 'Bearer devtoken' }
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1 }
const J = { 'content-type': 'application/json' }
const mcp = async (name, args) => { const r = await fetch(`${B}/mcp`, { method: 'POST', headers: { ...J, accept: 'application/json, text/event-stream', ...A }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); const t = await r.text(); const res = JSON.parse(t.match(/data: (.*)/)[1]).result; return JSON.parse(res.content[0].text) }

const { id } = await mcp('create_artifact', { title: 'Thread test', files: [{ path: 'index.html', content: '<h1>x</h1>' }] })
const ref = (await mcp('share_link', { id, role: 'comment' })).url.split('/s/')[1]
const cookie = (await fetch(`${B}/api/identity`, { method: 'POST', headers: J, body: JSON.stringify({ email: 'ada@example.com' }) })).headers.getSetCookie().find(c => c.startsWith('hub_email=')).split(';')[0]
const post = (body, extra = {}) => fetch(`${B}/api/view/${ref}/comments`, { method: 'POST', headers: { ...J, cookie }, body: JSON.stringify({ body, ...extra }) }).then(r => r.json())
const get = (tid, headers = A) => fetch(`${B}/api/comments/${tid}`, { headers })

const anchor = { selector: 'h1', tag: 'h1', text: 'x', rel: { x: 0.5, y: 0.5 }, click: { x: 4, y: 4 } }
const root = (await post('first', { board: 'index.html', anchor })).id
await mcp('reply_comment', { id, comment_id: root, body: 'claude says hi' })
const reply = (await post('thanks', { parentId: root })).id

let r = await get(root)
const t = await r.json()
ok('200 for a thread root', r.status === 200)
ok('artifact title and id', t.artifact.id === id && t.artifact.title === 'Thread test', JSON.stringify(t.artifact))
ok('messages in order', t.messages.map(m => m.body).join('|') === 'first|claude says hi|thanks', JSON.stringify(t.messages))
ok('author kinds', t.messages[0].author_kind === 'person' && t.messages[1].author_kind === 'model' && t.messages[0].author_email === 'ada@example.com')
ok('board, anchor, version', t.board === 'index.html' && t.anchor?.selector === 'h1' && typeof t.version === 'number')
ok('attachments array', Array.isArray(t.messages[0].attachments))
ok('unresolved flag', t.resolved === 0)

ok('reply id is not a thread', (await get(reply)).status === 404)
ok('unknown id is 404', (await get('nope')).status === 404)

await fetch(`${B}/api/view/${id}/comments/${root}/resolve`, { method: 'POST', headers: { ...J, ...A }, body: JSON.stringify({ resolved: true }) })
ok('resolved reflected', (await (await get(root)).json()).resolved === 1)
