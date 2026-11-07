// Run against a dev server with the development login: PORT=3111 npm run dev:login (HUB_DB should be a scratch file).
const B = process.env.HUB ?? 'http://localhost:3111', A = { authorization: 'Bearer devtoken' }
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x) }
const J = { 'content-type': 'application/json' }
const api = async (method, path, body) => { const r = await fetch(`${B}${path}`, { method, headers: { ...J, ...A }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null } }
const mcp = async (name, args) => { const r = await fetch(`${B}/mcp`, { method: 'POST', headers: { ...J, accept: 'application/json, text/event-stream', ...A }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); const t = await r.text(); const m = t.match(/data: (.*)/); const res = JSON.parse(m[1]).result; const txt = res.content[0].text; return res.isError ? { error: txt } : JSON.parse(txt) }
const page = (t) => [{ path: 'index.html', content: `<!doctype html><title>${t}</title><h1>${t}</h1>` }]
const tag = Math.random().toString(36).slice(2, 7)

// default workspace exists and holds pre-existing artifacts
let r = await api('GET', '/api/workspaces')
const def = r.body.find(w => w.isDefault)
ok('default workspace exists', r.status === 200 && def && def.id === 'default', JSON.stringify(r.body))
const before = (await api('GET', '/api/artifacts')).body
ok('every artifact has a workspace', before.every(a => typeof a.workspace_id === 'string'))

// create / validate / unique
r = await api('POST', '/api/workspaces', { name: `Brand ${tag}`, description: 'Tokens later', color: '#0d6fd6' })
const brand = r.body
ok('create workspace', r.status === 200 && brand.name === `Brand ${tag}` && brand.artifactCount === 0 && brand.color === '#0d6fd6', JSON.stringify(r.body))
ok('duplicate name (case-insensitive) is 409', (await api('POST', '/api/workspaces', { name: `brand ${tag}` })).status === 409)
ok('empty name is 400', (await api('POST', '/api/workspaces', { name: '  ' })).status === 400)
ok('bad colour is 400', (await api('POST', '/api/workspaces', { name: `x${tag}`, color: 'red' })).status === 400)

// create artifacts in workspaces (API and MCP, by id and by name)
r = await api('POST', '/api/artifacts', { title: `Landing ${tag}`, files: page('a'), workspaceId: brand.id })
const landing = r.body.id
ok('API create into workspace', r.status === 200)
const viaMcp = await mcp('create_artifact', { title: `Poster ${tag}`, files: page('b'), workspace: `BRAND ${tag}` })
ok('MCP create into workspace by name', !!viaMcp.id, JSON.stringify(viaMcp))
const dflt = await mcp('create_artifact', { title: `Loose ${tag}`, files: page('c') })
ok('no workspace -> default', (await mcp('get_artifact', { id: dflt.id })).workspace.id === 'default')
ok('unknown workspace in MCP create is an error', !!(await mcp('create_artifact', { title: 'z', files: page('d'), workspace: 'nope-' + tag })).error)

// filters
const inBrand = (await api('GET', `/api/artifacts?workspace=${brand.id}`)).body
ok('API filter by id', inBrand.length === 2 && inBrand.every(a => a.workspace_id === brand.id), inBrand.map(a => a.title).join())
ok('API filter by name', (await api('GET', `/api/artifacts?workspace=${encodeURIComponent('brand ' + tag)}`)).body.length === 2)
ok('API filter unknown workspace 404', (await api('GET', '/api/artifacts?workspace=nope')).status === 404)
ok('MCP list_artifacts filter', (await mcp('list_artifacts', { workspace: brand.id })).length === 2)
ok('MCP list_artifacts unfiltered sees all', (await mcp('list_artifacts', {})).length === before.length + 3)
ok('MCP list_workspaces counts', (await mcp('list_workspaces', {})).find(w => w.id === brand.id).artifactCount === 2)

// rename / update
r = await api('PATCH', `/api/workspaces/${brand.id}`, { name: `Brand2 ${tag}`, description: 'x' })
ok('rename workspace', r.status === 200 && r.body.name === `Brand2 ${tag}` && r.body.color === '#0d6fd6', JSON.stringify(r.body))
const other = (await mcp('create_workspace', { name: `Other ${tag}` }))
ok('MCP create_workspace', other.name === `Other ${tag}`, JSON.stringify(other))
ok('rename to a taken name is 409', (await api('PATCH', `/api/workspaces/${other.id}`, { name: `brand2 ${tag}` })).status === 409)

// move
ok('move via PATCH', (await api('PATCH', `/api/artifacts/${landing}`, { workspaceId: other.id })).status === 200)
ok('moved artifact is in the new workspace', (await api('GET', `/api/artifacts?workspace=${other.id}`)).body.some(a => a.id === landing))
ok('move to unknown workspace 404, artifact stays', (await api('PATCH', `/api/artifacts/${landing}`, { workspaceId: 'nope' })).status === 404 && (await mcp('get_artifact', { id: landing })).workspace.id === other.id)
ok('MCP move_artifact', (await mcp('move_artifact', { id: landing, workspace: `Brand2 ${tag}` })).ok === true)
ok('view API reports the workspace', (await api('GET', `/api/view/${landing}`)).body.artifact.workspaceId === brand.id)
const dup = (await api('POST', `/api/artifacts/${landing}/duplicate`)).body
ok('duplicate stays in the workspace', (await mcp('get_artifact', { id: dup.id })).workspace.id === brand.id)

// delete rules
r = await api('DELETE', `/api/workspaces/${brand.id}`)
ok('deleting a non-empty workspace is refused (409)', r.status === 409 && /Move them/.test(r.body.statusMessage ?? r.body.message ?? ''), JSON.stringify(r.body))
ok('default workspace cannot be deleted', (await api('DELETE', '/api/workspaces/default')).status === 409)
for (const a of (await api('GET', `/api/artifacts?workspace=${brand.id}`)).body) await api('PATCH', `/api/artifacts/${a.id}`, { workspaceId: 'default' })
ok('empty workspace can be deleted', (await api('DELETE', `/api/workspaces/${brand.id}`)).status === 200)
ok('deleted workspace is gone', !(await api('GET', '/api/workspaces')).body.some(w => w.id === brand.id))
ok('artifacts survived the move', (await mcp('get_artifact', { id: landing })).workspace.id === 'default')

// settings column (extension point) exists and round-trips through the util-free API shape
ok('workspace payload does not leak internals', !('settings' in def))

// cleanup
for (const id of [landing, dup.id, viaMcp.id, dflt.id]) await api('DELETE', `/api/artifacts/${id}`)
await api('DELETE', `/api/workspaces/${other.id}`)
if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')
