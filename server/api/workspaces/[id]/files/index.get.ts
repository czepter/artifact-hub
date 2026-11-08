import { requireEditor, requireMember } from '../../../../utils/auth'
import { resolveWorkspaceId } from '../../../../utils/workspaces'
import { listSharedFiles, sharedArtifactId, sharedRev } from '../../../../utils/sharedFiles'

// The workspace's shared files: what boards of any of its artifacts can link as `_shared/<path>`.
// `artifactId` is the library's canvas (an artifact the viewer opens); `?open=1` makes it if the workspace has no library yet.
export default defineEventHandler((event) => {
  const open = !!getQuery(event).open
  if (open) requireEditor(event); else requireMember(event)
  const id = resolveWorkspaceId(getRouterParam(event, 'id'))
  return { workspaceId: id, rev: sharedRev(id), artifactId: sharedArtifactId(id, open), files: listSharedFiles(id) }
})
