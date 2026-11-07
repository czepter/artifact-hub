import { requireEditor } from '../../utils/auth'
import { LIMITS, publish, cleanPath, type FileInput } from '../../utils/store'
import { readZip } from '../../utils/unzip'

// Import a .zip (for example a Design export from claude.ai, or one of our own exports) as a new artifact.
// Body: the raw zip bytes (Content-Type: application/zip). Query: ?title= overrides the name.
export default defineEventHandler(async (event) => {
  requireEditor(event)
  const declared = Number(getHeader(event, 'content-length') ?? 0)
  if (declared > 60 * 1024 * 1024) throw createError({ statusCode: 413, statusMessage: 'Upload too large (max 60 MB)' })
  const body = await readRawBody(event, false)
  if (!body?.length) throw createError({ statusCode: 400, statusMessage: 'Send the .zip as the request body' })

  const { entries, skipped } = readZip(body)
  const usable = entries.filter(e => !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(e.name) && !e.name.split('/').some(s => s === '..'))

  // Find the artifact root: the shallowest canvas.json, else the shallowest index.html. Everything outside it is dropped
  // (a Design export carries the editor's own files beside `project/`).
  const names = usable.map(e => e.name.replace(/\\/g, '/'))
  const depth = (n: string) => n.split('/').length
  const pick = (leaf: string) => names.filter(n => n === leaf || n.endsWith('/' + leaf)).sort((a, b) => depth(a) - depth(b))[0]
  const anchorFile = pick('canvas.json') ?? pick('index.html')
  if (!anchorFile) throw createError({ statusCode: 422, statusMessage: 'No canvas.json or index.html found in the archive' })
  const prefix = anchorFile.slice(0, anchorFile.length - anchorFile.split('/').pop()!.length)

  const files: FileInput[] = []
  const dropped: string[] = [...skipped]
  for (const e of usable) {
    const n = e.name.replace(/\\/g, '/')
    if (!n.startsWith(prefix)) { dropped.push(n); continue }
    const rel = n.slice(prefix.length)
    if (e.data.length > LIMITS.fileBytes) { dropped.push(`${rel} (over ${LIMITS.fileBytes / 1024 / 1024} MB)`); continue }
    try { cleanPath(rel) } catch { dropped.push(`${rel} (invalid path)`); continue }
    // Our own runtime always answers for support.js, so a runtime shipped inside an export is not stored.
    if (/(^|\/)support\.js$/.test(rel) && e.data.toString('utf8', 0, 400_000).includes('DCLogic')) { dropped.push(`${rel} (replaced by the built-in runtime)`); continue }
    files.push({ path: rel, content: e.data.toString('base64'), encoding: 'base64' })
  }

  let title = String(getQuery(event).title ?? '').trim()
  const canvas = files.find(f => f.path === 'canvas.json')
  if (!title && canvas) { try { title = String(JSON.parse(Buffer.from(canvas.content, 'base64').toString('utf8')).title ?? '').trim() } catch {} }
  const r = publish({ title: (title || 'Imported artifact').slice(0, 200), files, label: 'Imported .zip' })
  return { ...r, url: `/a/${r.id}`, files: files.length, dropped }
})
