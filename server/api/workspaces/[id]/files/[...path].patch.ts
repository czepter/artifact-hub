import { requireEditor } from '../../../../utils/auth'
import { resolveWorkspaceId } from '../../../../utils/workspaces'
import { editSharedFile, sharedPathParam } from '../../../../utils/sharedFiles'

// Change part of a shared text file in place: { edits: [{ old_text, new_text }] }. Each old_text must occur exactly once; all edits apply or none.
export default defineEventHandler(async (event) => {
  const m = requireEditor(event)
  const ws = resolveWorkspaceId(getRouterParam(event, 'id'))
  const body = await readBody<{ edits?: unknown }>(event)
  const edits = body?.edits
  const ok = Array.isArray(edits) && edits.length > 0 && edits.length <= 64
    && edits.every(e => e && typeof e.old_text === 'string' && e.old_text && typeof e.new_text === 'string')
  if (!ok) throw createError({ statusCode: 400, statusMessage: 'edits must be 1-64 items of { old_text, new_text }' })
  return editSharedFile(ws, sharedPathParam(event), edits as { old_text: string, new_text: string }[], m.email)
})
