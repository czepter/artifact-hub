import { requireMember } from '../../../utils/auth'
import { exportFiles } from '../../../utils/store'
import { zip } from '../../../utils/zip'

// Download the live version (or ?v=N) as a .zip with the files exactly as published.
export default defineEventHandler((event) => {
  requireMember(event)
  const q = getQuery(event)
  const { artifact, files } = exportFiles(getRouterParam(event, 'id')!, q.v ? Number(q.v) : undefined)
  const slug = artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'artifact'
  setResponseHeaders(event, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${slug}.zip"`,
    'Cache-Control': 'no-store',
  })
  return zip(files)
})
