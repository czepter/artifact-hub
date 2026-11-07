import { requireEditor } from '../../../utils/auth'
import { createHash } from 'node:crypto'
import { ASSET_PATH, CanvasError, MAX_IMAGE_BYTES, applyCanvasOps, type Canvas, type CanvasOp } from '../../../../shared/canvasOps'
import { listFiles, publish, readFile, requireArtifact } from '../../../utils/store'

// Canvas-level edits (boards, notes, shapes, tweaks): replayed on canvas.json and published as one version.
export default defineEventHandler(async (event) => {
  requireEditor(event)
  const id = getRouterParam(event, 'id')!
  const b = await readBody<{ baseVersion?: number, ops?: CanvasOp[], files?: { path: string, content: string }[] }>(event)
  const a = requireArtifact(id)
  if (b.baseVersion !== a.current_version) {
    throw createError({ statusCode: 409, statusMessage: `Changed elsewhere (live version is ${a.current_version}). Reload and try again.` })
  }
  // Images arrive with the operation that places them, so adding one is a single save and a single undo step.
  const uploads = imageUploads(b.files)
  let current: Canvas | null = null
  const raw = readFile(id, a.current_version, 'canvas.json')
  if (raw) { try { current = JSON.parse(raw.content.toString('utf8')) } catch { throw createError({ statusCode: 422, statusMessage: 'canvas.json is not valid JSON' }) } }
  try {
    // (pictures uploaded with this edit count as present: the shared validator checks that an added or re-sourced image has its file)
    const r = applyCanvasOps(current, [...listFiles(id, a.current_version).map(f => f.path), ...uploads.map(u => u.path)], b.ops as CanvasOp[])
    // duplicateBoard: the copy is byte for byte the source (a board added earlier in the same batch is still in addFiles).
    // (a source may be a board added, or copied, earlier in the same batch; copies keep the exact bytes)
    const made = new Map<string, string>(r.addFiles.map(f => [f.path, Buffer.from(f.content, 'utf8').toString('base64')]))
    const copies = r.copyFiles.map((c) => {
      const src = made.get(c.from) ?? readFile(id, a.current_version, c.from)?.content.toString('base64')
      if (src === undefined) throw new CanvasError(404, `The file of board ${c.from} is missing`)
      made.set(c.to, src)
      return { path: c.to, content: src, encoding: 'base64' as const }
    })
    const pub = publish({
      id, baseVersion: a.current_version,
      files: [{ path: 'canvas.json', content: JSON.stringify(r.canvas, null, 2) }, ...r.addFiles, ...copies, ...uploads],
      remove: r.removePaths, label: 'Canvas edit',
    })
    return { version: pub.version, added: [...r.addFiles, ...copies].map(f => f.path), removed: r.removePaths }
  } catch (e) {
    if (e instanceof CanvasError) throw createError({ statusCode: e.status, statusMessage: e.message })
    throw e
  }
})

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  png: b => b.subarray(0, 4).toString('hex') === '89504e47', jpg: b => b[0] === 0xff && b[1] === 0xd8, jpeg: b => b[0] === 0xff && b[1] === 0xd8,
  gif: b => b.subarray(0, 3).toString('latin1') === 'GIF', webp: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
}

/** Uploaded images: at most 5, each up to 5 MB, named by the hash of their bytes, and really the type the name says. */
function imageUploads(files: { path: string, content: string }[] | undefined) {
  if (files === undefined) return []
  if (!Array.isArray(files) || files.length > 5) throw createError({ statusCode: 400, statusMessage: 'At most 5 images per edit' })
  return files.map((f) => {
    if (typeof f?.path !== 'string' || typeof f.content !== 'string' || !ASSET_PATH.test(f.path)) throw createError({ statusCode: 400, statusMessage: 'Invalid image path' })
    const buf = Buffer.from(f.content, 'base64')
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw createError({ statusCode: 413, statusMessage: 'An image can be up to 5 MB' })
    const ext = f.path.split('.').pop()!
    if (!MAGIC[ext]?.(buf)) throw createError({ statusCode: 400, statusMessage: 'That is not a valid image' })
    if (createHash('sha256').update(buf).digest('hex').slice(0, 16) !== f.path.slice(7, 23)) throw createError({ statusCode: 400, statusMessage: 'The image name does not match its content' })
    return { path: f.path, content: f.content, encoding: 'base64' as const }
  })
}
