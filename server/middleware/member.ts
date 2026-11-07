import { devMember, devSignIn, devLoginEnabled, memberFromSession, type Member } from '../utils/betterAuth'

declare module 'h3' { interface H3EventContext { member?: Member | null } }

// Resolves the signed-in member once per API/OAuth request so handlers can stay synchronous.
export default defineEventHandler(async (event) => {
  const p = event.path
  const isMcp = p === '/mcp' || p.startsWith('/mcp?')
  if (!(p.startsWith('/api/') || p.startsWith('/oauth/') || isMcp)) return
  if (p.startsWith('/api/auth/')) return
  if (devLoginEnabled()) {
    const bearer = getHeader(event, 'authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (bearer && process.env.NUXT_DEV_TOKEN && bearer === process.env.NUXT_DEV_TOKEN) {
      event.context.member = await devMember(event)
      return
    }
  }
  if (isMcp) return // /mcp authenticates with OAuth access tokens only (see mcpCaller)
  event.context.member = await memberFromSession(event)
  if (!event.context.member && devLoginEnabled()) event.context.member = await devSignIn(event)
})
