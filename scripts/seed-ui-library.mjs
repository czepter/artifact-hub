// Publishes ui-library/ into its own hub workspace: tokens + component CSS as the workspace's shared files
// (live links, `_shared/css/*.css`), and one artifact whose boards show every component.
// Idempotent: re-running updates the shared files and publishes a new version of the same artifact.
//   HUB=http://localhost:3000 HUB_TOKEN=<bearer token> node scripts/seed-ui-library.mjs
import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HUB = process.env.HUB ?? 'http://localhost:3000'
const TOKEN = process.env.HUB_TOKEN ?? 'devtoken'
const WORKSPACE = process.env.UI_WORKSPACE ?? 'UI Library'
const TITLE = 'Artifact Hub UI library'
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui-library')

const api = async (method, path, body) => {
  const r = await fetch(`${HUB}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text(); let b; try { b = t ? JSON.parse(t) : null } catch { b = t }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${typeof b === 'string' ? b : JSON.stringify(b)}`)
  return b
}
const read = (p) => readFile(join(root, p), 'utf8')

const workspaces = await api('GET', '/api/workspaces')
const ws = workspaces.find(w => w.name === WORKSPACE) ?? await api('POST', '/api/workspaces', { name: WORKSPACE, description: 'Artifact Hub components as plain CSS + boards, for design review and optimisation.', icon: 'layout-grid' })

for (const f of ['css/tokens.css', 'css/components.css']) await api('PUT', `/api/workspaces/${ws.id}/files/${f}`, { content: await read(f) })

const boards = (await readdir(join(root, 'boards'))).filter(f => f.endsWith('.html'))
const files = [{ path: 'canvas.json', content: await read('canvas.json') }, ...await Promise.all(boards.map(async f => ({ path: `boards/${f}`, content: await read(`boards/${f}`) })))]

const mcp = async (name, args) => {
  const r = await fetch(`${HUB}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
  const t = await r.text(); const res = JSON.parse(t.match(/data: (.*)/)?.[1] ?? t).result
  if (res.isError) throw new Error(res.content[0].text)
  return JSON.parse(res.content[0].text)
}

const existing = (await api('GET', `/api/artifacts?workspace=${ws.id}`)).find(a => a.title === TITLE)
let id, version
if (existing) {
  const cur = await mcp('get_artifact', { id: existing.id })
  const r = await mcp('publish_files', { id: existing.id, base_version: cur.version ?? cur.current_version, files, label: 'Sync from ui-library/' })
  id = existing.id; version = r.version
} else {
  const a = await api('POST', '/api/artifacts', { title: TITLE, files, workspaceId: ws.id }); id = a.id; version = 1
}
console.log(JSON.stringify({ workspace: ws.id, artifact: id, version, boards: boards.length, open: `${HUB}/a/${id}` }))
