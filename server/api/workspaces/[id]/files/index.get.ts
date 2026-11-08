import { requireMember } from '../../../../utils/auth'
import { resolveWorkspaceId } from '../../../../utils/workspaces'
import { listSharedFiles, sharedRev } from '../../../../utils/sharedFiles'

// The workspace's shared files: what boards of any of its artifacts can link as `_shared/<path>`.
export default defineEventHandler((event) => {
  requireMember(event)
  const id = resolveWorkspaceId(getRouterParam(event, 'id'))
  return { workspaceId: id, rev: sharedRev(id), files: listSharedFiles(id) }
})
