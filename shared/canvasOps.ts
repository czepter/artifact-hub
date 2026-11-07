// Canvas-level edits: boards, sticky notes, text, shapes. One pure function, used by the server (authoritative)
// and by the viewer (optimistic preview), so both always agree on the result.

export type NoteKind = 'sticky' | 'text' | 'rect' | 'oval' | 'line' | 'arrow' | 'pen'
export const NOTE_KINDS: NoteKind[] = ['sticky', 'text', 'rect', 'oval', 'line', 'arrow', 'pen']
export const FILLS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'none']

export const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const
export const FILL_STYLES = ['solid', 'hatch', 'cross'] as const
export const ROUNDNESS = ['sharp', 'round'] as const
export const ARROWHEADS = ['none', 'arrow', 'triangle', 'dot', 'bar'] as const
export type BindTarget = { type: 'board' | 'note', id: string }
export type Bind = { start?: BindTarget | null, end?: BindTarget | null }

export interface BoardPatch { x?: number, y?: number, w?: number, h?: number, title?: string, is_interactive?: boolean, expand?: string | null, tweaks?: Record<string, unknown> | null, locked?: boolean | null, group?: string | null }
/** Fields that are `null` in a patch are cleared (removed from the stored note). */
export interface NoteInput {
  kind?: NoteKind, x?: number, y?: number, w?: number, h?: number, text?: string, fill?: string, color?: string, size?: string, bold?: boolean, points?: number[][]
  locked?: boolean | null, group?: string | null, stroke?: string | null, strokeWidth?: number | null, strokeStyle?: (typeof STROKE_STYLES)[number] | null
  fillStyle?: (typeof FILL_STYLES)[number] | null, roundness?: (typeof ROUNDNESS)[number] | null
  arrowStart?: (typeof ARROWHEADS)[number] | null, arrowEnd?: (typeof ARROWHEADS)[number] | null, bind?: Bind | null
}
export type ReorderMode = 'front' | 'back' | 'forward' | 'backward'

export type CanvasOp =
  | { type: 'addBoard', path?: string, title?: string, x: number, y: number, w: number, h: number }
  | { type: 'updateBoard', path: string, patch: BoardPatch }
  | { type: 'removeBoard', path: string }
  | { type: 'addNote', id: string, note: NoteInput }
  | { type: 'updateNote', id: string, patch: NoteInput }
  | { type: 'deleteNote', id: string }
  | { type: 'reorderNotes', ids: string[], mode: ReorderMode }
  /** Copies a board (its entry and its HTML file). `x`/`y` default to a 40px offset from the original. */
  | { type: 'duplicateBoard', path: string, title?: string, x?: number, y?: number }

export interface Canvas {
  v?: number, title?: string, launch?: unknown, pages?: unknown[], designSystems?: unknown[]
  boards: Record<string, Record<string, unknown>>
  order: string[]
  notes: Record<string, Record<string, unknown>>
  /** Back-to-front z-order of notes. Missing, or missing ids, fall back to the notes' key order. */
  noteOrder?: string[]
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
  cleanStyle(n, out)
  return out
}

const HEX = /^#[0-9a-f]{6}$/i
const oneOf = <T extends string>(v: unknown, list: readonly T[], name: string): T => {
  if (typeof v !== 'string' || !list.includes(v as T)) throw new CanvasError(400, `Invalid ${name}`)
  return v as T
}
/** Validates the optional style / structure fields shared by notes. `null` clears a field. */
function cleanStyle(n: NoteInput, out: Record<string, unknown>) {
  const set = (k: string, v: unknown, ok: () => unknown) => { if (v === null) delete out[k]; else if (v !== undefined) out[k] = ok() }
  if (n.locked !== undefined && n.locked !== null && typeof n.locked !== 'boolean') throw new CanvasError(400, 'locked must be true or false')
  if (n.locked === true) out.locked = true; else if (n.locked === false || n.locked === null) delete out.locked
  set('group', n.group, () => { if (typeof n.group !== 'string' || !ID.test(n.group)) throw new CanvasError(400, 'Invalid group'); return n.group })
  set('stroke', n.stroke, () => { if (typeof n.stroke !== 'string' || !HEX.test(n.stroke)) throw new CanvasError(400, 'Invalid stroke colour'); return n.stroke })
  set('strokeWidth', n.strokeWidth, () => clamp(n.strokeWidth, 1, 24, 'strokeWidth'))
  set('strokeStyle', n.strokeStyle, () => oneOf(n.strokeStyle, STROKE_STYLES, 'strokeStyle'))
  set('fillStyle', n.fillStyle, () => oneOf(n.fillStyle, FILL_STYLES, 'fillStyle'))
  set('roundness', n.roundness, () => oneOf(n.roundness, ROUNDNESS, 'roundness'))
  set('arrowStart', n.arrowStart, () => oneOf(n.arrowStart, ARROWHEADS, 'arrowStart'))
  set('arrowEnd', n.arrowEnd, () => oneOf(n.arrowEnd, ARROWHEADS, 'arrowEnd'))
  if (n.bind !== undefined) {
    if (n.bind === null) delete out.bind
    else {
      if (typeof n.bind !== 'object' || Array.isArray(n.bind)) throw new CanvasError(400, 'Invalid bind')
      const b: Bind = {}
      for (const end of ['start', 'end'] as const) {
        const t = n.bind[end]
        if (t === undefined || t === null) continue
        if (typeof t !== 'object' || (t.type !== 'board' && t.type !== 'note') || typeof t.id !== 'string' || t.id.length > 100) throw new CanvasError(400, 'Invalid bind target')
        b[end] = { type: t.type, id: t.id }
      }
      if (b.start || b.end) out.bind = b; else delete out.bind
    }
  }
}

