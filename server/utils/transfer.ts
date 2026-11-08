import { randomBytes } from 'node:crypto'
import { emptyCanvas, applyCanvasOps, CanvasError, type Canvas } from '../../shared/canvasOps'
import { logEvent } from './events'
import { isSharedPath, listSharedFiles } from './sharedFiles'
import { listFiles, publish, readFile, requireArtifact } from './store'

/**
 * Copy or move boards (or the whole canvas) from one artifact to another.
 *
 * What travels with a board: its HTML file, its canvas entry (size, title, tweaks…), and every local file it needs: stylesheets, scripts,
 * images, fonts and other pages it references, followed through stylesheets and linked pages. Boards keep their layout relative to each
 * other and land to the right of the target's existing boards. With the whole canvas, notes (stickies, shapes, arrows, pictures) come along.
 *
 * Never silently destroys anything in the target: a board path that is taken gets a free name (links between the transferred boards are
 * updated); a dependency path that is taken with different bytes is left as it is in the target and reported as a conflict.
 * `_shared/…` references stay as they are (they resolve against the workspace) and are reported when the target's workspace lacks the file.
 * Move = copy, then remove the boards from the source (their dependencies stay: other boards may use them; comments stay on the source).
 */
export interface TransferResult {
  mode: 'copy' | 'move', source: string, target: string, targetVersion: number, sourceVersion?: number,
  boards: { from: string, to: string }[], files: string[], notes: number, warnings: string[],
}

const GAP = 120
const TEXT_REF = /^(text\/(html|css)|image\/svg)/
const bad = (m: string, code = 400) => createError({ statusCode: code, statusMessage: m })
const rid = () => randomBytes(4).toString('hex')

/** A reference from `from` resolved to an artifact path, or null for URLs, anchors and absolute paths. */
export function resolveRef(ref: string, from: string): string | null {
  let r = ref.trim()
  if (!r || /^(#|\/|[a-z][a-z0-9+.-]*:)/i.test(r)) return null
  r = r.split(/[?#]/)[0]!
  if (!r) return null
  try { r = decodeURIComponent(r) } catch { /* keep as written */ }
  const parts = from.includes('/') ? from.slice(0, from.lastIndexOf('/')).split('/') : []
  for (const seg of r.split('/')) {
    if (seg === '..') { if (!parts.length) return null; parts.pop() } else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/') || null
}

/** Every relative reference in an HTML or CSS text (src, href, poster, srcset, url(), @import). */
export function refsIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b(?:src|href|poster|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) out.push(m[1] ?? m[2] ?? '')
  for (const m of text.matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) for (const c of (m[1] ?? m[2] ?? '').split(',')) out.push(c.trim().split(/\s+/)[0] ?? '')
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]+))\s*\)/gi)) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  for (const m of text.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) out.push(m[1] ?? m[2] ?? '')
  return out
}

const freePath = (path: string, taken: Set<string>) => {
  if (!taken.has(path)) return path
  const dot = path.lastIndexOf('.'), stem = dot > path.lastIndexOf('/') ? path.slice(0, dot) : path, ext = dot > path.lastIndexOf('/') ? path.slice(dot) : ''
  for (let n = 2; ; n++) { const p = `${stem}-${n}${ext}`; if (!taken.has(p)) return p }
}

