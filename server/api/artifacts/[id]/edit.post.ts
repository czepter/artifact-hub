import { requireEditor } from '../../../utils/auth'
import { EditError, applyEdits, type Op } from '../../../utils/htmlEdit'
import { cleanPath, publish, readFile, requireArtifact } from '../../../utils/store'

// Visual-editor save: replays a batch of operations against one board's stored source and publishes the result
// as a single new version. `baseVersion` must be the live version, so an edit never overwrites something that
// was published elsewhere in the meantime (409: reload the board).
export default defineEventHandler(async (event) => {
  requireEditor(event)
  const id = getRouterParam(event, 'id')!
  const b = await readBody<{ path?: string, baseVersion?: number, ops?: Op[] }>(event)
  const a = requireArtifact(id)
  if (b.baseVersion !== a.current_version) {
    throw createError({ statusCode: 409, statusMessage: `Changed elsewhere (live version is ${a.current_version}). Reload the board and try again.` })
  }
  const path = cleanPath(String(b.path ?? ''))
  if (!/\.html?$/i.test(path)) throw createError({ statusCode: 400, statusMessage: 'Only .html boards can be edited visually' })
  const file = readFile(id, a.current_version, path)
  if (!file) throw createError({ statusCode: 404, statusMessage: `No such file: ${path}` })
  try {
    const r = applyEdits(file.content.toString('utf8'), b.ops as Op[])
    const pub = publish({ id, baseVersion: a.current_version, files: [{ path, content: r.source }], label: `Edited ${path}`.slice(0, 60) })
    return { version: pub.version, applied: r.applied, warnings: r.warnings }
  } catch (e) {
    if (e instanceof EditError) throw createError({ statusCode: e.status, statusMessage: e.message })
    throw e
  }
})
