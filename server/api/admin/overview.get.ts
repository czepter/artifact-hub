import { statSync } from 'node:fs'
import { requireOwner } from '../../utils/auth'
import { useDb } from '../../utils/db'

export default defineEventHandler((event) => {
  requireOwner(event)
  const db = useDb()
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n
  let dbBytes = 0
  try { dbBytes = statSync(process.env.HUB_DB ?? '.data/hub.sqlite').size } catch { /* in-memory or moved */ }
  return {
    artifacts: n('SELECT COUNT(*) AS n FROM artifacts'),
    versions: n('SELECT COUNT(*) AS n FROM versions'),
    fileBytes: n('SELECT COALESCE(SUM(length(content)), 0) AS n FROM files'),
    dataBytes: n('SELECT COALESCE(SUM(length(value)), 0) AS n FROM artifact_data'),
    comments: n('SELECT COUNT(*) AS n FROM comments'),
    dbBytes,
  }
})
