// Native rendering of an artifact as an image or document. See README ("Rendering") for the options and limits.
//
//   canvas.json  -> shared/canvasRender.ts builds an SVG (true vector: shapes, arrows, text, images, boards)
//   board HTML   -> a headless browser picture embedded in that SVG when one is installed (browser.ts), else a text outline
//   png/webp/jpeg-> the SVG rasterized by resvg (Rust, prebuilt for amd64 and arm64) and, for webp/jpeg, a wasm encoder
//   xml          -> the same scene as structured data
import { createHash } from 'node:crypto'
import { buildScene, sceneToSvg, sceneToXml, RenderError, DEFAULT_OPTIONS, type RenderEnv, type RenderOptions } from '../../../shared/canvasRender'
import { ASSET_PATH, MAX_IMAGE_BYTES } from '../../../shared/canvasOps'
import { getArtifact, listFiles, readFile } from '../store'
import { loadFonts, measurer } from './font'
import { htmlOutline } from './outline'
import { shootBoards, type Shot } from './browser'
import { rasterize, RASTER_LIMITS } from './raster'

export const FORMATS = ['png', 'svg', 'webp', 'jpeg', 'xml'] as const
export type Format = (typeof FORMATS)[number]
export const TYPES: Record<Format, string> = { png: 'image/png', svg: 'image/svg+xml; charset=utf-8', webp: 'image/webp', jpeg: 'image/jpeg', xml: 'application/xml; charset=utf-8' }

/** Hard limits: they bound memory and CPU whatever the caller asks for. */
export const RENDER_LIMITS = { ...RASTER_LIMITS, maxPageH: 8000, embeddedImageBytes: 24 * 1024 * 1024, cacheBytes: 96 * 1024 * 1024, concurrent: 2, queued: 12 }

export interface RenderRequest {
  format: Format, version?: number, board?: string, scale: number, theme: 'light' | 'dark', background: string
  /** Longest edge in px: the scale is lowered, never raised, to fit it. */
  max?: number, padding: number, width: number, height: number, quality: number, html: boolean
}
export interface RenderResult { body: Buffer | string, type: string, ext: string, width: number, height: number, scale: number, version: number, boards: 'screenshot' | 'outline' | 'none', etag: string }

const bad = (msg: string, status = 400) => createError({ statusCode: status, statusMessage: msg })

