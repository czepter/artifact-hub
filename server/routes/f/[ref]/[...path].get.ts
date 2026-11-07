import { resolveFrameAccess } from '../../../utils/auth'
import { cleanPath, getArtifact, readFile } from '../../../utils/store'
import { FRAME_HEADERS, instrumentHtml } from '../../../utils/frame'
import { dcSupportJs } from '../../../utils/dc'
import { annotate } from '../../../utils/htmlEdit'

// Serves artifact files to the sandboxed iframe. Auth is the token in the path (iframes with an
// opaque origin do not send cookies), so every file response also carries a sandbox CSP.
export default defineEventHandler(async (event) => {
  const [ref, ver] = getRouterParam(event, 'ref')!.split('@')
  const artifactId = resolveFrameAccess(ref!)
  const artifact = getArtifact(artifactId)
  if (!artifact) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const version = ver && /^\d+$/.test(ver) ? Number(ver) : artifact.current_version
  const path = cleanPath(getRouterParam(event, 'path') || 'index.html')
  let file = readFile(artifactId, version, path)
  // `./support.js` is the Design Component runtime. Boards from Claude's Design export reference it by that name;
  // we always answer with our own implementation (never a copy of someone else's runtime shipped inside an import).
  if (/(^|\/)support\.js$/.test(path) && (!file || file.content.toString('utf8', 0, 400_000).includes('DCLogic'))) {
    file = { content: Buffer.from(await dcSupportJs()), contentType: 'text/javascript; charset=utf-8' }
  }
  if (!file) throw createError({ statusCode: 404, statusMessage: `No such file: ${path}` })
  for (const [k, v] of Object.entries(FRAME_HEADERS)) setResponseHeader(event, k, v)
  setResponseHeader(event, 'Content-Type', file.contentType)
  if (file.contentType.startsWith('text/html')) {
    const source = file.content.toString('utf8')
    // Provisional element ids make boards editable in place; the stored source is untouched by this.
    let served = source
    try { served = annotate(source) } catch { /* unparsable input is served as written, just not editable */ }
    let props: Record<string, unknown> | undefined
    const cj = readFile(artifactId, version, 'canvas.json')
    if (cj) { try { const t = JSON.parse(cj.content.toString('utf8'))?.boards?.[path]?.tweaks; if (t && typeof t === 'object') props = t } catch { /* ignore a broken canvas.json */ } }
    return instrumentHtml(served, { props })
  }
  return file.content
})
