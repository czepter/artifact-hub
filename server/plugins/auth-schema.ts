import { ensureAuthSchema } from '../utils/betterAuth'

// Nitro waits for async plugins, so the tables exist before the first request is served.
export default defineNitroPlugin(async () => {
  await ensureAuthSchema()
})