export const BLANK_BOARD = (title: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title.replace(/[<>&"]/g, '')}</title></head>
<body style="margin: 0; font-family: system-ui, sans-serif; color: #1c1b19; background: #ffffff; min-height: 100vh"></body>
</html>
`

export interface CanvasResult {
  canvas: Canvas, addFiles: { path: string, content: string }[], removePaths: string[]
  /** Board files to copy byte for byte from the current version (`from`) to a new path (`to`). */
  copyFiles: { from: string, to: string }[]
}

/** Z-order, back to front: `noteOrder` first (ids that still exist), then any notes it does not mention, in key order. */
export function orderedNoteIds(c: Pick<Canvas, 'notes' | 'noteOrder'>): string[] {
  const seen = new Set<string>(), out: string[] = []
  for (const id of Array.isArray(c.noteOrder) ? c.noteOrder : []) if (c.notes?.[id] && !seen.has(id)) { seen.add(id); out.push(id) }
  for (const id of Object.keys(c.notes ?? {})) if (!seen.has(id)) out.push(id)
  return out
}

/** Moves `ids` in a back-to-front list. Relative order of the moved ids is kept. */
export function reorder(list: string[], ids: string[], mode: ReorderMode): string[] {
  const pick = new Set(ids)
  const moved = list.filter(i => pick.has(i))
  if (!moved.length) return list.slice()
  if (mode === 'front') return [...list.filter(i => !pick.has(i)), ...moved]
  if (mode === 'back') return [...moved, ...list.filter(i => !pick.has(i))]
  const out = list.slice()
  if (mode === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) if (pick.has(out[i]!) && !pick.has(out[i + 1]!)) [out[i], out[i + 1]] = [out[i + 1]!, out[i]!]
  } else {
    for (let i = 1; i < out.length; i++) if (pick.has(out[i]!) && !pick.has(out[i - 1]!)) [out[i], out[i - 1]] = [out[i - 1]!, out[i]!]
  }
  return out
}

function checkBind(canvas: Canvas, selfId: string | null, note: Record<string, unknown>) {
  const b = note.bind as Bind | undefined
  if (!b) return
  for (const end of ['start', 'end'] as const) {
    const t = b[end]
    if (!t) continue
    const exists = t.type === 'board' ? !!canvas.boards[t.id] : !!canvas.notes[t.id]
    if (!exists || (t.type === 'note' && t.id === selfId)) throw new CanvasError(400, `Cannot bind to ${t.type} ${t.id}`)
  }
}

/** A deleted board or note must not stay referenced by arrows bound to it. */
function clearBindsTo(canvas: Canvas, target: BindTarget) {
  for (const n of Object.values(canvas.notes)) {
    const b = n.bind as Bind | undefined
    if (!b) continue
    for (const end of ['start', 'end'] as const) if (b[end]?.type === target.type && b[end]?.id === target.id) delete b[end]
    if (!b.start && !b.end) delete n.bind
  }
}

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
  const copyFiles: { from: string, to: string }[] = []

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
        if (p.locked !== undefined) { if (p.locked !== null && typeof p.locked !== 'boolean') throw new CanvasError(400, 'locked must be true or false'); if (!p.locked) delete b.locked; else b.locked = true }
        if (p.group !== undefined) { if (p.group === null) delete b.group; else if (typeof p.group !== 'string' || !ID.test(p.group)) throw new CanvasError(400, 'Invalid group'); else b.group = p.group }
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
        clearBindsTo(canvas, { type: 'board', id: op.path })
        break
      }
      case 'addNote': {
        if (typeof op.id !== 'string' || !ID.test(op.id) || canvas.notes[op.id]) throw new CanvasError(400, 'Invalid or duplicate note id')
        if (Object.keys(canvas.notes).length >= 1000) throw new CanvasError(413, 'Too many notes')
        const clean = cleanNote(op.note ?? {})
        checkBind(canvas, op.id, clean)
        canvas.notes[op.id] = clean
        if (Array.isArray(canvas.noteOrder)) canvas.noteOrder = [...orderedNoteIds(canvas).filter(i => i !== op.id), op.id]
        break
      }
      case 'updateNote': {
        const n = canvas.notes[op.id]
        if (!n) throw new CanvasError(404, `No such note: ${op.id}`)
        const clean = cleanNote(op.patch ?? {}, n)
        if (op.patch?.bind !== undefined) checkBind(canvas, op.id, clean) // a stale bind elsewhere never blocks moving the note
        canvas.notes[op.id] = clean
        break
      }
      case 'deleteNote': {
        if (!canvas.notes[op.id]) throw new CanvasError(404, `No such note: ${op.id}`)
        delete canvas.notes[op.id]
        if (Array.isArray(canvas.noteOrder)) canvas.noteOrder = canvas.noteOrder.filter(i => i !== op.id)
        clearBindsTo(canvas, { type: 'note', id: op.id })
        break
      }
      case 'reorderNotes': {
        if (!Array.isArray(op.ids) || !op.ids.length || op.ids.length > 1000 || !op.ids.every(i => typeof i === 'string')) throw new CanvasError(400, 'Invalid note ids')
        if (!['front', 'back', 'forward', 'backward'].includes(op.mode)) throw new CanvasError(400, 'Invalid reorder mode')
        for (const id of op.ids) if (!canvas.notes[id]) throw new CanvasError(404, `No such note: ${id}`)
        canvas.noteOrder = reorder(orderedNoteIds(canvas), op.ids, op.mode)
        break
      }
      case 'duplicateBoard': {
        const src = canvas.boards[op.path]
        if (!src) throw new CanvasError(404, `No such board: ${op.path}`)
        const dot = op.path.lastIndexOf('.'), slash = op.path.lastIndexOf('/')
        const stem = op.path.slice(0, dot).replace(/-copy(-\d+)?$/, ''), ext = op.path.slice(dot)
        let path = '', n = 1
        do { path = `${stem}-copy${n > 1 ? '-' + n : ''}${ext}`; n++ } while (taken.has(path) || canvas.boards[path])
        if (!BOARD_PATH.test(path) || slash > dot) throw new CanvasError(400, 'Cannot name the copy')
        const title = (op.title ?? `${src.title ?? op.path} copy`).toString().slice(0, 80)
        const copy: Record<string, unknown> = JSON.parse(JSON.stringify(src))
        delete copy.group; delete copy.locked
        Object.assign(copy, { title, x: clamp(op.x ?? (+(src.x as number) || 0) + 40, -100000, 100000, 'x'), y: clamp(op.y ?? (+(src.y as number) || 0) + 40, -100000, 100000, 'y') })
        canvas.boards[path] = copy
        canvas.order.push(path)
        taken.add(path)
        copyFiles.push({ from: op.path, to: path })
        break
      }
      default:
        throw new CanvasError(400, `Unknown operation: ${(op as { type: string }).type}`)
    }
  }
  return { canvas, addFiles, removePaths, copyFiles }
}

const SAME_TARGET = (a: CanvasOp, b: CanvasOp) =>
  (a.type === 'updateNote' && b.type === 'updateNote' && a.id === b.id) || (a.type === 'updateBoard' && b.type === 'updateBoard' && a.path === b.path)

/**
 * Appends `incoming` to `pending`, folding an update into an earlier update of the same note or board when only
 * other updates lie between them (so the result is identical when replayed). Holding an arrow key or dragging
 * therefore never piles up towards the 200-operation limit.
 */
export function mergeOps(pending: CanvasOp[], incoming: CanvasOp[]): CanvasOp[] {
  const out = pending.slice()
  for (const op of incoming) {
    let merged = false
    if (op.type === 'updateNote' || op.type === 'updateBoard') {
      for (let i = out.length - 1; i >= 0; i--) {
        const prev = out[i]!
        if (SAME_TARGET(prev, op)) {
          const p = prev as Extract<CanvasOp, { type: 'updateNote' | 'updateBoard' }>
          const later = Object.fromEntries(Object.entries((op as typeof p).patch ?? {}).filter(([, v]) => v !== undefined))
          out[i] = { ...p, patch: { ...p.patch, ...later } } as CanvasOp
          merged = true
          break
        }
        if (prev.type !== 'updateNote' && prev.type !== 'updateBoard') break
      }
    }
    if (!merged) out.push(op)
  }
  return out
}
