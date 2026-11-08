import { requireMember } from '../../utils/auth'
import { useDb } from '../../utils/db'
import { listComments } from '../../utils/store'

// One thread: the root comment and its replies in order, plus the artifact it belongs to.
// Reply ids are not thread roots and answer 404.
export default defineEventHandler((event) => {
  requireMember(event)
  const id = getRouterParam(event, 'id')!
  const root = useDb().prepare('SELECT artifact_id FROM comments WHERE id = ? AND parent_id IS NULL').get(id) as { artifact_id: string } | undefined
  if (!root) throw createError({ statusCode: 404, statusMessage: 'Thread not found' })
  const artifact = useDb().prepare('SELECT id, title FROM artifacts WHERE id = ?').get(root.artifact_id) as { id: string, title: string } | undefined
  if (!artifact) throw createError({ statusCode: 404, statusMessage: 'Thread not found' })
  const all = listComments(artifact.id).filter(c => c.id === id || c.parent_id === id)
  const first = all.find(c => c.id === id)!
  return {
    id,
    artifact: { id: artifact.id, title: artifact.title },
    board: first.board,
    anchor: first.anchor,
    version: first.version,
    resolved: first.resolved,
    messages: all.map(c => ({
      id: c.id, author_email: c.author_email, author_kind: c.author_kind, body: c.body,
      created_at: c.created_at, board: c.board, anchor: c.anchor, version: c.version, attachments: c.attachments,
    })),
  }
})
