import { randomUUID } from 'node:crypto'
import { requireOwner } from '../../utils/auth'
import { useDb, now } from '../../utils/db'
import { logEvent } from '../../utils/events'
import { randomToken, sha256, baseUrl } from '../../utils/oauth'

// Invitations are links (sending mail needs a mailer, which the hub does not have). The e-mail binds the invite:
// only an account created with that address can use it.
export default defineEventHandler(async (event) => {
  const me = requireOwner(event)
  const b = await readBody<{ email?: string, role?: string }>(event)
  const email = String(b.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) throw createError({ statusCode: 400, statusMessage: 'Enter a valid e-mail address' })
  if (b.role !== 'editor' && b.role !== 'commenter') throw createError({ statusCode: 400, statusMessage: 'Role must be editor or commenter' })
  const db = useDb()
  if (db.prepare('SELECT 1 FROM "user" WHERE lower(email) = ?').get(email)) throw createError({ statusCode: 409, statusMessage: 'That person is already a member' })
  db.prepare('DELETE FROM invites WHERE lower(email) = ? AND accepted_at IS NULL').run(email)
  const token = randomToken(24)
  const id = randomUUID()
  db.prepare('INSERT INTO invites (id, email, role, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, email, b.role, sha256(token), me.id, now())
  logEvent('invited', `${email} as ${b.role}`)
  return { id, email, role: b.role, url: `${baseUrl(event)}/invite/${token}` }
})
