import { resolveAccess } from '../../../utils/auth'
import { requireArtifact } from '../../../utils/store'
import { parseRenderQuery, renderArtifact, renderFilename } from '../../../utils/render'

// GET /api/artifacts/:id/render?format=png|svg|webp|jpeg|xml[&board=&scale=&version=&background=&theme=&max=...]
// `:id` is an artifact id (signed-in member) or a share token, like /api/view/:ref. Options: README, "Rendering".
export default defineEventHandler(async (event) => {
  const access = resolveAccess(event, getRouterParam(event, 'id')!)
  const q = getQuery(event)
  const req = parseRenderQuery(q)
  const artifact = requireArtifact(access.artifactId)
  const r = await renderArtifact(artifact.id, req)
  const live = r.version === artifact.current_version
  setResponseHeaders(event, {
    'Content-Type': r.type,
    'Content-Disposition': `${q.download === undefined ? 'inline' : 'attachment'}; filename="${renderFilename(artifact.title, req, r.ext)}"`,
    ETag: r.etag,
    // An old version never changes; the live one does, so it is always revalidated (the ETag makes that cheap).
    'Cache-Control': live ? 'private, no-cache' : 'private, max-age=86400, immutable',
    // A svg opened on its own page must never run anything: no scripts, no network, only its own inline images.
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'X-Render-Size': `${r.width}x${r.height}`,
    'X-Render-Scale': String(Math.round(r.scale * 1000) / 1000),
    'X-Render-Version': String(r.version),
    'X-Render-Boards': r.boards,
  })
  if (getRequestHeader(event, 'if-none-match') === r.etag) { setResponseStatus(event, 304); return '' }
  return r.body
})
