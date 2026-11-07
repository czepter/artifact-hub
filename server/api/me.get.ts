import { requireMember } from '../utils/auth'

// Who the UI is signed in as. Guests on share links never reach the app chrome.
export default defineEventHandler((event) => {
  const m = requireMember(event)
  return { id: m.id, name: m.name, email: m.email, role: m.role }
})
