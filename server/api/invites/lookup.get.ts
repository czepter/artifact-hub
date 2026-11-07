import { useDb } from '../../utils/db'
import { sha256 } from '../../utils/oauth'

// Public: the invitation page uses this to show whom the link is for. It reveals only the e-mail and role of a valid, unused link.
export default defineEventHandler((event) => {
  const token = String(getQuery(event).token ?? '')
  const row = token ? useDb().prepare('SELECT email, role FROM invites WHERE token_hash = ? AND accepted_at IS NULL').get(sha256(token)) as { email: string, role: string } | undefined : undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'This invitation is invalid or was already used' })
  return row
})
