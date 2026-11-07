import { requireMember } from '../../utils/auth'
import { listWorkspaces } from '../../utils/workspaces'

export default defineEventHandler((event) => {
  requireMember(event)
  return listWorkspaces()
})
