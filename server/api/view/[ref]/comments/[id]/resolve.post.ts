import { resolveAccess } from '../../../../../utils/auth'
import { resolveComment } from '../../../../../utils/store'

export default defineEventHandler(async (event) => {
  const access = resolveAccess(event, getRouterParam(event, 'ref')!)
  if (access.role === 'view') throw createError({ statusCode: 403, statusMessage: 'This link is view-only' })
  const { resolved } = await readBody<{ resolved: boolean }>(event)
  resolveComment(access.artifactId, getRouterParam(event, 'id')!, resolved !== false)
  return { ok: true }
})
