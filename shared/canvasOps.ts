// Canvas-level edits: boards, sticky notes, text, shapes. One pure function, used by the server (authoritative)
// and by the viewer (optimistic preview), so both always agree on the result.

export type NoteKind = 'sticky' | 'text' | 'rect' | 'oval' | 'line' | 'arrow' | 'pen'
export const NOTE_KINDS: NoteKind[] = ['sticky', 'text', 'rect', 'oval', 'line', 'arrow', 'pen']
export const FILLS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'none']

export interface BoardPatch { x?: number, y?: number, w?: number, h?: number, title?: string, is_interactive?: boolean, expand?: string | null, tweaks?: Record<string, unknown> | null }
export interface NoteInput { kind?: NoteKind, x?: number, y?: number, w?: number, h?: number, text?: string, fill?: string, color?: string, size?: string, bold?: boolean, points?: number[][] }

export type CanvasOp =
  | { type: 'addBoard', path?: string, title?: string, x: number, y: number, w: number, h: number }
  | { type: 'updateBoard', path: string, patch: BoardPatch }
  | { type: 'removeBoard', path: string }
  | { type: 'addNote', id: string, note: NoteInput }
  | { type: 'updateNote', id: string, patch: NoteInput }
  | { type: 'deleteNote', id: string }

export interface Canvas {
  v?: number, title?: string, launch?: unknown, pages?: unknown[], designSystems?: unknown[]
  boards: Record<string, Record<string, unknown>>
  order: string[]
  notes: Record<string, Record<string, unknown>>
  [k: string]: unknown
}

export class CanvasError extends Error { constructor(public status: number, message: string) { super(message) } }

const ID = /^[A-Za-z0-9_-]{1,40}$/
const clamp = (n: unknown, lo: number, hi: number, name: string) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new CanvasError(400, `${name} must be a number`)
  return Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100
}
const BOARD_PATH = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}(\/[A-Za-z0-9][A-Za-z0-9_.-]{0,80}){0,3}\.html?$/

export function emptyCanvas(title = 'Canvas'): Canvas {
  return { v: 3, title, launch: { view: 'canvas' }, pages: [], boards: {}, order: [], notes: {}, designSystems: [] }
}

function cleanNote(n: NoteInput, base: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  if (n.kind !== undefined) {
    if (!NOTE_KINDS.includes(n.kind)) throw new CanvasError(400, `Unknown note kind: ${n.kind}`)
    out.kind = n.kind
  }
  for (const k of ['x', 'y'] as const) if (n[k] !== undefined) out[k] = clamp(n[k], -100000, 100000, k)
  // Only lines and arrows are drawn from a start to an end point, so only they may have negative extents.
  const directed = (n.kind ?? base.kind) === 'line' || (n.kind ?? base.kind) === 'arrow'
  for (const k of ['w', 'h'] as const) if (n[k] !== undefined) out[k] = clamp(n[k], directed ? -8000 : 8, 8000, k)
  if (n.text !== undefined) { if (typeof n.text !== 'string' || n.text.length > 2000) throw new CanvasError(400, 'Note text is too long'); out.text = n.text }
  if (n.fill !== undefined) { if (!FILLS.includes(n.fill) && !/^#[0-9a-f]{6}$/i.test(n.fill)) throw new CanvasError(400, 'Invalid fill'); out.fill = n.fill }
  if (n.color !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(n.color)) throw new CanvasError(400, 'Invalid colour'); out.color = n.color }
  if (n.size !== undefined) { if (!['s', 'm', 'l', 'xl', 'xxl'].includes(n.size)) throw new CanvasError(400, 'Invalid size'); out.size = n.size }
  if (n.bold !== undefined) out.bold = !!n.bold
  if (n.points !== undefined) {
    if (!Array.isArray(n.points) || n.points.length > 400 || !n.points.every(p => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && Number.isFinite(v)))) throw new CanvasError(400, 'Invalid points')
    out.points = n.points.map(p => [Math.round(p[0]! * 10) / 10, Math.round(p[1]! * 10) / 10])
  }
  return out
}

