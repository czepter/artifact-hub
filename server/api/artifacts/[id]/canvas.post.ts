import { requireEditor } from '../../../utils/auth'
import { CanvasError, applyCanvasOps, type Canvas, type CanvasOp } from '../../../../shared/canvasOps'
import { listFiles, publish, readFile, requireArtifact } from '../../../utils/store'

// Canvas-level edits (boards, notes, shapes, tweaks): replayed on canvas.json and published as one version.
export default defineEventHandler(async (event) => {
  requireEditor(event)
  const id = getRouterParam(event, 'id')!
  const b = await readBody<{ baseVersion?: number, ops?: CanvasOp[] }>(event)
  const a = requireArtifact(id)
  if (b.baseVersion !== a.current_version) {
    throw createError({ statusCode: 409, statusMessage: `Changed elsewhere (live version is ${a.current_version}). Reload and try again.` })
  }
  let current: Canvas | null = null
  const raw = readFile(id, a.current_version, 'canvas.json')
  if (raw) { try { current = JSON.parse(raw.content.toString('utf8')) } catch { throw createError({ statusCode: 422, statusMessage: 'canvas.json is not valid JSON' }) } }
  try {
    const r = applyCanvasOps(current, listFiles(id, a.current_version).map(f => f.path), b.ops as CanvasOp[])
    // duplicateBoard: the copy is byte for byte the source (a board added earlier in the same batch is still in addFiles).
    const copies = r.copyFiles.map((c) => {
      const fresh = r.addFiles.find(f => f.path === c.from)
      const src = fresh ? fresh.content : readFile(id, a.current_version, c.from)?.content.toString('utf8')
      if (src === undefined) throw new CanvasError(404, `The file of board ${c.from} is missing`)
      return { path: c.to, content: src }
    })
    const pub = publish({
      id, baseVersion: a.current_version,
      files: [{ path: 'canvas.json', content: JSON.stringify(r.canvas, null, 2) }, ...r.addFiles, ...copies],
      remove: r.removePaths, label: 'Canvas edit',
    })
    return { version: pub.version, added: [...r.addFiles, ...copies].map(f => f.path), removed: r.removePaths }
  } catch (e) {
    if (e instanceof CanvasError) throw createError({ statusCode: e.status, statusMessage: e.message })
    throw e
  }
})
