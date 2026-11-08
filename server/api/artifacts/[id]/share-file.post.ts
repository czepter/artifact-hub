import { requireEditor } from '../../../utils/auth'
import { shareArtifactFiles } from '../../../utils/sharedFiles'

// Copy files of this artifact into its workspace's shared files: { files: [{ path, as? }] }.
// The artifact keeps its own copies; point boards at `_shared/<path>` to use the shared one.
export default defineEventHandler(async (event) => {
  const m = requireEditor(event)
  const body = await readBody<{ files?: { path?: unknown, as?: unknown }[] }>(event)
  const items = (body?.files ?? []).map(f => ({ path: String(f?.path ?? ''), as: typeof f?.as === 'string' && f.as ? f.as : undefined }))
  return { shared: shareArtifactFiles(getRouterParam(event, 'id')!, items, m.email) }
})
