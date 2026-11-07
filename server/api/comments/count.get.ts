import { requireMember } from '../../utils/auth'
import { useDb } from '../../utils/db'

export default defineEventHandler((event) => {
  requireMember(event)
  return { open: (useDb().prepare('SELECT COUNT(*) AS n FROM comments WHERE parent_id IS NULL AND resolved = 0').get() as { n: number }).n }
})
