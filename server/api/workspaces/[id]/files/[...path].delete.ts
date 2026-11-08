import { requireEditor } from '../../../../utils/auth'
import { resolveWorkspaceId } from '../../../../utils/workspaces'
import { deleteSharedFile, sharedPathParam } from '../../../../utils/sharedFiles'

// Boards that still link the file show a missing resource afterwards: it is a live link, not a copy.
export default defineEventHandler((event) => {
  requireEditor(event)
  deleteSharedFile(resolveWorkspaceId(getRouterParam(event, 'id')), sharedPathParam(event))
  return { ok: true }
})
