import { cors, revokeToken } from '../../utils/oauth'

// RFC 7009: always 200, never reveal whether the token existed.
export default defineEventHandler(async (event) => {
  if (cors(event)) return ''
  if (event.method !== 'POST') throw createError({ statusCode: 405 })
  const b = (await readBody<Record<string, unknown>>(event).catch(() => ({}))) as Record<string, unknown>
  if (typeof b.token === 'string') revokeToken(b.token)
  return ''
})
