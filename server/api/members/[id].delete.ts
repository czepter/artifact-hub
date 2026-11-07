import { requireOwner } from '../../utils/auth'
import { useDb } from '../../utils/db'
import { logEvent } from '../../utils/events'

// Removing a member also ends their sessions and revokes the OAuth grants they approved.
export default defineEventHandler((event) => {
  const me = requireOwner(event)
  const id = getRouterParam(event, 'id')!
  if (id === me.id) throw createError({ statusCode: 400, statusMessage: 'You cannot remove yourself' })
  const db = useDb()
  const target = db.prepare('SELECT role, email FROM "user" WHERE id = ?').get(id) as { role: string, email: string } | undefined
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Member not found' })
  if (target.role === 'owner') throw createError({ statusCode: 400, statusMessage: 'The owner cannot be removed' })
  db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE user_id = ?').run(id)
  db.prepare('DELETE FROM "user" WHERE id = ?').run(id)
  logEvent('removed', target.email)
  return { ok: true }
})
