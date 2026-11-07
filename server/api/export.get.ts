import { requireOwner } from '../utils/auth'
import { listArtifacts, exportFiles } from '../utils/store'
import { zip } from '../utils/zip'

// Backup: every artifact's live version, one folder each, files exactly as published.
export default defineEventHandler((event) => {
  requireOwner(event)
  const all = []
  for (const a of listArtifacts()) {
    if (!a.current_version) continue
    const slug = a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'artifact'
    for (const f of exportFiles(a.id).files) all.push({ name: `${slug}-${a.id.slice(0, 8)}/${f.name}`, data: f.data })
  }
  setResponseHeaders(event, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="artifact-hub-${new Date().toISOString().slice(0, 10)}.zip"`,
    'Cache-Control': 'no-store',
  })
  return zip(all)
})
