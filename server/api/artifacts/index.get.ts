import { requireMember } from '../../utils/auth'
import { listArtifacts } from '../../utils/store'
import { resolveWorkspaceId } from '../../utils/workspaces'

// ?workspace=<id or name> limits the list to one workspace.
export default defineEventHandler((event) => {
  requireMember(event)
  const ws = getQuery(event).workspace
  const archived = getQuery(event).archived ? 'only' : 'hide' // ?archived=1 lists the archive instead
  return listArtifacts(typeof ws === 'string' && ws ? resolveWorkspaceId(ws) : undefined, false, archived)
})
