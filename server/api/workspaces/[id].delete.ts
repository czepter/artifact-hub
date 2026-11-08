import { requireOwner } from '../../utils/auth'
import { deleteWorkspace } from '../../utils/workspaces'

// Refused (409) while the workspace still holds artifacts: move them out first.
export default defineEventHandler((event) => {
  requireOwner(event)
  deleteWorkspace(getRouterParam(event, 'id')!)
  return { ok: true }
})
