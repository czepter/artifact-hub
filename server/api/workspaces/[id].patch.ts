import { requireEditor } from '../../utils/auth'
import { updateWorkspace } from '../../utils/workspaces'

export default defineEventHandler(async (event) => {
  requireEditor(event)
  return updateWorkspace(getRouterParam(event, 'id')!, await readBody(event) ?? {})
})
