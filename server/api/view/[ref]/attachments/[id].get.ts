import { resolveAccess } from '../../../../utils/auth'
import { INLINE_IMAGE, readAttachment } from '../../../../utils/store'

// Serves a comment attachment to anyone who can open the artifact. Raster images render inline; everything
// else (SVG, HTML, PDFs...) is a download, so an attachment can never run script on the hub's origin.
export default defineEventHandler((event) => {
  const access = resolveAccess(event, getRouterParam(event, 'ref')!)
  const f = readAttachment(access.artifactId, getRouterParam(event, 'id')!)
  const inline = INLINE_IMAGE.test(f.mime)
  setHeader(event, 'Content-Type', inline ? f.mime : 'application/octet-stream')
  setHeader(event, 'Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Security-Policy', "default-src 'none'; sandbox")
  setHeader(event, 'Cache-Control', 'private, max-age=31536000, immutable')
  return f.content
})
