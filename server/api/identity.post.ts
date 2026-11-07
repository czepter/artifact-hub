import { secureCookie } from '../utils/auth'

// Commenters identify by e-mail (no verification yet: it labels comments, it does not authenticate).
export default defineEventHandler(async (event) => {
  const { email } = await readBody<{ email?: string }>(event)
  const e = String(email ?? '').trim().toLowerCase()
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e)) throw createError({ statusCode: 400, statusMessage: 'Enter a valid e-mail address' })
  setCookie(event, 'hub_email', e, { sameSite: 'lax', secure: secureCookie(event), path: '/', maxAge: 60 * 60 * 24 * 365 })
  return { email: e }
})
