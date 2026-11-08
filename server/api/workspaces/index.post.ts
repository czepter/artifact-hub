import { requireEditor } from '../../utils/auth'
import { createWorkspace } from '../../utils/workspaces'

export default defineEventHandler(async (event) => {
  requireEditor(event)
  return createWorkspace(await readBody(event) ?? {})
})
