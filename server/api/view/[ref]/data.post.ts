import { resolveAccess } from '../../../utils/auth'
import { dataDelete, dataGet, dataList, dataSet } from '../../../utils/store'

// Backs window.artifact.shared / .personal. Called by the viewer on behalf of the sandboxed frame,
// so the viewer's own session (owner cookie or share link + e-mail) decides what is allowed.
export default defineEventHandler(async (event) => {
  const access = resolveAccess(event, getRouterParam(event, 'ref')!)
  const b = await readBody<{ op?: string, scope?: string, key?: unknown, value?: unknown, prefix?: unknown }>(event)
  if (b.scope !== 'shared' && b.scope !== 'personal') throw createError({ statusCode: 400, statusMessage: 'scope must be "shared" or "personal"' })

  // Personal storage is keyed by identity: the owner, or a commenter's e-mail. Anonymous view links have none.
  const identity = access.role === 'owner' ? 'owner' : access.email
  const scope = b.scope === 'shared' ? 'shared' : identity ? `u:${identity}` : null
  if (!scope) throw createError({ statusCode: 401, statusMessage: 'Enter your e-mail to use personal storage' })

  const writing = b.op === 'set' || b.op === 'delete'
  if (writing && access.role === 'view') throw createError({ statusCode: 403, statusMessage: 'This link is view-only' })
  if (writing && !identity) throw createError({ statusCode: 401, statusMessage: 'Enter your e-mail to save changes' })

  switch (b.op) {
    case 'get': return dataGet(access.artifactId, scope, b.key)
    case 'list': return dataList(access.artifactId, scope, typeof b.prefix === 'string' ? b.prefix : '')
    case 'set': dataSet(access.artifactId, scope, b.key, b.value, identity!); return { ok: true }
    case 'delete': dataDelete(access.artifactId, scope, b.key); return { ok: true }
    default: throw createError({ statusCode: 400, statusMessage: 'op must be get, list, set or delete' })
  }
})
