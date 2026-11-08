import { requireMember } from '../../../../utils/auth'
import { resolveWorkspaceId } from '../../../../utils/workspaces'
import { cleanSharedPath, readSharedFile, sharedPathParam } from '../../../../utils/sharedFiles'

// One shared file's source (text files). Binary files are only listed; boards load them through the frame route.
export default defineEventHandler((event) => {
  requireMember(event)
  const ws = resolveWorkspaceId(getRouterParam(event, 'id'))
  const path = cleanSharedPath(sharedPathParam(event))
  const f = readSharedFile(ws, path)
  if (!f) throw createError({ statusCode: 404, statusMessage: `No such shared file: ${path}` })
  if (!/^(text\/|application\/json|image\/svg)/.test(f.contentType)) throw createError({ statusCode: 415, statusMessage: 'Not a text file' })
  return { path, contentType: f.contentType, source: f.content.toString('utf8') }
})
