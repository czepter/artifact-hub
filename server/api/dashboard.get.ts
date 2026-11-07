import { requireEditor, signFrameToken } from '../utils/auth'
import { readFile } from '../utils/store'
import { useDb } from '../utils/db'

interface Thread { id: string, artifact_id: string, title: string, author_email: string, body: string, last_at: string, replies: number }

// Open threads whose latest message is from a guest (not a member, not the model): they are waiting for an answer.
export default defineEventHandler((event) => {
  requireEditor(event)
  const db = useDb()
  const rows = db.prepare(`
    SELECT r.id, r.artifact_id, a.title,
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
           EXISTS(SELECT 1 FROM files f WHERE f.artifact_id = a.id AND f.version = a.current_version AND f.path = 'canvas.json') AS canvas
    FROM artifacts a ORDER BY a.pinned DESC, a.updated_at DESC LIMIT 6
  `).all()
  const total = (db.prepare('SELECT COUNT(*) AS n FROM artifacts').get() as { n: number }).n
  return { recent: (recent as { id: string, current_version: number }[]).map(r => ({ ...r, thumb: thumbFor(r.id, r.current_version) })), total, waiting: waiting.slice(0, 20), waitingCount: waiting.length, openThreads, shareLinks }
})

// What a card previews: a canvas shows its first board at the board's own size, a page shows index.html at desktop size.
function thumbFor(id: string, version: number): { src: string, w: number, h: number } | null {
  try {
    const base = `/f/${signFrameToken(id, 3600)}@${version}/`
    const raw = readFile(id, version, 'canvas.json')
    if (raw) {
      const boards = (JSON.parse(raw.content.toString('utf8')).boards ?? {}) as Record<string, { w?: number, h?: number }>
      const [path, b] = Object.entries(boards)[0] ?? []
      return path ? { src: base + path, w: b?.w ?? 1280, h: b?.h ?? 800 } : null
    }
    return readFile(id, version, 'index.html') ? { src: base + 'index.html', w: 1280, h: 800 } : null
  } catch { return null }
}
