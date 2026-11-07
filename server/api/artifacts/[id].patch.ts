import { requireEditor } from '../../utils/auth'
import { renameArtifact, setPinned } from '../../utils/store'

export default defineEventHandler(async (event) => {
  requireEditor(event)
  const id = getRouterParam(event, 'id')!
  const b = await readBody<{ title?: string, pinned?: boolean }>(event)
  if (typeof b.title === 'string') renameArtifact(id, b.title)
  if (typeof b.pinned === 'boolean') setPinned(id, b.pinned)
  return { ok: true }
})
