// Run against a dev server with the development login: PORT=3112 HUB_DB=<scratch> npm run dev:login
// Needs `npx tsx` for the shared fixture: npx tsx tests/import-test.mjs
import { BOARDS, doc, savedPage } from './fixtures/appifact.ts'
const B = process.env.HUB ?? 'http://localhost:3112', A = { authorization: 'Bearer devtoken' }
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 500)) }
const J = { 'content-type': 'application/json' }
const api = async (method, path, body) => { const r = await fetch(`${B}${path}`, { method, headers: { ...J, ...A }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null } catch { b = t } return { status: r.status, body: b } }
const mcp = async (name, args) => { const r = await fetch(`${B}/mcp`, { method: 'POST', headers: { ...J, accept: 'application/json, text/event-stream', ...A }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); const t = await r.text(); const m = t.match(/data: (.*)/); const res = JSON.parse(m[1]).result; const txt = res.content[0].text; if (res.isError) return { error: txt }; try { return JSON.parse(txt) } catch { return txt } }
const put = async (url, body) => { const r = await fetch(url, { method: 'PUT', body }); const t = await r.text(); let b = null; try { b = JSON.parse(t) } catch { b = t } return { status: r.status, body: b } }
const tag = Math.random().toString(36).slice(2, 7)
const src = `https://claude.ai/artifacts/${tag}`
const files = async (id) => (await api('GET', `/api/view/${id}`)).body

// 1. dry run: report, nothing created
const before = (await mcp('list_artifacts', {})).length
let l = await mcp('request_import', { source_url: src, source_version: 'v1', dry_run: true })
ok('request_import returns a link and a curl command', l.upload_url?.includes('/api/import/upload/imp_') && l.curl.includes('--data-binary') && l.max_bytes === 16 * 1024 * 1024, l)
ok('link expires within 60 minutes', Date.parse(l.expires_at) - Date.now() <= 3600_000 + 1000)
let r = await put(l.upload_url, savedPage())
ok('dry run reports the import but creates nothing', r.status === 200 && r.body.status === 'imported' && r.body.dry_run && r.body.action === 'created' && r.body.boards === 4 && !r.body.artifact_id && (await mcp('list_artifacts', {})).length === before, r)
ok('link is single-use', (await put(l.upload_url, savedPage())).status === 410)
ok('unknown link is 404', (await put(`${B}/api/import/upload/imp_nope`, 'x')).status === 404)

// 2. real run
l = await mcp('request_import', { source_url: src, source_version: 'v1' })
r = await put(l.upload_url, savedPage())
ok('import creates the artifact', r.status === 200 && r.body.status === 'imported' && r.body.action === 'created' && r.body.artifact_id && r.body.hub_url.includes(`/a/${r.body.artifact_id}`), r)
const id = r.body.artifact_id
ok('exactly one artifact more', (await mcp('list_artifacts', {})).length === before + 1)
const cj = await mcp('read_file', { id, path: 'canvas.json' })
ok('boards sit at the original coordinates', BOARDS.every(b => { const o = cj.boards[b.file]; return o?.x === b.x && o?.y === b.y && o?.w === b.w && o?.h === b.h }), cj.boards)

// 3. boards render with the built-in runtime
const view = await files(id)
const board = await fetch(`${B}${view.frameBase}screens/vitals.dc.html`)
const boardHtml = await board.text()
ok('a board is served with the runtime script and the editor bridge, original content intact', board.status === 200 && boardHtml.includes('<script src="./support.js"></script>') && boardHtml.includes('data-hub-bridge') && boardHtml.includes('Vitals'), boardHtml.slice(0, 300))
const sup = await fetch(`${B}${view.frameBase}screens/support.js`)
const supText = await sup.text()
ok('./support.js answers with the built-in runtime (DCLogic, React)', sup.status === 200 && supText.includes('DCLogic') && supText.includes('React'), sup.status)
ok('no copy of support.js is stored in the artifact', !view.files.some(f => /support\.js$/.test(f.path)), view.files)

// 4. second run: zero duplicates
let l2 = await mcp('request_import', { source_url: src, source_version: 'v1' })
ok('same version: skipped without a link', l2.skipped?.status === 'skipped' && !l2.upload_url && l2.skipped.artifact_id === id, l2)
ok('still one artifact more', (await mcp('list_artifacts', {})).length === before + 1)

// 5. new version of the source: new hub version, same artifact
l = await mcp('request_import', { source_url: src, source_version: 'v2' })
const d2 = doc({ title: 'Rankheld v2' }); r = await put(l.upload_url, savedPage(d2))
ok('new source version adds a hub version to the same artifact', r.body.status === 'imported' && r.body.action === 'updated' && r.body.artifact_id === id && r.body.hub_version === 2, r)
ok('still one artifact more after the update', (await mcp('list_artifacts', {})).length === before + 1)

// 6. failure is isolated and leaves nothing behind
l = await mcp('request_import', { source_url: `${src}-bad`, source_version: 'v1' })
r = await put(l.upload_url, savedPage(doc({}, { artboards: [{ ...BOARDS[0], w: 9000 }] })))
ok('invalid artifact fails with a reason', r.body.status === 'failed' && /out of range/.test(r.body.reason), r)
ok('failed import created nothing', (await mcp('list_artifacts', {})).length === before + 1)
l = await mcp('request_import', { source_url: `${src}-bad`, source_version: 'v1' })
r = await put(l.upload_url, savedPage())
ok('a failed source can be retried and imports', r.body.status === 'imported', r)

// 7. size limit and empty body keep the link usable
l = await mcp('request_import', { source_url: `${src}-big`, source_version: 'v1' })
ok('over 16 MB is refused', (await put(l.upload_url, Buffer.alloc(16 * 1024 * 1024 + 10, 'a'))).status === 413)
ok('empty body is refused', (await put(l.upload_url, '')).status === 400)
r = await put(l.upload_url, '<!doctype html><h1>plain</h1><script>window.claude.complete("x")</script>')
ok('after a refused upload the link still works; plain page becomes index.html with warnings', r.body.status === 'imported' && r.body.kind === 'page' && r.body.warnings.length === 2, r)

// 8. report
const rep = await mcp('list_imports', {})
const mine = rep.rows.filter(x => x.source.includes(tag))
const real = mine.filter(x => !x.dry_run)
ok('list_imports: one row per source, latest request wins', real.length === 3 && real.find(x => x.source === src).action === 'updated' && real.find(x => x.source === `${src}-bad`).status === 'imported' && real.find(x => x.source === `${src}-big`).status === 'imported', real)
ok('failed requests are reported with their reason (filter by status)', (await mcp('list_imports', { status: 'failed' })).rows.every(x => x.reason))
ok('dry runs are listed separately', mine.filter(x => x.dry_run).length === 1 && rep.counts.dry_run_imported >= 1, rep.counts)
ok('unauthenticated request_import is refused', (await fetch(`${B}/mcp`, { method: 'POST', headers: { ...J, accept: 'application/json, text/event-stream' }, body: '{}' })).status === 401)
console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0)
