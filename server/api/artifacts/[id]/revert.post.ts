import { requireEditor } from '../../../utils/auth'
import { cleanPath, publish, readFile, requireArtifact } from '../../../utils/store'

// Undo for the visual editor: republishes one file's content from an earlier version as a new version.
export default defineEventHandler(async (event) => {
  requireEditor(event)
  const id = getRouterParam(event, 'id')!
  const b = await readBody<{ path?: string, toVersion?: number, baseVersion?: number }>(event)
  const a = requireArtifact(id)
  if (b.baseVersion !== a.current_version) throw createError({ statusCode: 409, statusMessage: `Changed elsewhere (live version is ${a.current_version}).` })
  const path = cleanPath(String(b.path ?? ''))
  if (!Number.isInteger(b.toVersion) || b.toVersion! < 1 || b.toVersion! >= a.current_version) throw createError({ statusCode: 400, statusMessage: 'Invalid version' })
  const old = readFile(id, b.toVersion!, path)
  if (!old) throw createError({ statusCode: 404, statusMessage: `${path} does not exist in v${b.toVersion}` })
  const pub = publish({ id, baseVersion: a.current_version, files: [{ path, content: old.content.toString('base64'), encoding: 'base64' }], label: `Undo edit of ${path}`.slice(0, 60) })
  return { version: pub.version }
})
