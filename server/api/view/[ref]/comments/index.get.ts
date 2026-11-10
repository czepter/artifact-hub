import { resolveAccess } from '../../../../utils/auth'
import { listComments } from '../../../../utils/store'

// Just the comment list: the live-update path for `comments` events, so a new comment does not refetch the whole view.
export default defineEventHandler((event) => {
  const access = resolveAccess(event, getRouterParam(event, 'ref')!)
  return listComments(access.artifactId)
})
