import { requireMember } from '../../../utils/auth'
import { getTemplateInfo } from '../../../utils/htmlEdit'
import { cleanPath, readFile, requireArtifact } from '../../../utils/store'

// Template panel: loops, conditions, holes and attributes of one element in a board's stored source.
export default defineEventHandler((event) => {
  requireMember(event)
  const a = requireArtifact(getRouterParam(event, 'id')!)
  const q = getQuery(event)
  const path = cleanPath(String(q.path ?? ''))
  const file = readFile(a.id, a.current_version, path)
  if (!file) throw createError({ statusCode: 404, statusMessage: `No such file: ${path}` })
  if (!/^text\//.test(file.contentType)) throw createError({ statusCode: 415, statusMessage: 'Not a text file' })
  const info = getTemplateInfo(file.content.toString('utf8'), String(q.el ?? ''))
  if (!info) throw createError({ statusCode: 404, statusMessage: 'That element is not in the saved source (it was added by a script or not saved yet).' })
  return { version: a.current_version, ...info }
})
