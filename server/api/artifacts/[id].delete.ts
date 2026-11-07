import { requireOwner } from '../../utils/auth'
import { deleteArtifact } from '../../utils/store'

export default defineEventHandler((event) => {
  requireOwner(event)
  deleteArtifact(getRouterParam(event, 'id')!)
  return { ok: true }
})
