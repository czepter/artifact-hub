import { requireOwner } from '../../utils/auth'
import { useDb } from '../../utils/db'

export default defineEventHandler((event) => {
  requireOwner(event)
  const r = useDb().prepare('DELETE FROM invites WHERE id = ? AND accepted_at IS NULL').run(getRouterParam(event, 'id')!)
  if (!r.changes) throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  return { ok: true }
})
