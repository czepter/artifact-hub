import { requireEditor } from '../../../utils/auth'
import { duplicateArtifact } from '../../../utils/store'

export default defineEventHandler((event) => {
  requireEditor(event)
  return duplicateArtifact(getRouterParam(event, 'id')!)
})
