import { parse } from 'parse5'

// Turns a page saved from claude.ai into the files of a hub artifact. Pure: no database, no request, and nothing from the
// source page is ever executed. The page is parsed as HTML (parse5), the embedded document is read with JSON.parse, and
// every value is validated before it lands in a file. Runs without Nuxt so it can be unit-tested directly.

export const IMPORT_LIMITS = { sourceBytes: 16 * 1024 * 1024, boardPx: 8000, notes: 1000 }

/** The reason an artifact cannot be imported. Reported for that artifact only. */
export class ImportError extends Error {}

export interface ImportFile { path: string, content: string, encoding?: 'utf8' | 'base64' }
export interface Converted {
  kind: 'canvas' | 'page'
  title: string
  files: ImportFile[]
  boards: number
  notes: number
  warnings: string[]
  /** Source files that were not stored, with the reason (for example the editor's own runtime). */
  dropped: string[]
}

const ARTBOARD_FIELDS = new Set(['file', 'x', 'y', 'w', 'h', 'title'])
const ANNOTATION_FIELDS = new Set(['id', 'x', 'y', 'w', 'text'])
const CANVAS_FIELDS = new Set(['title', 'launch', 'artboards', 'annotations', 'v'])
const CLAUDE_API = /\b(?:window|globalThis|self)\s*\.\s*claude\b/

type Node = { nodeName: string, attrs?: { name: string, value: string }[], childNodes?: Node[], content?: Node, value?: string }

/** Text of the first <script id="appifact-doc">, or null. Walks the parsed tree; template contents are included. */
function findDocScript(html: string): string | null {
  if (!html.includes('appifact-doc')) return null
  const stack: Node[] = [parse(html) as unknown as Node]
  while (stack.length) {
    const n = stack.pop()!
    if (n.nodeName === 'script' && n.attrs?.some(a => a.name === 'id' && a.value === 'appifact-doc')) {
      return (n.childNodes ?? []).map(c => c.value ?? '').join('')
    }
    for (const c of n.childNodes ?? []) stack.push(c)
    if (n.content) stack.push(n.content)
  }
  return null
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Same rules as the hub's own paths, plus: no absolute paths and nothing under `_shared/`. Returns the normalized path. */
export function checkImportPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) throw new ImportError(`Invalid file path: ${JSON.stringify(raw)}`)
  const p = raw.replace(/\\/g, '/')
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) throw new ImportError(`Absolute path not allowed: ${raw}`)
  if (p.length > 300 || p.split('/').some(s => s === '..' || s === '.' || s === '') || p.includes('\0')) throw new ImportError(`Invalid file path: ${raw}`)
  if (p === '_shared' || p.startsWith('_shared/')) throw new ImportError(`Path under _shared/ not allowed: ${raw}`)
  return p
}

/** `content.files` as the editor stores it: a map path -> text, or a list of {path, content}. Values may be text or {content, encoding}. */
function readFiles(raw: unknown): Map<string, ImportFile> {
  const out = new Map<string, ImportFile>()
  const add = (rawPath: unknown, value: unknown) => {
    const path = checkImportPath(rawPath)
    let content: string, encoding: 'utf8' | 'base64' | undefined
    if (typeof value === 'string') content = value
    else if (isObj(value) && typeof value.content === 'string') { content = value.content; encoding = value.encoding === 'base64' ? 'base64' : undefined }
    else throw new ImportError(`File ${path} has no text content`)
    if (out.has(path)) throw new ImportError(`File listed twice: ${path}`)
    out.set(path, { path, content, encoding })
  }
  if (Array.isArray(raw)) for (const f of raw) { if (!isObj(f)) throw new ImportError('content.files has an entry that is not an object'); add(f.path ?? f.name, f) }
  else if (isObj(raw)) for (const [k, v] of Object.entries(raw)) add(k, v)
  else throw new ImportError('content.files is missing')
  return out
}

function num(v: unknown, what: string, opts: { positive?: boolean } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ImportError(`${what} is not a number`)
  const limit = IMPORT_LIMITS.boardPx
  if (opts.positive ? (v <= 0 || v > limit) : Math.abs(v) > 100000) throw new ImportError(`${what} = ${v} is out of range${opts.positive ? ` (1 to ${limit} px)` : ''}`)
  return v
}

/** Collects unknown field names with a count, so 300 notes with one unknown field give one warning, not 300. */
function unknownFields(items: Record<string, unknown>[], known: Set<string>, label: string, warnings: string[]) {
  const seen = new Map<string, number>()
  for (const it of items) for (const k of Object.keys(it)) if (!known.has(k)) seen.set(k, (seen.get(k) ?? 0) + 1)
  for (const [k, n] of seen) warnings.push(`${label}: unknown field "${k}" on ${n} ${n === 1 ? 'entry' : 'entries'}, not imported`)
}

function scanClaudeApi(files: ImportFile[], warnings: string[]) {
  for (const f of files) {
    if (f.encoding === 'base64' || !/\.(html?|js|mjs)$/i.test(f.path)) continue
    if (CLAUDE_API.test(f.content)) warnings.push(`${f.path} calls window.claude, which the hub does not provide`)
  }
}

