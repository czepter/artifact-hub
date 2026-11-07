import { requireMember } from '../../../utils/auth'
import { useDb } from '../../../utils/db'
import { requireArtifact } from '../../../utils/store'

// Members opening an artifact in the viewer: feeds "last opened" and the open count. Share-link guests are not counted.
export default defineEventHandler((event) => {
  requireMember(event)
  const a = requireArtifact(getRouterParam(event, 'id')!)
  useDb().prepare('UPDATE artifacts SET opened_at = ?, opens = opens + 1 WHERE id = ?').run(new Date().toISOString(), a.id)
  return { ok: true }
})
