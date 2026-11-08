import { requireEditor } from '../../../../utils/auth'
import { resolveWorkspaceId } from '../../../../utils/workspaces'
import { putSharedFile, sharedPathParam } from '../../../../utils/sharedFiles'

// Create or replace a shared file: { content, encoding?: 'utf8' | 'base64' }. Boards using it update at once.
export default defineEventHandler(async (event) => {
  const m = requireEditor(event)
  const ws = resolveWorkspaceId(getRouterParam(event, 'id'))
  const body = await readBody<{ content?: unknown, encoding?: unknown }>(event)
  if (typeof body?.content !== 'string') throw createError({ statusCode: 400, statusMessage: 'content must be a string' })
  const buf = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8')
  return putSharedFile(ws, sharedPathParam(event), buf, m.email)
})
