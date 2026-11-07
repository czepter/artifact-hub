import { requireOwner } from '../../utils/auth'
import { useDb } from '../../utils/db'

export default defineEventHandler((event) => {
  requireOwner(event)
  const db = useDb()
  const members = db.prepare('SELECT id, name, email, role, createdAt AS created_at FROM "user" ORDER BY createdAt').all()
  const invites = db.prepare('SELECT id, email, role, created_at FROM invites WHERE accepted_at IS NULL ORDER BY created_at DESC').all()
  return { members, invites }
})
