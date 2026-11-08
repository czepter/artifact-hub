// Run against a dev server with the development login: PORT=3111 HUB_DB=<scratch> npm run dev:login
const B = process.env.HUB ?? 'http://localhost:3111', A = { authorization: 'Bearer devtoken' }
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x) }
const J = { 'content-type': 'application/json' }
const api = async (method, path, body) => { const r = await fetch(`${B}${path}`, { method, headers: { ...J, ...A }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null } catch { b = t } return { status: r.status, body: b } }
const mcp = async (name, args) => { const r = await fetch(`${B}/mcp`, { method: 'POST', headers: { ...J, accept: 'application/json, text/event-stream', ...A }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); const t = await r.text(); const m = t.match(/data: (.*)/); const res = JSON.parse(m[1]).result; const txt = res.content[0].text; if (res.isError) return { error: txt }; try { return JSON.parse(txt) } catch { return txt } }
const tag = Math.random().toString(36).slice(2, 7)
const html = (t) => `<!doctype html><link rel="stylesheet" href="_shared/css/tokens.css"><h1>${t}</h1>`

const w1 = (await api('POST', '/api/workspaces', { name: `Lib ${tag}` })).body
const w2 = (await api('POST', '/api/workspaces', { name: `Other ${tag}` })).body
const a1 = (await api('POST', '/api/artifacts', { title: `A ${tag}`, files: [{ path: 'index.html', content: html('a') }, { path: 'css/local.css', content: 'body{color:red}' }], workspaceId: w1.id })).body
const a2 = (await api('POST', '/api/artifacts', { title: `B ${tag}`, files: [{ path: 'index.html', content: html('b') }], workspaceId: w1.id })).body
const a3 = (await api('POST', '/api/artifacts', { title: `C ${tag}`, files: [{ path: 'index.html', content: html('c') }], workspaceId: w2.id })).body
const frame = async (art, path) => { const v = (await api('GET', `/api/view/${art}`)).body; return { v, r: await fetch(`${B}${v.frameBase}${path}`) } }

// empty library
let r = await api('GET', `/api/workspaces/${w1.id}/files`)
ok('empty library', r.status === 200 && r.body.files.length === 0 && r.body.rev === 0, JSON.stringify(r.body))
ok('missing shared file is 404 in the frame', (await frame(a1.id, '_shared/css/tokens.css')).r.status === 404)

// write, then it serves in both artifacts of the workspace but not in another workspace
r = await api('PUT', `/api/workspaces/${w1.id}/files/css/tokens.css`, { content: ':root{--brand:#0d6fd6}' })
ok('PUT creates', r.status === 200 && r.body.ref === '_shared/css/tokens.css' && r.body.contentType.startsWith('text/css'), JSON.stringify(r.body))
let f = await frame(a1.id, '_shared/css/tokens.css')
ok('served to artifact 1', f.r.status === 200 && (await f.r.text()).includes('--brand') && (f.r.headers.get('content-type') ?? '').startsWith('text/css'))
ok('served to artifact 2', (await (await frame(a2.id, '_shared/css/tokens.css')).r.text()).includes('--brand'))
ok('not served across workspaces', (await frame(a3.id, '_shared/css/tokens.css')).r.status === 404)
ok('view data carries sharedRev', f.v.sharedRev === 1, String(f.v.sharedRev))

// live: replace bumps rev and content
await api('PUT', `/api/workspaces/${w1.id}/files/_shared/css/tokens.css`, { content: ':root{--brand:#c4281c}' })
f = await frame(a2.id, '_shared/css/tokens.css')
ok('update is live for other artifacts', (await f.r.text()).includes('#c4281c') && f.v.sharedRev === 2)
r = await api('GET', `/api/workspaces/${w1.id}/files`)
ok('list shows rev 2 and ref', r.body.files.length === 1 && r.body.files[0].rev === 2 && r.body.files[0].ref === '_shared/css/tokens.css')
ok('read source', (await api('GET', `/api/workspaces/${w1.id}/files/css/tokens.css`)).body.source.includes('#c4281c'))

// reserved prefix and path safety
ok('artifact cannot publish under _shared/', (await api('POST', '/api/artifacts', { title: 'x', files: [{ path: 'index.html', content: 'x' }, { path: '_shared/a.css', content: 'x' }] })).status === 400)
// in-place edit: PATCH and MCP edit_shared_file
const sfile = `/api/workspaces/${w1.id}/files/css/tokens.css`
r = await api('PATCH', sfile, { edits: [{ old_text: '#c4281c', new_text: '#123456' }] })
ok('PATCH edits in place', r.status === 200 && r.body.ref === '_shared/css/tokens.css', JSON.stringify(r.body))
ok('edit is live', (await (await frame(a1.id, '_shared/css/tokens.css')).r.text()) === ':root{--brand:#123456}')
r = await api('PATCH', sfile, { edits: [{ old_text: '#123456', new_text: '#abcdef' }, { old_text: 'nope', new_text: 'x' }] })
ok('failed edit applies nothing', r.status === 422 && (await (await frame(a1.id, '_shared/css/tokens.css')).r.text()) === ':root{--brand:#123456}', JSON.stringify(r.body))
ok('missing file 404', (await api('PATCH', `/api/workspaces/${w1.id}/files/css/none.css`, { edits: [{ old_text: 'a', new_text: 'b' }] })).status === 404)
ok('bad body 400', (await api('PATCH', sfile, { edits: [] })).status === 400)
let m = await mcp('edit_shared_file', { workspace: w1.id, path: 'css/tokens.css', edits: [{ old_text: '#123456', new_text: '#0a0b0c' }] })
ok('MCP edit_shared_file', m.ok === true && (await (await frame(a2.id, '_shared/css/tokens.css')).r.text()).includes('#0a0b0c'), JSON.stringify(m))

ok('traversal refused', (await api('PUT', `/api/workspaces/${w1.id}/files/..%2Fx.css`, { content: 'x' })).status === 400)
ok('encoded traversal refused', (await api('PUT', `/api/workspaces/${w1.id}/files/css%2F..%2F..%2Fx.css`, { content: 'x' })).status === 400)
ok('a name with a space round-trips', (await api('PUT', `/api/workspaces/${w1.id}/files/my%20font.css`, { content: 'a{}' })).body?.path === 'my font.css')
await api('DELETE', `/api/workspaces/${w1.id}/files/my%20font.css`)
ok('content must be a string', (await api('PUT', `/api/workspaces/${w1.id}/files/x.css`, { content: 5 })).status === 400)
ok('unknown workspace 404', (await api('GET', '/api/workspaces/nope/files')).status === 404)

// promote a file out of an artifact
r = await api('POST', `/api/artifacts/${a1.id}/share-file`, { files: [{ path: 'css/local.css', as: 'css/promoted.css' }] })
ok('share-file copies into the library', r.status === 200 && r.body.shared[0].ref === '_shared/css/promoted.css', JSON.stringify(r.body))
ok('promoted file is served to a sibling artifact', (await (await frame(a2.id, '_shared/css/promoted.css')).r.text()).includes('color:red'))
ok('missing source file is 404', (await api('POST', `/api/artifacts/${a1.id}/share-file`, { files: [{ path: 'nope.css' }] })).status === 404)

// MCP
ok('MCP list_shared_files', (await mcp('list_shared_files', { workspace: `lib ${tag}` })).files.length === 2)
ok('MCP read_shared_file', (await mcp('read_shared_file', { workspace: w1.id, path: '_shared/css/tokens.css' })).includes('#0a0b0c'))
const wr = await mcp('write_shared_files', { workspace: w1.id, files: [{ path: 'js/menu.js', content: 'console.log(1)' }], remove: ['css/promoted.css'] })
ok('MCP write_shared_files writes and removes', wr.written[0] === '_shared/js/menu.js' && wr.removed[0] === '_shared/css/promoted.css', JSON.stringify(wr))
ok('MCP read_file resolves _shared/', (await mcp('read_file', { id: a1.id, path: '_shared/js/menu.js' })).includes('console.log'))
const ga = await mcp('get_artifact', { id: a1.id })
ok('get_artifact lists shared files', ga.shared_files.map(x => x.ref).sort().join() === '_shared/css/tokens.css,_shared/js/menu.js', JSON.stringify(ga.shared_files))
ok('MCP share_file', (await mcp('share_file', { id: a1.id, files: [{ path: 'css/local.css' }] })).shared[0] === '_shared/css/local.css')

// export carries only referenced shared files
const zip = Buffer.from(await (await fetch(`${B}/api/artifacts/${a1.id}/export`, { headers: A })).arrayBuffer())
ok('zip contains the referenced shared file', zip.includes(Buffer.from('_shared/css/tokens.css')) && !zip.includes(Buffer.from('_shared/js/menu.js')))

// delete + cascade with the workspace
ok('DELETE removes', (await api('DELETE', `/api/workspaces/${w1.id}/files/css/tokens.css`)).status === 200 && (await frame(a1.id, '_shared/css/tokens.css')).r.status === 404)
ok('DELETE of a missing file is 404', (await api('DELETE', `/api/workspaces/${w1.id}/files/css/tokens.css`)).status === 404)
for (const a of [a1, a2]) await api('DELETE', `/api/artifacts/${a.id}`)
ok('workspace deletes with files in it', (await api('DELETE', `/api/workspaces/${w1.id}`)).status === 200)
await api('DELETE', `/api/artifacts/${a3.id}`); await api('DELETE', `/api/workspaces/${w2.id}`)
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
