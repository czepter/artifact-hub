import { memberCount } from '../utils/betterAuth'

// Public: what the sign-in page may offer. GitHub shows only when its credentials are set in the environment.
export default defineEventHandler(() => {
  const gh = useRuntimeConfig().github as { clientId?: string, clientSecret?: string }
  return { setup: memberCount() === 0, github: !!(gh.clientId && gh.clientSecret) }
})
