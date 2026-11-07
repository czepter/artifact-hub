import { requireMember } from '../../utils/auth'
import { listArtifacts } from '../../utils/store'

export default defineEventHandler((event) => {
  requireMember(event)
  return listArtifacts()
})
