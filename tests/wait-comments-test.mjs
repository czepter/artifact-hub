const B = 'http://localhost:3111', A = { authorization: 'Bearer devtoken' }
const ok = (n, c, x = '') => console.log(c ? 'PASS' : 'FAIL', n, x)
const J = { 'content-type': 'application/json' }
const mcp = async (name, args) => { const r = await fetch(`${B}/mcp`, { method: 'POST', headers: { ...J, accept: 'application/json, text/event-stream', ...A }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); const t = await r.text(); const res = JSON.parse(t.match(/data: (.*)/)[1]).result; return JSON.parse(res.content[0].text) }

const { id } = await mcp('create_artifact', { title: 'Wait', files: [{ path: 'index.html', content: '<h1>x</h1>' }] })
const ref = (await mcp('share_link', { id, role: 'comment' })).url.split('/s/')[1]
const cookie = (await fetch(`${B}/api/identity`, { method: 'POST', headers: J, body: JSON.stringify({ email: 'ada@example.com' }) })).headers.getSetCookie().find(c => c.startsWith('hub_email=')).split(';')[0]
const post = body => fetch(`${B}/api/view/${ref}/comments`, { method: 'POST', headers: { ...J, cookie }, body: JSON.stringify({ body }) })

let t0 = Date.now()
let r = await mcp('wait_for_comments', { id, timeout_s: 1 })
ok('times out empty', r.comments.length === 0 && Date.now() - t0 >= 900, JSON.stringify(r))

t0 = Date.now()
const pending = mcp('wait_for_comments', { id, timeout_s: 20 })
await new Promise(r => setTimeout(r, 500))
await post('hello from the web')
r = await pending
ok('wakes on web comment', r.comments.length === 1 && r.comments[0].body === 'hello from the web' && Date.now() - t0 < 5000, JSON.stringify(r))

const since = r.next_since
const root = r.comments[0].id
await mcp('reply_comment', { id, comment_id: root, body: 'claude reply' })
r = await mcp('wait_for_comments', { id, since, timeout_s: 1 })
ok('own reply does not wake', r.comments.length === 0)

await post('second')
r = await mcp('wait_for_comments', { id, since, timeout_s: 1 })
ok('returns immediately for comments after since', r.comments.length === 1 && r.comments[0].body === 'second')
