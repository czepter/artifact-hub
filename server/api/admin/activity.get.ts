import { requireOwner } from '../../utils/auth'
import { useDb } from '../../utils/db'

export default defineEventHandler((event) => {
  requireOwner(event)
  return useDb().prepare('SELECT id, at, actor, kind, subject FROM events ORDER BY id DESC LIMIT 200').all()
})
