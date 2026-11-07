import { requireEditor } from '../utils/auth'
import { useDb } from '../utils/db'

// Every active share link across artifacts.
export default defineEventHandler((event) => {
  requireEditor(event)
  return useDb().prepare('SELECT s.token, s.role, s.created_at, a.id AS artifact_id, a.title FROM shares s JOIN artifacts a ON a.id = s.artifact_id WHERE s.revoked = 0 ORDER BY s.created_at DESC').all()
})
