import { requireMember } from '../../utils/auth'
import { useDb } from '../../utils/db'
import { logEvent } from '../../utils/events'

// Cuts a client off at once. Owners can revoke any grant; members only their own.
export default defineEventHandler((event) => {
  const me = requireMember(event)
  const family = getRouterParam(event, 'family')!
  const db = useDb()
  const g = db.prepare('SELECT t.user_id, c.name FROM oauth_tokens t JOIN oauth_clients c ON c.client_id = t.client_id WHERE t.family = ? LIMIT 1').get(family) as { user_id: string | null, name: string } | undefined
  if (!g || (me.role !== 'owner' && g.user_id !== me.id)) throw createError({ statusCode: 404, statusMessage: 'Grant not found' })
  db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE family = ?').run(family)
  logEvent('revoked', g.name)
  return { ok: true }
})
