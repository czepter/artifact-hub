import { requireEditor } from '../../utils/auth'
import { renameArtifact, setArchived, setPinned } from '../../utils/store'
import { moveArtifact } from '../../utils/workspaces'

export default defineEventHandler(async (event) => {
  requireEditor(event)
  const id = getRouterParam(event, 'id')!
  const b = await readBody<{ title?: string, pinned?: boolean, archived?: boolean, workspaceId?: string }>(event)
  if (typeof b.title === 'string') renameArtifact(id, b.title)
  if (typeof b.pinned === 'boolean') setPinned(id, b.pinned)
  if (typeof b.archived === 'boolean') setArchived(id, b.archived)
  if (typeof b.workspaceId === 'string') moveArtifact(id, b.workspaceId)
  return { ok: true }
})
