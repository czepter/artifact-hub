import { requireEditor } from '../../../../utils/auth'
import { createShare } from '../../../../utils/store'

export default defineEventHandler(async (event) => {
  requireEditor(event)
  const { role } = await readBody<{ role?: 'view' | 'comment' }>(event)
  const token = createShare(getRouterParam(event, 'id')!, role === 'view' ? 'view' : 'comment')
  return { token, url: `${getRequestURL(event).origin}/s/${token}` }
})