export function transferBoards(opts: { sourceId: string, targetId: string, boards?: string[] | null, mode?: 'copy' | 'move' }): TransferResult {
  const mode = opts.mode ?? 'copy'
  if (mode !== 'copy' && mode !== 'move') throw bad('mode must be copy or move')
  if (opts.sourceId === opts.targetId) throw bad('Pick a different artifact as the target. To duplicate a board inside the artifact, use Duplicate.')
  const src = requireArtifact(opts.sourceId), dst = requireArtifact(opts.targetId)
  const srcFiles = new Map(listFiles(src.id, src.current_version).map(f => [f.path, f]))
  const warnings: string[] = []

  // ---- source canvas (a plain single-page artifact counts as a canvas of one board)
  let srcCanvas: Canvas
  const rawSrc = readFile(src.id, src.current_version, 'canvas.json')
  if (rawSrc) { try { srcCanvas = JSON.parse(rawSrc.content.toString('utf8')) } catch { throw bad('The source canvas.json is not valid JSON', 422) } }
  else if (srcFiles.has('index.html')) srcCanvas = { ...emptyCanvas(src.title), boards: { 'index.html': { x: 0, y: 0, w: 1280, h: 800, title: src.title } }, order: ['index.html'] }
  else throw bad('The source has no boards')
  srcCanvas.boards ??= {}; srcCanvas.notes ??= {}; srcCanvas.order ??= []
  const whole = !opts.boards || !opts.boards.length
  const picked = whole ? Object.keys(srcCanvas.boards) : [...new Set(opts.boards!)]
  if (!picked.length) throw bad('The source has no boards')
  for (const p of picked) if (!srcCanvas.boards[p]) throw bad(`No such board: ${p}`, 404)
  if (mode === 'move' && !rawSrc) throw bad('A single-page artifact cannot be emptied by moving its page. Copy it instead.')
  const order = [...srcCanvas.order.filter(p => picked.includes(p)), ...picked.filter(p => !srcCanvas.order.includes(p))]

  // ---- target canvas (a plain page there becomes the first board, as when adding a board to it)
  const dstFiles = new Map(listFiles(dst.id, dst.current_version).map(f => [f.path, f]))
  let dstCanvas: Canvas
  const rawDst = readFile(dst.id, dst.current_version, 'canvas.json')
  if (rawDst) { try { dstCanvas = JSON.parse(rawDst.content.toString('utf8')) } catch { throw bad('The target canvas.json is not valid JSON', 422) } }
  else {
    dstCanvas = emptyCanvas(dst.title)
    if (dstFiles.has('index.html')) { dstCanvas.boards['index.html'] = { x: 0, y: 0, w: 1280, h: 800, title: 'Page', expand: 'fill' }; dstCanvas.order.push('index.html') }
  }
  dstCanvas.boards ??= {}; dstCanvas.notes ??= {}; dstCanvas.order ??= []

  // ---- what the boards need
  const deps = new Set<string>(), missingShared = new Set<string>(), brokenLinks = new Set<string>(), noteAssets = new Set<string>()
  const scan = (path: string, seen = new Set<string>()) => {
    if (seen.has(path)) return
    seen.add(path)
    const f = srcFiles.get(path)
    if (!f || !TEXT_REF.test(f.content_type)) return
    const text = readFile(src.id, src.current_version, path)!.content.toString('utf8')
    for (const raw of refsIn(text)) {
      const to = resolveRef(raw, path)
      if (!to || to === path) continue
      if (isSharedPath(to)) { if (src.workspace_id !== dst.workspace_id && !listSharedFiles(dst.workspace_id).some(s => s.ref === to)) missingShared.add(to); continue }
      if (!srcFiles.has(to)) continue
      if (srcCanvas.boards[to]) { if (!picked.includes(to)) brokenLinks.add(`${path} → ${to}`); continue }
      deps.add(to)
      scan(to, seen)
    }
  }
  for (const p of picked) { if (!srcFiles.has(p)) throw bad(`The file of board ${p} is missing`, 404); scan(p) }
  if (whole) for (const n of Object.values(srcCanvas.notes)) if (n.kind === 'image' && typeof n.src === 'string' && srcFiles.has(n.src)) { deps.add(n.src); noteAssets.add(n.src) }

  // ---- placement and names in the target
  const taken = new Set<string>([...dstFiles.keys(), ...Object.keys(dstCanvas.boards)])
  const boardMap = new Map<string, string>()
  for (const p of order) { const to = freePath(p, taken); taken.add(to); boardMap.set(p, to) }
  const dstBoards = Object.values(dstCanvas.boards)
  const minX = Math.min(...order.map(p => +(srcCanvas.boards[p]!.x as number) || 0)), minY = Math.min(...order.map(p => +(srcCanvas.boards[p]!.y as number) || 0))
  const dx = (dstBoards.length ? Math.max(...dstBoards.map(b => (+(b.x as number) || 0) + (+(b.w as number) || 0))) + GAP : 0) - minX
  const dy = (dstBoards.length ? Math.min(...dstBoards.map(b => +(b.y as number) || 0)) : 0) - minY
  const groups = new Map<string, string>()
  const group = (g: unknown) => (typeof g === 'string' ? (groups.get(g) ?? (groups.set(g, `g${rid()}`), groups.get(g)!)) : undefined)
  const shift = (o: Record<string, unknown>) => { o.x = (+(o.x as number) || 0) + dx; o.y = (+(o.y as number) || 0) + dy; const g = group(o.group); if (g) o.group = g; else delete o.group }

  for (const p of order) {
    const b = JSON.parse(JSON.stringify(srcCanvas.boards[p])) as Record<string, unknown>
    shift(b)
    dstCanvas.boards[boardMap.get(p)!] = b
    dstCanvas.order.push(boardMap.get(p)!)
  }
  let notes = 0
  if (whole) {
    const idMap = new Map<string, string>(), before = Object.keys(dstCanvas.notes)
    for (const id of Object.keys(srcCanvas.notes)) { let n = id; while (dstCanvas.notes[n]) n = `${id}-${rid()}`; idMap.set(id, n) }
    for (const [id, note] of Object.entries(srcCanvas.notes)) {
      const n = JSON.parse(JSON.stringify(note)) as Record<string, unknown>
      shift(n)
      const bind = n.bind as { start?: { type: string, id: string }, end?: { type: string, id: string } } | undefined
      if (bind) {
        const ends = [bind.start, bind.end].map(e => e && (e.type === 'note' ? idMap.get(e.id) : e.type === 'board' ? boardMap.get(e.id) : undefined))
        if (ends.every((e, i) => e !== undefined || ![bind.start, bind.end][i])) {
          if (bind.start) bind.start.id = ends[0]!
          if (bind.end) bind.end.id = ends[1]!
        } else delete n.bind
      }
      dstCanvas.notes[idMap.get(id)!] = n
      notes++
    }
    // The transferred notes stack above the target's own, in their own order.
    const fresh = [...idMap.values()]
    const own = (Array.isArray(srcCanvas.noteOrder) ? srcCanvas.noteOrder.map(i => idMap.get(i)).filter((x): x is string => !!x) : [])
    if (Array.isArray(dstCanvas.noteOrder) || own.length) dstCanvas.noteOrder = [...(Array.isArray(dstCanvas.noteOrder) ? dstCanvas.noteOrder : before), ...own, ...fresh.filter(i => !own.includes(i))]
  }

  // ---- files to write
  const files: { path: string, content: string, encoding: 'base64' }[] = []
  const conflicts: string[] = []
  const b64 = (path: string) => readFile(src.id, src.current_version, path)!.content
  for (const p of order) {
    let content = b64(p).toString('utf8')
    for (const [from, to] of boardMap) if (from !== to) content = content.split(`"${from}"`).join(`"${to}"`).split(`'${from}'`).join(`'${to}'`)
    files.push({ path: boardMap.get(p)!, content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64' })
  }
  for (const d of deps) {
    const bytes = b64(d), existing = dstFiles.has(d) ? readFile(dst.id, dst.current_version, d) : undefined
    if (!existing) files.push({ path: d, content: bytes.toString('base64'), encoding: 'base64' })
    else if (!existing.content.equals(bytes)) conflicts.push(d)
  }
  if (conflicts.length) warnings.push(`Kept the target's own version of ${conflicts.join(', ')}: a file with that name already exists there and differs. Boards will use the target's file; put it in the workspace's shared files to make one version for both.`)
  if (missingShared.size) warnings.push(`The target is in another workspace that lacks ${[...missingShared].join(', ')}.`)
  if (brokenLinks.size) warnings.push(`Links to boards that were not transferred will not work in the target: ${[...brokenLinks].join('; ')}.`)

  // ---- publish: target first (a failure leaves the source untouched), then the source for a move
  const pub = publish({
    id: dst.id, baseVersion: dst.current_version, label: `${mode === 'move' ? 'Moved' : 'Copied'} ${order.length} board${order.length === 1 ? '' : 's'} from ${src.title}`.slice(0, 60),
    files: [{ path: 'canvas.json', content: JSON.stringify(dstCanvas, null, 2) }, ...files],
  })
  const result: TransferResult = {
    mode, source: src.id, target: dst.id, targetVersion: pub.version, boards: order.map(p => ({ from: p, to: boardMap.get(p)! })),
    files: files.map(f => f.path), notes, warnings,
  }
  if (mode === 'move') {
    try {
      const r = applyCanvasOps(srcCanvas, [...srcFiles.keys()], order.map(path => ({ type: 'removeBoard' as const, path })))
      if (whole) { r.canvas.notes = {}; delete r.canvas.noteOrder } // the notes went with the canvas
      result.sourceVersion = publish({
        id: src.id, baseVersion: src.current_version, label: `Moved ${order.length} board${order.length === 1 ? '' : 's'} to ${dst.title}`.slice(0, 60),
        files: [{ path: 'canvas.json', content: JSON.stringify(r.canvas, null, 2) }], remove: r.removePaths,
      }).version
    } catch (e) {
      if (e instanceof CanvasError) throw bad(`Copied to “${dst.title}”, but the boards could not be removed from “${src.title}”: ${e.message}`, e.status)
      throw createError({ statusCode: 409, statusMessage: `Copied to “${dst.title}”, but removing the boards from “${src.title}” failed (it changed meanwhile). Remove them there by hand.` })
    }
  }
  try { logEvent(mode === 'move' ? 'boards moved' : 'boards copied', `${src.title} → ${dst.title} (${order.length})`) } catch { /* the log never blocks */ }
  return result
}
