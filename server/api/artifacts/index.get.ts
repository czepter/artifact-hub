import { requireMember } from '../../utils/auth'
import { listArtifacts } from '../../utils/store'
import { resolveWorkspaceId } from '../../utils/workspaces'

// ?workspace=<id or name> limits the list to one workspace.
export default defineEventHandler((event) => {
  requireMember(event)
  const ws = getQuery(event).workspace
  return listArtifacts(typeof ws === 'string' && ws ? resolveWorkspaceId(ws) : undefined)
})
