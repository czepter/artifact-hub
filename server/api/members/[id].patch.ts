import { requireOwner } from '../../utils/auth'
import { useDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const me = requireOwner(event)
  const id = getRouterParam(event, 'id')!
  const { role } = await readBody<{ role?: string }>(event)
  if (role !== 'editor' && role !== 'commenter') throw createError({ statusCode: 400, statusMessage: 'Role must be editor or commenter' })
  if (id === me.id) throw createError({ statusCode: 400, statusMessage: 'You cannot change your own role' })
  const r = useDb().prepare("UPDATE \"user\" SET role = ? WHERE id = ? AND role != 'owner'").run(role, id)
  if (!r.changes) throw createError({ statusCode: 404, statusMessage: 'Member not found' })
  return { ok: true }
})