/** Query string (or MCP arguments) -> a validated request. Unknown keys are ignored; bad values are a 400, not a guess. */
export function parseRenderQuery(q: Record<string, unknown>): RenderRequest {
  const str = (k: string) => (q[k] === undefined || q[k] === '' ? undefined : String(Array.isArray(q[k]) ? (q[k] as unknown[])[0] : q[k]))
  const numOf = (k: string, d: number, lo: number, hi: number) => {
    const s = str(k); if (s === undefined) return d
    const n = Number(s); if (!Number.isFinite(n)) throw bad(`${k} must be a number`)
    return Math.min(hi, Math.max(lo, n))
  }
  const format = (str('format') ?? 'png').toLowerCase().replace('jpg', 'jpeg') as Format
  if (!FORMATS.includes(format)) throw bad(`format must be one of ${FORMATS.join(', ')}`)
  const theme = (str('theme') ?? 'light').toLowerCase()
  if (theme !== 'light' && theme !== 'dark') throw bad('theme must be light or dark')
  let background = (str('background') ?? 'canvas').toLowerCase()
  if (background.length === 6 && /^[0-9a-f]{6}$/.test(background)) background = '#' + background
  if (!['canvas', 'white', 'transparent'].includes(background) && !/^#[0-9a-f]{6}$/.test(background)) throw bad('background must be canvas, white, transparent or #rrggbb')
  const v = str('version') ?? str('v')
  const version = v === undefined ? undefined : Number(v)
  if (version !== undefined && !(Number.isInteger(version) && version > 0)) throw bad('version must be a positive integer')
  const html = !['0', 'false', 'off', 'no'].includes((str('html') ?? '1').toLowerCase())
  return {
    format, version, board: str('board')?.slice(0, 300), scale: numOf('scale', 1, 0.1, RENDER_LIMITS.maxScale), theme, background,
    max: str('max') === undefined ? undefined : numOf('max', 2048, 16, RENDER_LIMITS.maxEdge), padding: numOf('padding', DEFAULT_OPTIONS.padding, 0, 400),
    width: Math.round(numOf('width', DEFAULT_OPTIONS.page.w, 200, 3000)), height: Math.round(numOf('height', DEFAULT_OPTIONS.page.h, 200, RENDER_LIMITS.maxPageH)),
    quality: Math.round(numOf('quality', 85, 10, 100)), html,
  }
}

// ---- cache (versions are immutable, so entries never go stale; only the live version changes number) ---------------
const cache = new Map<string, { value: unknown, bytes: number }>()
let cacheBytes = 0
function cacheGet<T>(k: string): T | undefined {
  const e = cache.get(k); if (!e) return undefined
  cache.delete(k); cache.set(k, e) // most recent last
  return e.value as T
}
function cachePut(k: string, value: unknown, bytes: number) {
  if (bytes > RENDER_LIMITS.cacheBytes / 2) return
  const old = cache.get(k); if (old) { cacheBytes -= old.bytes; cache.delete(k) }
  cache.set(k, { value, bytes }); cacheBytes += bytes
  for (const [key, e] of cache) { if (cacheBytes <= RENDER_LIMITS.cacheBytes) break; cache.delete(key); cacheBytes -= e.bytes }
}
const inflight = new Map<string, Promise<unknown>>()
function once<T>(k: string, fn: () => Promise<T>): Promise<T> {
  const p = inflight.get(k) as Promise<T> | undefined
  if (p) return p
  const r = fn().finally(() => inflight.delete(k))
  inflight.set(k, r)
  return r
}

// ---- concurrency: rasterizing and browsers are CPU/RAM heavy, so a few at a time and a short queue --------------------
let running = 0
const waiting: (() => void)[] = []
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= RENDER_LIMITS.concurrent) {
    if (waiting.length >= RENDER_LIMITS.queued) throw bad('Too many renders in progress, try again shortly', 503)
    await new Promise<void>(res => waiting.push(res))
  } else running++
  try { return await fn() } finally { const next = waiting.shift(); if (next) next(); else running-- }
}