export const BLANK_BOARD = (title: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title.replace(/[<>&"]/g, '')}</title></head>
<body style="margin: 0; font-family: system-ui, sans-serif; color: #1c1b19; background: #ffffff; min-height: 100vh"></body>
</html>
`

export interface CanvasResult { canvas: Canvas, addFiles: { path: string, content: string }[], removePaths: string[] }

/**
 * Applies operations to a canvas. `files` lists the artifact's current paths (to avoid overwriting when a new
 * board file is created, and to convert a single index.html artifact into a canvas on the first addBoard).
 */
export function applyCanvasOps(input: Canvas | null, files: string[], ops: CanvasOp[]): CanvasResult {
  if (!Array.isArray(ops) || !ops.length) throw new CanvasError(400, 'No operations')
  if (ops.length > 200) throw new CanvasError(413, 'Too many operations')
  const canvas: Canvas = input ? JSON.parse(JSON.stringify(input)) : emptyCanvas()
  canvas.boards ??= {}; canvas.order ??= []; canvas.notes ??= {}
  const taken = new Set(files)
  const addFiles: { path: string, content: string }[] = []
  const removePaths: string[] = []

  for (const op of ops) {
    switch (op.type) {
      case 'addBoard': {
        // First board on a plain single-page artifact: keep the page as the first board of the new canvas.
        if (!Object.keys(canvas.boards).length && taken.has('index.html')) {
          canvas.boards['index.html'] = { x: 0, y: 0, w: 1280, h: 800, title: 'Page', expand: 'fill' }
          canvas.order.push('index.html')
        }
        let path = op.path
        if (path !== undefined && !BOARD_PATH.test(path)) throw new CanvasError(400, 'Invalid board path')
        if (!path) {
          const stem = (op.title ?? 'Board').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'board'
          let n = 1
          do { path = `${stem}${n > 1 ? '-' + n : ''}.html`; n++ } while (taken.has(path) || canvas.boards[path])
        }
        if (taken.has(path!) || canvas.boards[path!]) throw new CanvasError(409, `A file named ${path} already exists`)
        const title = (op.title ?? 'Board').slice(0, 80)
        canvas.boards[path!] = { x: clamp(op.x, -100000, 100000, 'x'), y: clamp(op.y, -100000, 100000, 'y'), w: clamp(op.w, 40, 8000, 'w'), h: clamp(op.h, 40, 8000, 'h'), title }
        canvas.order.push(path!)
        taken.add(path!)
        addFiles.push({ path: path!, content: BLANK_BOARD(title) })
        break
      }
      case 'updateBoard': {
        const b = canvas.boards[op.path]
        if (!b) throw new CanvasError(404, `No such board: ${op.path}`)
        const p = op.patch ?? {}
        for (const k of ['x', 'y'] as const) if (p[k] !== undefined) b[k] = clamp(p[k], -100000, 100000, k)
        for (const k of ['w', 'h'] as const) if (p[k] !== undefined) b[k] = clamp(p[k], 40, 8000, k)
        if (p.title !== undefined) { if (typeof p.title !== 'string' || p.title.length > 80) throw new CanvasError(400, 'Invalid title'); b.title = p.title }
        if (p.is_interactive !== undefined) b.is_interactive = !!p.is_interactive
        if (p.expand !== undefined) { if (p.expand === null || p.expand === '') delete b.expand; else if (p.expand === 'fill') b.expand = 'fill'; else throw new CanvasError(400, 'Invalid expand') }
        if (p.tweaks !== undefined) {
          if (p.tweaks === null) delete b.tweaks
          else if (typeof p.tweaks !== 'object' || Array.isArray(p.tweaks) || JSON.stringify(p.tweaks).length > 8000) throw new CanvasError(400, 'Invalid tweaks')
          else b.tweaks = p.tweaks
        }
        break
      }
      case 'removeBoard': {
        if (!canvas.boards[op.path]) throw new CanvasError(404, `No such board: ${op.path}`)
        delete canvas.boards[op.path]
        canvas.order = canvas.order.filter(x => x !== op.path)
        removePaths.push(op.path)
        break
      }
      case 'addNote': {
        if (typeof op.id !== 'string' || !ID.test(op.id) || canvas.notes[op.id]) throw new CanvasError(400, 'Invalid or duplicate note id')
        if (Object.keys(canvas.notes).length >= 1000) throw new CanvasError(413, 'Too many notes')
        canvas.notes[op.id] = cleanNote(op.note ?? {})
        break
      }
      case 'updateNote': {
        const n = canvas.notes[op.id]
        if (!n) throw new CanvasError(404, `No such note: ${op.id}`)
        canvas.notes[op.id] = cleanNote(op.patch ?? {}, n)
        break
      }
      case 'deleteNote': {
        if (!canvas.notes[op.id]) throw new CanvasError(404, `No such note: ${op.id}`)
        delete canvas.notes[op.id]
        break
      }
      default:
        throw new CanvasError(400, `Unknown operation: ${(op as { type: string }).type}`)
    }
  }
  return { canvas, addFiles, removePaths }
}
