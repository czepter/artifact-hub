import { requireEditor } from '../utils/auth'
import { thumbFor } from '../utils/thumb'
import { useDb } from '../utils/db'

interface Thread { board: string | null, id: string, artifact_id: string, title: string, author_email: string, body: string, last_at: string, replies: number }

// Open threads whose latest message is from a guest (not a member, not the model): they are waiting for an answer.
export default defineEventHandler((event) => {
  requireEditor(event)
  const db = useDb()
  const rows = db.prepare(`
    SELECT r.id, r.artifact_id, a.title, r.board,
           l.author_email, l.author_kind, l.body, l.created_at AS last_at,
           (SELECT COUNT(*) FROM comments c WHERE c.parent_id = r.id) AS replies
    FROM comments r
    JOIN artifacts a ON a.id = r.artifact_id
    JOIN comments l ON l.id = COALESCE(
      (SELECT c.id FROM comments c WHERE c.parent_id = r.id ORDER BY c.created_at DESC LIMIT 1), r.id)
    WHERE r.parent_id IS NULL AND r.resolved = 0
    ORDER BY l.created_at DESC
  `).all() as unknown as (Thread & { author_kind: string })[]
  const members = new Set((db.prepare('SELECT lower(email) AS e FROM "user"').all() as { e: string }[]).map(r => r.e))
  const waiting = rows.filter(r => r.author_kind === 'person' && !members.has(r.author_email.toLowerCase()))
  const openThreads = (db.prepare('SELECT COUNT(*) AS n FROM comments WHERE parent_id IS NULL AND resolved = 0').get() as { n: number }).n
  const shareLinks = (db.prepare('SELECT COUNT(*) AS n FROM shares WHERE revoked = 0').get() as { n: number }).n
  const recent = db.prepare(`
    SELECT a.id, a.title, a.current_version, a.updated_at, a.pinned, a.opened_at, a.opens,
           (SELECT COUNT(*) FROM comments c WHERE c.artifact_id = a.id AND c.parent_id IS NULL AND c.resolved = 0) AS open_comments,
           EXISTS(SELECT 1 FROM files f WHERE f.artifact_id = a.id AND f.version = a.current_version AND f.path = 'canvas.json') AS canvas,
           EXISTS(SELECT 1 FROM shares s WHERE s.artifact_id = a.id AND s.revoked = 0) AS shared
    FROM artifacts a WHERE a.kind = 'artifact' AND a.archived_at IS NULL ORDER BY a.pinned DESC, a.updated_at DESC LIMIT 6
  `).all()
  const total = (db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE kind = \'artifact\' AND archived_at IS NULL').get() as { n: number }).n
  return { recent: (recent as { id: string, current_version: number }[]).map(r => ({ ...r, thumb: thumbFor(r.id, r.current_version) })), total, waiting: waiting.slice(0, 20), waitingCount: waiting.length, openThreads, shareLinks }
})