// ---- images -------------------------------------------------------------------------------------------------------------
function sniff(b: Buffer): string | null {
  if (b.length > 12 && b.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif'
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

// ---- the render ------------------------------------------------------------------------------------------------------------
interface Built { svg: string, xml: string, view: { w: number, h: number }, boards: RenderResult['boards'] }

async function build(artifactId: string, version: number, req: RenderRequest): Promise<Built> {
  const dsf = req.scale > 1.5 ? 2 : 1
  const key = `svg:${artifactId}:${version}:${JSON.stringify([req.board, req.theme, req.background, req.padding, req.width, req.height, req.html, dsf])}`
  const hit = cacheGet<Built>(key)
  if (hit) return hit
  return once(key, async () => {
    const fonts = await loadFonts()
    const files = new Set(listFiles(artifactId, version).map(f => f.path))
    const cj = readFile(artifactId, version, 'canvas.json')
    let canvas: Record<string, any> | null = null
    if (cj) { try { canvas = JSON.parse(cj.content.toString('utf8')) } catch { throw bad('canvas.json is not valid JSON', 422) } if (!canvas || typeof canvas !== 'object') canvas = null }
    if (!canvas && !files.has('index.html')) throw bad('This version has no canvas.json or index.html to render', 422)

    // Boards whose HTML we can draw for real.
    const boardPaths = canvas ? Object.keys(canvas.boards ?? {}).filter(p => files.has(p)) : ['index.html']
    const wanted = req.board ? boardPaths.filter(p => p === req.board) : boardPaths
    if (req.board && !wanted.length) throw bad(`No such board: ${req.board}`, 404)
    const size = (p: string) => { const b = canvas?.boards?.[p]; return { w: Math.min(8000, Math.max(1, Number(b?.w) || 800)), h: Math.min(8000, Math.max(1, Number(b?.h) || 600)) } }
    const shots = new Map<string, Shot>()
    if (req.html && wanted.length) {
      const items = wanted.slice(0, 60).map(p => ({ path: p, ...(canvas ? size(p) : { w: req.width, h: req.height, fit: 'content' as const }) }))
      const skey = `shot:${artifactId}:${version}:${dsf}:${JSON.stringify(items)}`
      let got = cacheGet<Map<string, Shot>>(skey)
      if (!got) {
        got = await limited(() => shootBoards(artifactId, version, items, dsf, p => { const t = canvas?.boards?.[p]?.tweaks; return t && typeof t === 'object' ? t : undefined }))
        if (got.size === items.length) cachePut(skey, got, [...got.values()].reduce((a, s) => a + s.uri.length, 0))
      }
      for (const [p, s] of got) shots.set(p, s)
    }
    const page = canvas ? undefined : shots.get('index.html')
    let embedded = 0
    const env: RenderEnv = {
      measure: measurer(fonts),
      image(src) {
        if (!ASSET_PATH.test(src)) return null
        const f = readFile(artifactId, version, src)
        if (!f || f.content.length > MAX_IMAGE_BYTES || embedded + f.content.length > RENDER_LIMITS.embeddedImageBytes) return null
        const mime = sniff(f.content); if (!mime) return null
        embedded += f.content.length
        return `data:${mime};base64,${f.content.toString('base64')}`
      },
      boardImage: p => shots.get(p)?.uri ?? null,
      boardText(p) { const f = readFile(artifactId, version, p); return f && f.contentType.startsWith('text/html') ? htmlOutline(f.content.toString('utf8')) : null },
    }
    const opts: Partial<RenderOptions> = { theme: req.theme, background: req.background, board: req.board, padding: req.padding, scale: req.scale, page: { w: page?.w ?? req.width, h: page?.h ?? req.height } }
    const scene = buildScene(canvas, env, opts)
    const built: Built = {
      svg: sceneToSvg(scene, { scale: 1 }), xml: sceneToXml(scene, { artifact: artifactId, version }),
      view: { w: scene.view.w, h: scene.view.h },
      boards: scene.boards.length ? (scene.boards.every(b => b.render === 'screenshot') ? 'screenshot' : 'outline') : 'none',
    }
    cachePut(key, built, built.svg.length + built.xml.length)
    return built
  })
}

export async function renderArtifact(artifactId: string, req: RenderRequest): Promise<RenderResult> {
  const a = getArtifact(artifactId)
  if (!a) throw bad('Artifact not found', 404)
  const version = req.version ?? a.current_version
  if (version > a.current_version) throw bad(`Version ${version} does not exist`, 404)
  const okey = `out:${artifactId}:${version}:${JSON.stringify(req)}`
  const hit = cacheGet<RenderResult>(okey)
  if (hit) return hit
  return once(okey, async () => {
    let built: Built
    try { built = await build(artifactId, version, { ...req, version }) } catch (e) { if (e instanceof RenderError) throw bad(e.message, e.status); throw e }
    let res: RenderResult
    const common = { ext: req.format === 'jpeg' ? 'jpg' : req.format, version, boards: built.boards }
    if (req.format === 'xml') res = { ...common, body: built.xml, type: TYPES.xml, width: Math.round(built.view.w), height: Math.round(built.view.h), scale: 1, etag: '' }
    else if (req.format === 'svg') {
      const k = Math.min(req.scale, RENDER_LIMITS.maxScale)
      res = { ...common, body: built.svg.replace(/^(<\?xml[^>]*>\s*<svg [^>]*?) width="\d+" height="\d+"/, `$1 width="${Math.max(1, Math.round(built.view.w * k))}" height="${Math.max(1, Math.round(built.view.h * k))}"`), type: TYPES.svg, width: Math.round(built.view.w * k), height: Math.round(built.view.h * k), scale: k, etag: '' }
    } else {
      const fonts = await loadFonts()
      const r = await limited(() => rasterize(built.svg, { format: req.format as 'png' | 'webp' | 'jpeg', scale: req.scale, max: req.max, background: req.background, quality: req.quality }, built.view.w, built.view.h, fonts.files))
      res = { ...common, body: r.body, type: TYPES[req.format], width: r.width, height: r.height, scale: r.scale, etag: '' }
    }
    res.etag = '"' + createHash('sha1').update(res.body).digest('base64url').slice(0, 20) + '"'
    cachePut(okey, res, typeof res.body === 'string' ? res.body.length : res.body.length)
    return res
  })
}

/** File name for a download: the artifact title (or board) as a slug. */
export function renderFilename(title: string, req: RenderRequest, ext: string) {
  const slug = (req.board ? `${title}-${req.board.replace(/\.html?$/i, '')}` : title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'artifact'
  return `${slug}.${ext}`
}
