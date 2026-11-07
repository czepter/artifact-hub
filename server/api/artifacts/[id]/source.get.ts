import { requireMember } from '../../../utils/auth'
import { getElementSource } from '../../../utils/htmlEdit'
import { cleanPath, readFile, requireArtifact } from '../../../utils/store'

// Code tab: the stored source of a file and, when ?el=<id> is given, of one element.
export default defineEventHandler((event) => {
  requireMember(event)
  const a = requireArtifact(getRouterParam(event, 'id')!)
  const q = getQuery(event)
  const path = cleanPath(String(q.path ?? ''))
  const file = readFile(a.id, a.current_version, path)
  if (!file) throw createError({ statusCode: 404, statusMessage: `No such file: ${path}` })
  if (!/^(text\/|application\/json)/.test(file.contentType)) throw createError({ statusCode: 415, statusMessage: 'Not a text file' })
  const source = file.content.toString('utf8')
  const el = q.el ? getElementSource(source, String(q.el)) : null
  return { version: a.current_version, path, source, element: el ? el.html : null }
})
