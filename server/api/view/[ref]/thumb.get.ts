import { resolveAccess } from '../../../utils/auth'
import { cleanPath, requireArtifact } from '../../../utils/store'
import { boardThumb, thumbInfo } from '../../../utils/render/thumb'

// Picture of one board for the zoomed-out canvas. 404 when the server cannot draw it: the viewer then loads the live page.
export default defineEventHandler(async (event) => {
  const access = resolveAccess(event, getRouterParam(event, 'ref')!)
  const artifact = requireArtifact(access.artifactId)
  const q = getQuery(event)
  const version = q.v === undefined ? artifact.current_version : /^\d+$/.test(String(q.v)) ? Number(q.v) : 0
  if (version < 1 || version > artifact.current_version) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const path = cleanPath(String(q.path ?? ''))
  const info = thumbInfo(artifact.id, version, path)
  if (!info) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const etag = `"${info.key}"`
  setResponseHeader(event, 'ETag', etag)
  setResponseHeader(event, 'Cache-Control', 'private, no-cache')
  if (getHeader(event, 'if-none-match') === etag) { setResponseStatus(event, 304); return '' }
  const jpeg = await boardThumb(artifact.id, version, path, info, version === artifact.current_version)
  if (jpeg === 'busy') { setResponseHeader(event, 'Retry-After', 5); throw createError({ statusCode: 503, statusMessage: 'Busy' }) }
  if (!jpeg) throw createError({ statusCode: 404, statusMessage: 'Not available' })
  setResponseHeader(event, 'Content-Type', 'image/jpeg')
  return jpeg
})
