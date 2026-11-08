import { requireEditor } from '../../../utils/auth'
import { transferBoards } from '../../../utils/transfer'

// Copy or move boards (omit `boards` for the whole canvas, notes included) into another artifact:
// { target, boards?: string[], mode?: 'copy' | 'move' }. See server/utils/transfer.ts for what travels along.
export default defineEventHandler(async (event) => {
  requireEditor(event)
  const b = await readBody<{ target?: unknown, boards?: unknown, mode?: unknown }>(event)
  if (typeof b?.target !== 'string' || !b.target) throw createError({ statusCode: 400, statusMessage: 'target (an artifact id) is required' })
  if (b.boards !== undefined && b.boards !== null && !(Array.isArray(b.boards) && b.boards.every(x => typeof x === 'string'))) throw createError({ statusCode: 400, statusMessage: 'boards must be a list of board paths' })
  return transferBoards({ sourceId: getRouterParam(event, 'id')!, targetId: b.target, boards: b.boards as string[] | null | undefined, mode: b.mode as 'copy' | 'move' | undefined })
})
