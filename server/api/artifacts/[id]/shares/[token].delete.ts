import { requireEditor } from '../../../../utils/auth'
import { revokeShare } from '../../../../utils/store'

export default defineEventHandler((event) => {
  requireEditor(event)
  revokeShare(getRouterParam(event, 'id')!, getRouterParam(event, 'token')!)
  return { ok: true }
})
