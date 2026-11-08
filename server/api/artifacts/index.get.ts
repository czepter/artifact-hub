import { requireMember } from '../../utils/auth'
import { listArtifacts, readFile } from '../../utils/store'
import { useDb } from '../../utils/db'
import { thumbFor } from '../../utils/thumb'
import { resolveWorkspaceId } from '../../utils/workspaces'

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
// ?q=<text> keeps artifacts whose title, or the title of a board inside a canvas, contains the text (case and diacritics ignored).
function matches(r: { id: string, title: string, current_version: number }, needle: string) {
  if (fold(r.title).includes(needle)) return true
  try {
    const raw = readFile(r.id, r.current_version, 'canvas.json')
    if (!raw) return false
    const boards = (JSON.parse(raw.content.toString('utf8')).boards ?? {}) as Record<string, { title?: string }>
    return Object.entries(boards).some(([path, b]) => fold(b?.title ?? path.split('/').pop()!.replace(/\.html?$/, '')).includes(needle))
  } catch { return false }
}

// ?workspace=<id or name> limits the list to one workspace. ?cards=1 adds what a card shows: a live preview, open comment threads,
// whether the artifact is a canvas and whether an active share link exists.
export default defineEventHandler((event) => {
  requireMember(event)
  const q = getQuery(event)
  const ws = q.workspace
  const archived = q.archived ? 'only' : 'hide' // ?archived=1 lists the archive instead
  let rows = listArtifacts(typeof ws === 'string' && ws ? resolveWorkspaceId(ws) : undefined, false, archived)
  const needle = typeof q.q === 'string' ? fold(q.q.trim()) : ''
  if (needle) rows = rows.filter(r => matches(r, needle))
  if (!q.cards) return rows
  const db = useDb()
  const open = new Map((db.prepare('SELECT artifact_id AS id, COUNT(*) AS n FROM comments WHERE parent_id IS NULL AND resolved = 0 GROUP BY artifact_id').all() as { id: string, n: number }[]).map(r => [r.id, r.n]))
  const shared = new Set((db.prepare('SELECT DISTINCT artifact_id AS id FROM shares WHERE revoked = 0').all() as { id: string }[]).map(r => r.id))
  const canvas = new Set((db.prepare('SELECT DISTINCT f.artifact_id AS id FROM files f JOIN artifacts a ON a.id = f.artifact_id AND f.version = a.current_version WHERE f.path = \'canvas.json\'').all() as { id: string }[]).map(r => r.id))
  return rows.map(r => ({ ...r, open_comments: open.get(r.id) ?? 0, shared: shared.has(r.id), canvas: canvas.has(r.id), thumb: thumbFor(r.id, r.current_version) }))
})
