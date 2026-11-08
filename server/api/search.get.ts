import { requireMember } from '../utils/auth'
import { useDb } from '../utils/db'

// GET /api/search?q=  Feeds the command palette. Artifacts match on title; threads are the open ones whose latest message is from a
// guest (waiting for a reply) and match on that message's author or body. An empty q returns the recent artifacts and waiting threads.
// Same visibility as /api/artifacts and /api/comments (any member, commenters included).
const esc = (s: string) => `%${s.replace(/[\\%_]/g, c => `\\${c}`)}%`

export default defineEventHandler((event) => {
  requireMember(event)
  const raw = getQuery(event).q
  const q = (typeof raw === 'string' ? raw : '').trim().slice(0, 100)
  const db = useDb()
  const like = q ? esc(q) : null
  const artifacts = db.prepare(`
    SELECT id, title, current_version, updated_at, pinned FROM artifacts
    WHERE kind = 'artifact' AND archived_at IS NULL AND (? IS NULL OR title LIKE ? ESCAPE '\\')
    ORDER BY pinned DESC, updated_at DESC LIMIT 8
  `).all(like, like)
  const threads = db.prepare(`
    SELECT r.id, r.artifact_id, a.title, l.author_email, l.body, l.created_at AS last_at
    FROM comments r
    JOIN artifacts a ON a.id = r.artifact_id AND a.kind = 'artifact' AND a.archived_at IS NULL
    JOIN comments l ON l.id = COALESCE((SELECT c.id FROM comments c WHERE c.parent_id = r.id ORDER BY c.created_at DESC LIMIT 1), r.id)
    WHERE r.parent_id IS NULL AND r.resolved = 0 AND l.author_kind = 'person'
      AND lower(l.author_email) NOT IN (SELECT lower(email) FROM "user")
      AND (? IS NULL OR l.body LIKE ? ESCAPE '\\' OR l.author_email LIKE ? ESCAPE '\\')
    ORDER BY l.created_at DESC LIMIT 5
  `).all(like, like, like)
  return { artifacts, threads }
})
