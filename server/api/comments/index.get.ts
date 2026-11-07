import { requireMember } from '../../utils/auth'
import { useDb } from '../../utils/db'

// Every comment thread across artifacts: the root, its latest message and the reply count.
export default defineEventHandler((event) => {
  requireMember(event)
  const rows = useDb().prepare(`
    SELECT r.id, r.artifact_id, a.title, r.version, r.board, r.resolved, r.author_email AS first_author, r.body AS first_body, r.created_at,
           l.author_email, l.author_kind, l.body, l.created_at AS last_at,
           (SELECT COUNT(*) FROM comments c WHERE c.parent_id = r.id) AS replies
    FROM comments r
    JOIN artifacts a ON a.id = r.artifact_id
    JOIN comments l ON l.id = COALESCE((SELECT c.id FROM comments c WHERE c.parent_id = r.id ORDER BY c.created_at DESC LIMIT 1), r.id)
    WHERE r.parent_id IS NULL
    ORDER BY l.created_at DESC
    LIMIT 500
  `).all()
  return rows
})
