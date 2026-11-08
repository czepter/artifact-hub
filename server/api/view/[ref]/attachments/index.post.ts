import { resolveAccess } from '../../../../utils/auth'
import { ATTACHMENT_LIMITS, addAttachment } from '../../../../utils/store'

// Stage a file pasted into a comment. Body: the raw bytes. Headers: Content-Type, X-Filename (URI-encoded).
// The returned id is passed to POST /comments as attachmentIds.
export default defineEventHandler(async (event) => {
  const access = resolveAccess(event, getRouterParam(event, 'ref')!)
  if (access.role === 'view') throw createError({ statusCode: 403, statusMessage: 'This link is view-only' })
  if (!access.email) throw createError({ statusCode: 401, statusMessage: 'Enter your e-mail first' })
  if (Number(getHeader(event, 'content-length') ?? 0) > ATTACHMENT_LIMITS.bytes) throw createError({ statusCode: 413, statusMessage: `File too large (max ${ATTACHMENT_LIMITS.bytes / 1024 / 1024} MB)` })
  const body = await readRawBody(event, false)
  let name = 'file'
  try { name = decodeURIComponent(getHeader(event, 'x-filename') ?? '') || name } catch { /* keep default */ }
  return addAttachment(access.artifactId, name, getHeader(event, 'content-type') ?? '', body ?? Buffer.alloc(0))
})
