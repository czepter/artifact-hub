import { requireEditor } from '../../../utils/auth'
import { cleanPath, publish, readFile, requireArtifact } from '../../../utils/store'

// Code tab: replace a whole text file (html, css, js, json). baseVersion guards against overwriting newer work.
export default defineEventHandler(async (event) => {
  requireEditor(event)
  const id = getRouterParam(event, 'id')!
  const b = await readBody<{ path?: string, baseVersion?: number, source?: string }>(event)
  const a = requireArtifact(id)
  if (b.baseVersion !== a.current_version) throw createError({ statusCode: 409, statusMessage: `Changed elsewhere (live version is ${a.current_version}). Reload and try again.` })
  const path = cleanPath(String(b.path ?? ''))
  const file = readFile(id, a.current_version, path)
  if (!file || !/^(text\/|application\/json)/.test(file.contentType)) throw createError({ statusCode: 404, statusMessage: 'No such text file' })
  if (typeof b.source !== 'string') throw createError({ statusCode: 400, statusMessage: 'source must be text' })
  if (path.endsWith('.json')) { try { JSON.parse(b.source) } catch { throw createError({ statusCode: 422, statusMessage: 'That is not valid JSON' }) } }
  const pub = publish({ id, baseVersion: a.current_version, files: [{ path, content: b.source }], label: `Edited source of ${path}`.slice(0, 60) })
  return { version: pub.version }
})
