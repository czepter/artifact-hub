import { getAuth } from '../../../utils/betterAuth'

export default defineEventHandler(async (event) => {
  const auth = await getAuth(event)
  return auth.handler(toWebRequest(event))
})