export function convertSource(html: string, fallbackTitle = 'Imported artifact'): Converted {
  if (!html.trim()) throw new ImportError('The file is empty')
  const raw = findDocScript(html)
  const warnings: string[] = []
  const dropped: string[] = []

  if (raw === null) {
    // No embedded document. Without a sample of this kind of page the outer shell cannot be told from the content, so it is kept whole.
    const files: ImportFile[] = [{ path: 'index.html', content: html }]
    warnings.push('No appifact-doc found: the whole saved page is stored as index.html, including any outer shell')
    scanClaudeApi(files, warnings)
    return { kind: 'page', title: fallbackTitle, files, boards: 1, notes: 0, warnings, dropped }
  }

  let doc: unknown
  try { doc = JSON.parse(raw) } catch { throw new ImportError('appifact-doc is not valid JSON') }
  if (!isObj(doc)) throw new ImportError('appifact-doc is not an object')
  const title = (typeof doc.title === 'string' && doc.title.trim() ? doc.title.trim() : fallbackTitle).slice(0, 200)
  const content = isObj(doc.content) ? doc.content : null
  if (!content) throw new ImportError('appifact-doc has no content')
  const src = readFiles(content.files)

  if (Array.isArray(doc.comments) && doc.comments.length) warnings.push(`${doc.comments.length} comment(s) not imported (comments are not part of version 1)`)
  for (const k of Object.keys(doc)) if (!['title', 'content', 'comments'].includes(k)) warnings.push(`appifact-doc: unknown field "${k}", not imported`)

  // The editor ships its runtime itself; the hub answers ./support.js with its own, so a copy is never stored.
  for (const p of [...src.keys()]) {
    if (/(^|\/)support\.js$/.test(p) || /(^|\/)vendor\/react[^/]*\.js$/.test(p)) { src.delete(p); dropped.push(`${p} (replaced by the built-in runtime)`) }
  }

  const canvasFile = src.get('canvas.json')
  if (!canvasFile) {
    // A document without a canvas: a single page.
    const index = src.get('index.html') ?? [...src.values()].find(f => /\.html?$/i.test(f.path))
    if (!index) throw new ImportError('The document has neither canvas.json nor an HTML file')
    const files = [...src.values()].map(f => f === index && f.path !== 'index.html' ? { ...f, path: 'index.html' } : f)
    if (index.path !== 'index.html') warnings.push(`${index.path} stored as index.html`)
    scanClaudeApi(files, warnings)
    return { kind: 'page', title, files, boards: 1, notes: 0, warnings, dropped }
  }

  let src_canvas: unknown
  try { src_canvas = JSON.parse(canvasFile.content) } catch { throw new ImportError('canvas.json is not valid JSON') }
  if (!isObj(src_canvas)) throw new ImportError('canvas.json is not an object')
  for (const k of Object.keys(src_canvas)) if (!CANVAS_FIELDS.has(k)) warnings.push(`canvas.json: unknown field "${k}", not imported`)

  if (src_canvas.launch !== undefined && !isObj(src_canvas.launch)) warnings.push('canvas.json: launch is not an object, not imported')
  const artboards = src_canvas.artboards === undefined ? [] : src_canvas.artboards
  const annotations = src_canvas.annotations === undefined ? [] : src_canvas.annotations
  if (!Array.isArray(artboards) || !artboards.every(isObj)) throw new ImportError('canvas.json: artboards is not a list of objects')
  if (!Array.isArray(annotations) || !annotations.every(isObj)) throw new ImportError('canvas.json: annotations is not a list of objects')
  if (annotations.length > IMPORT_LIMITS.notes) throw new ImportError(`${annotations.length} notes (at most ${IMPORT_LIMITS.notes})`)
  if (!artboards.length) throw new ImportError('canvas.json has no artboards')
  unknownFields(artboards, ARTBOARD_FIELDS, 'artboards', warnings)
  unknownFields(annotations, ANNOTATION_FIELDS, 'annotations', warnings)

  const boards: Record<string, Record<string, unknown>> = {}
  const order: string[] = []
  for (const [i, a] of artboards.entries()) {
    const file = checkImportPath(a.file)
    const where = `artboards[${i}] (${file})`
    if (boards[file]) throw new ImportError(`${where}: board listed twice`)
    if (!src.has(file)) throw new ImportError(`${where}: the file is not in content.files`)
    const b: Record<string, unknown> = { x: num(a.x, `${where}.x`), y: num(a.y, `${where}.y`), w: num(a.w, `${where}.w`, { positive: true }), h: num(a.h, `${where}.h`, { positive: true }) }
    if (typeof a.title === 'string' && a.title) b.title = a.title.slice(0, 200)
    else if (a.title !== undefined && a.title !== null) warnings.push(`${where}: title is not text, not imported`)
    b.is_interactive = true
    boards[file] = b
    order.push(file)
  }

  const notes: Record<string, Record<string, unknown>> = {}
  for (const [i, a] of annotations.entries()) {
    const where = `annotations[${i}]`
    const id = typeof a.id === 'string' || typeof a.id === 'number' ? String(a.id) : ''
    if (!id || id === '__proto__') throw new ImportError(`${where}: id is missing`)
    if (notes[id]) throw new ImportError(`${where}: id ${id} is used twice`)
    if (typeof a.text !== 'string') throw new ImportError(`${where}: text is missing`)
    notes[id] = { x: num(a.x, `${where}.x`), y: num(a.y, `${where}.y`), w: num(a.w, `${where}.w`, { positive: true }), text: a.text }
  }

  const canvas: Record<string, unknown> = { v: 3, title, ...(isObj(src_canvas.launch) ? { launch: src_canvas.launch } : {}), boards, order, notes }
  const files: ImportFile[] = [{ path: 'canvas.json', content: JSON.stringify(canvas, null, 2) }]
  for (const f of src.values()) if (f.path !== 'canvas.json') files.push(f)
  scanClaudeApi(files, warnings)
  return { kind: 'canvas', title, files, boards: order.length, notes: Object.keys(notes).length, warnings, dropped }
}
