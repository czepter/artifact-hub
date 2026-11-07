import { resolveAccess } from '../../../../utils/auth'
import { addComment, requireArtifact } from '../../../../utils/store'

export default defineEventHandler(async (event) => {
  const access = resolveAccess(event, getRouterParam(event, 'ref')!)
  if (access.role === 'view') throw createError({ statusCode: 403, statusMessage: 'This link is view-only' })
  if (!access.email) throw createError({ statusCode: 401, statusMessage: 'Enter your e-mail first' })
  const b = await readBody<{ body: string, board?: string, anchor?: unknown, parentId?: string, version?: number }>(event)
  const a = requireArtifact(access.artifactId)
  const id = addComment({
    artifactId: a.id, version: b.version ?? a.current_version, board: b.board, anchor: b.anchor,
    email: access.email, kind: 'person', body: b.body, parentId: b.parentId,
  })
  return { id }
})
