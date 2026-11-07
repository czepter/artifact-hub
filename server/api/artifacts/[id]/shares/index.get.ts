import { requireEditor } from '../../../../utils/auth'
import { listShares } from '../../../../utils/store'

export default defineEventHandler((event) => {
  requireEditor(event)
  return listShares(getRouterParam(event, 'id')!)
})
