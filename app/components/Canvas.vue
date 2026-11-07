<script setup lang="ts">
import type { Comment, ViewData, Anchor } from '~/types'
import type { Canvas as CanvasT, CanvasOp } from '#shared/canvasOps'
import { type Box, type GeomItem, arrowPath, isDirected, penPath, moveEndpoint, noteBox, round1, scaleItems } from '#shared/canvasGeometry'
import type { SelRef } from '~/composables/useCanvasSelection'

import { ArrowLeft, ArrowRight, Download, Maximize2, Minus, Pencil, Play, Plus, Presentation, ScanSearch, SlidersHorizontal, StickyNote, Trash2, X } from '@lucide/vue'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { HANDLES } from '#shared/canvasGeometry'
import { boardKey, noteKey, refOfKey, useCanvasSelection } from '~/composables/useCanvasSelection'
import { ButtonGroup } from '@/components/ui/button-group'

type Tool = 'select' | 'hand' | 'text' | 'artboard' | 'sticky' | 'rect' | 'oval' | 'arrow' | 'line' | 'pen'

const props = defineProps<{
  data: ViewData
  /** Effective canvas: the saved one with not-yet-saved edits applied. */
  canvas?: CanvasT | null
  commentMode: boolean
  editMode: boolean
  tool: Tool
  dragMode?: 'free' | 'flow'
  selectedId: string | null
  draft: { board: string, anchor: Anchor } | null
  /** Performs window.artifact storage calls on behalf of a frame (runs with the viewer's session). */
  rpc: (req: { op: string, scope: string, key?: unknown, value?: unknown, prefix?: unknown }) => Promise<unknown>
  hello: () => unknown
}>()
const emit = defineEmits<{
  target: [payload: { board: string, anchor: Anchor }]
  select: [id: string]
  deselect: []
  pinsChanged: [located: Record<string, boolean>]
  focusChange: [path: string | null]
  editSelect: [board: string, info: Record<string, unknown> | null]
  editOp: [board: string, op: Record<string, unknown>]
  editNote: [text: string]
  editUndo: []
  editTree: [board: string, tree: unknown]
  editTweaks: [board: string, t: { defs: Record<string, unknown> | null, values: Record<string, unknown> }]
  editExport: [html: string]
  editReload: [board: string]
  /** One user gesture: all of its operations, saved together as one undo step. */
  canvasOps: [ops: CanvasOp[]]
  canvasSelect: [sel: SelRef[]]
  tool: [tool: Tool]
  play: [path: string]
  present: []
  openTweaks: [path: string]
  exportBoard: [path: string]
}>()

interface BoardView { path: string, x: number, y: number, w: number, h: number, title: string, interactive: boolean, expand: string, src: string, locked: boolean }
interface NoteView { id: string, kind: string, x: number, y: number, w: number, h: number, text: string, fill: string, color: string, size: string, bold: boolean, points: number[][], locked: boolean }
type Ov = { x: number, y: number, w: number, h: number, points: number[][] }

const viewport = ref<HTMLElement>()
const size = reactive({ w: 0, h: 0 })
const view_ = useCanvasView(viewport, size)
const { tx, ty, k, animate, pulse, zoomAt, centerOn, toWorld } = view_
const interacting = ref<string | null>(null) // double-clicked board whose page receives input while on the canvas
const focusBoard = ref<string | null>(null) // one board expanded to fill the window
const frames = new Map<string, HTMLIFrameElement>()
const pins = reactive<Record<string, { x: number, y: number }>>({})
const panning = ref(false)
// While editing, frame URLs are frozen so a save (new version) never reloads the board under the editor.
const frozenSrc = ref<Record<string, string> | null>(null)
// Live (not yet committed) geometry while dragging or resizing.
const boardOv = reactive<Record<string, Partial<Ov>>>({})
const noteOv = reactive<Record<string, Partial<Ov>>>({})
const creating = ref<{ tool: Tool, x: number, y: number, w: number, h: number, pts?: number[][] } | null>(null)
const editingNote = ref<string | null>(null)
const renamingBoard = ref<string | null>(null)
let saved: { tx: number, ty: number, k: number } | null = null

const cv = computed(() => (props.canvas ?? props.data.canvas) as any)
const isCanvas = computed(() => !!cv.value?.boards)
const revOf = computed(() => Object.fromEntries(props.data.files.map(f => [f.path, f.rev])))
/** Canvas-level editing: boards and notes, no board focused. */
const canvasLevel = computed(() => props.editMode && isCanvas.value && !focusBoard.value)
const elementLevel = (path: string) => props.editMode && (!isCanvas.value || focusBoard.value === path)

const boards = computed<BoardView[]>(() => {
  const c = cv.value
  const live = (p: string) => `${props.data.frameBase}${p.split('/').map(encodeURIComponent).join('/')}?r=${revOf.value[p] ?? 0}`
  const src = (p: string) => frozenSrc.value?.[p] ?? live(p)
  if (c?.boards) {
    const order: string[] = Array.isArray(c.order) ? c.order : Object.keys(c.boards)
    const rest = Object.keys(c.boards).filter(p => !order.includes(p))
    return [...order, ...rest].filter(p => c.boards[p] && revOf.value[p] !== undefined).map((p) => {
      const b = c.boards[p], o = boardOv[p] ?? {}
      return { path: p, x: o.x ?? (+b.x || 0), y: o.y ?? (+b.y || 0), w: o.w ?? (+b.w || 800), h: o.h ?? (+b.h || 600), title: b.title || p, interactive: !!b.is_interactive, expand: b.expand || '', src: src(p), locked: !!b.locked }
    })
  }
  return [{ path: 'index.html', x: 0, y: 0, w: size.w, h: size.h, title: '', interactive: true, expand: 'fill', src: src('index.html'), locked: false }]
})

/** A page-type board (expand: fill) takes the whole window when focused, so its layout reflows like a real page. */
function dims(b: BoardView) {
  return focusBoard.value === b.path && b.expand === 'fill' ? { w: size.w, h: size.h } : { w: b.w, h: b.h }
}


const notes = computed<NoteView[]>(() => {
  const n = cv.value?.notes ?? {}
  return Object.entries(n).map(([id, v]: [string, any]) => {
    const o = noteOv[id] ?? {}
    const kind = v.kind ?? 'sticky'
    return { id, kind, x: o.x ?? (+v.x || 0), y: o.y ?? (+v.y || 0), w: o.w ?? (v.w !== undefined ? +v.w : (kind === 'sticky' ? 240 : 360)), h: o.h ?? (+v.h || 0), text: String(v.text ?? ''), fill: v.fill ?? (kind === 'sticky' ? 'yellow' : 'none'), color: v.color ?? '#1c1b19', size: v.size ?? 'm', bold: !!v.bold, points: o.points ?? (Array.isArray(v.points) ? v.points : []), locked: !!v.locked }
  })
})

/** Everything selectable, with its geometry as shown right now (live drag overrides included). */
const allItems = computed<GeomItem[]>(() => [
  ...boards.value.map(b => ({ key: boardKey(b.path), kind: 'board', x: b.x, y: b.y, w: b.w, h: b.h, locked: b.locked })),
  ...notes.value.map(n => ({ key: noteKey(n.id), kind: n.kind, x: n.x, y: n.y, w: n.w, h: isDirected(n.kind) ? n.h : (n.h || noteBox(n).h), points: n.points, locked: n.locked })),
])
const selection = useCanvasSelection(allItems)
const selectedBoard = computed(() => selection.refs.value.find(r => r.type === 'board')?.id ?? null)

// ---- view transform --------------------------------------------------------------------------
function fit(animated = false) {
  if (!isCanvas.value || !size.w) { view_.reset(); return }
  const nb = notes.value.map(noteBox)
  view_.fitTo([...boards.value.map(b => ({ x: b.x, y: b.y - 28, w: b.w, h: b.h + 28 })), ...nb], animated)
}

// ---- focus (one board full window) -----------------------------------------------------------
function layoutFocus() {
  const b = boards.value.find(b => b.path === focusBoard.value)
  if (!b) return
  const d = dims(b)
  // Fills the canvas area edge to edge (letterboxed only when the board's aspect ratio differs).
  const nk = b.expand === 'fill' ? 1 : Math.min(size.w / d.w, size.h / d.h, 3)
  k.value = nk
  tx.value = (size.w - d.w * nk) / 2 - b.x * nk
  ty.value = (size.h - d.h * nk) / 2 - b.y * nk
}

function enterFocus(path: string) {
  if (!isCanvas.value || !boards.value.some(b => b.path === path)) return
  if (!focusBoard.value) saved = { tx: tx.value, ty: ty.value, k: k.value }
  pulse()
  interacting.value = null
  focusBoard.value = path
  selectBoard(path)
  layoutFocus()
  emit('focusChange', path)
  navKeys(true)
}

function exitFocus() {
  if (!focusBoard.value) return
  pulse()
  focusBoard.value = null
  if (saved) { tx.value = saved.tx; ty.value = saved.ty; k.value = saved.k; saved = null }
  emit('focusChange', null)
  navKeys(false)
}

function step(delta: number) {
  const list = boards.value
  const i = list.findIndex(b => b.path === focusBoard.value)
  if (i < 0 || list.length < 2) return
  enterFocus(list[(i + delta + list.length) % list.length]!.path)
}

function startPresent() {
  const first = boards.value[0]
  if (first && isCanvas.value) enterFocus(first.path)
}

const focusIndex = computed(() => boards.value.findIndex(b => b.path === focusBoard.value))

function navKeys(enabled: boolean) {
  for (const b of boards.value) postTo(b.path, { type: 'hub:nav-keys', enabled })
}

// ---- selection ---------------------------------------------------------------------------------
watch(() => (canvasLevel.value ? selection.refs.value : []), v => emit('canvasSelect', v), { deep: true })
function selectBoard(path: string | null) { selection.only(path ? boardKey(path) : null) }
function selectNote(id: string | null) { selection.only(id ? noteKey(id) : null) }

// ---- pointer / keyboard ----------------------------------------------------------------------
function onWheel(e: WheelEvent) {
  if (!isCanvas.value || focusBoard.value) return
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) {
    const r = viewport.value!.getBoundingClientRect()
    zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top)
  } else {
    tx.value -= e.deltaX
    ty.value -= e.deltaY
  }
}

type Drag =
  | { kind: 'pan', x: number, y: number, tx: number, ty: number, moved: boolean }
  | { kind: 'move', x: number, y: number, orig: { key: string, x: number, y: number }[], moved: boolean }
  | { kind: 'resize', handle: string, x: number, y: number, items: GeomItem[], bbox: Box, moved: boolean }
  | { kind: 'endpoint', id: string, which: 'start' | 'end', x: number, y: number, orig: Box, moved: boolean }
  | { kind: 'create', tool: Tool, sx: number, sy: number, moved: boolean }
  | { kind: 'pen', pts: number[][], moved: boolean }
let drag: Drag | null = null
let justDragged = false
const uid = () => 'nt' + Math.random().toString(36).slice(2, 8)
const round = round1
/** One user gesture = one batch: everything it changes goes out together, so it is one undo step. */
const send = (...ops: CanvasOp[]) => { if (ops.length) emit('canvasOps', ops) }

function capture(e: PointerEvent) { try { viewport.value!.setPointerCapture(e.pointerId) } catch {} }

const creationTool = computed(() => canvasLevel.value && props.tool !== 'select' && props.tool !== 'hand')
/** Board header buttons keep their press to themselves, unless a drawing tool is active. */
function hdrDown(e: PointerEvent) { if (!creationTool.value) e.stopPropagation() }

function onPointerDown(e: PointerEvent) {
  if (!isCanvas.value || focusBoard.value || (e.button !== 0 && e.button !== 1)) return
  const t = e.target as HTMLElement
  // The toolbar, zoom pill and rename field always take their own presses; board header icons only yield to a drawing tool.
  if (t.closest('.zoom, .focusbar, [data-toolbar], .rename') || (!creationTool.value && t.closest('[data-ui]'))) return
  if (!t.closest('[contenteditable="true"], input, textarea')) e.preventDefault()
  if (canvasLevel.value && e.button === 0 && props.tool !== 'select' && props.tool !== 'hand') {
    // Creation tools: a drag draws the shape, a click drops a default-sized one.
    const w = toWorld(e.clientX, e.clientY)
    drag = props.tool === 'pen' ? { kind: 'pen', pts: [[w.x, w.y]], moved: false } : { kind: 'create', tool: props.tool, sx: w.x, sy: w.y, moved: false }
    creating.value = props.tool === 'pen' ? { tool: 'pen', x: w.x, y: w.y, w: 0, h: 0, pts: [[w.x, w.y]] } : { tool: props.tool, x: w.x, y: w.y, w: 0, h: 0 }
    capture(e)
    return
  }
  drag = { kind: 'pan', x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value, moved: false }
}

/** Pressing a selectable thing: it becomes the selection (unless it is already part of one), and a drag moves the whole selection. */
function startMove(e: PointerEvent, key: string) {
  e.stopPropagation(); e.preventDefault() // no text selection, and no native drag that would cancel the pointer stream
  if (!selection.has(key)) selection.only(key)
  const orig = selection.selected.value.filter(i => !i.locked).map(i => ({ key: i.key, x: i.x, y: i.y }))
  drag = { kind: 'move', x: e.clientX, y: e.clientY, orig, moved: false }
}
function onBoardDown(e: PointerEvent, b: BoardView) {
  if (!canvasLevel.value || props.tool !== 'select' || e.button !== 0) return
  startMove(e, boardKey(b.path))
}
function onNoteDown(e: PointerEvent, n: NoteView) {
  if (!canvasLevel.value || props.tool !== 'select' || e.button !== 0 || editingNote.value === n.id) return
  startMove(e, noteKey(n.id))
}
/** A resize handle of the selection box: the same code path for one item or many. */
function onHandleDown(e: PointerEvent, handle: string) {
  e.stopPropagation(); e.preventDefault()
  const bbox = selection.bbox.value
  if (!bbox) return
  drag = { kind: 'resize', handle, x: e.clientX, y: e.clientY, items: selection.selected.value.map(i => ({ ...i, points: i.points?.map(p => [...p]) })), bbox: { ...bbox }, moved: false }
}
function onEndpointDown(e: PointerEvent, n: NoteView, which: 'start' | 'end') {
  e.stopPropagation(); e.preventDefault()
  drag = { kind: 'endpoint', id: n.id, which, x: e.clientX, y: e.clientY, orig: { x: n.x, y: n.y, w: n.w, h: n.h }, moved: false }
}

function setOverride(key: string, patch: Partial<Ov>) {
  const r = refOfKey(key)
  if (r.type === 'board') boardOv[r.id] = patch; else noteOv[r.id] = patch
}

function onPointerMove(e: PointerEvent) {
  if (!drag) return
  const d = drag
  if (d.kind === 'create') {
    const w = toWorld(e.clientX, e.clientY)
    if (!d.moved && Math.hypot(w.x - d.sx, w.y - d.sy) * k.value < 4) return
    d.moved = true
    const lined = d.tool === 'arrow' || d.tool === 'line'
    creating.value = lined ? { tool: d.tool, x: d.sx, y: d.sy, w: w.x - d.sx, h: w.y - d.sy } : { tool: d.tool, x: Math.min(d.sx, w.x), y: Math.min(d.sy, w.y), w: Math.abs(w.x - d.sx), h: Math.abs(w.y - d.sy) }
    return
  }
  if (d.kind === 'pen') {
    const w = toWorld(e.clientX, e.clientY), last = d.pts[d.pts.length - 1]!
    if (Math.hypot(w.x - last[0]!, w.y - last[1]!) * k.value < 3) return
    d.moved = true; d.pts.push([w.x, w.y]); creating.value = { tool: 'pen', x: 0, y: 0, w: 0, h: 0, pts: d.pts.slice() }
    return
  }
  const dx = e.clientX - d.x, dy = e.clientY - d.y
  if (!d.moved) {
    if (Math.hypot(dx, dy) < 4) return
    d.moved = true
    capture(e)
    if (d.kind === 'pan') panning.value = true
  }
  if (d.kind === 'pan') { tx.value = d.tx + dx; ty.value = d.ty + dy; return }
  const wx = dx / k.value, wy = dy / k.value
  if (d.kind === 'move') for (const o of d.orig) setOverride(o.key, { x: round(o.x + wx), y: round(o.y + wy) })
  else if (d.kind === 'resize') {
    const r = scaleItems(d.items, d.bbox, d.handle, { dx: wx, dy: wy, keepAspect: e.shiftKey, fromCenter: e.altKey })
    for (const [key, p] of Object.entries(r.patches)) setOverride(key, p)
  } else if (d.kind === 'endpoint') noteOv[d.id] = moveEndpoint(d.orig, d.which, wx, wy)
}

function finishCreate(d: Extract<Drag, { kind: 'create' }>, c: NonNullable<typeof creating.value>) {
  const tool = d.tool
  if (tool === 'artboard') {
    const w = d.moved && c.w > 20 && c.h > 20 ? c.w : 1280, h = d.moved && c.w > 20 && c.h > 20 ? c.h : 800
    const x = d.moved ? c.x : d.sx, y = d.moved ? c.y : d.sy
    send({ type: 'addBoard', title: 'Board', x: round(x), y: round(y), w: round(w), h: round(h) })
  } else {
    const id = uid()
    if (tool === 'sticky' || tool === 'text') {
      send({ type: 'addNote', id, note: { kind: tool, x: round(d.sx), y: round(d.sy), w: tool === 'sticky' ? 240 : 320, h: tool === 'sticky' ? 140 : 36, text: '' } })
      nextTick(() => { selectNote(id); editingNote.value = id })
    } else if (tool === 'arrow' || tool === 'line') {
      const w = d.moved ? c.w : 160, h = d.moved ? c.h : 0
      send({ type: 'addNote', id, note: { kind: tool, x: round(d.sx), y: round(d.sy), w: round(w), h: round(h) } })
      nextTick(() => selectNote(id))
    } else {
      const w = d.moved && c.w > 8 && c.h > 8 ? c.w : 160, h = d.moved && c.w > 8 && c.h > 8 ? c.h : 100
      send({ type: 'addNote', id, note: { kind: tool as 'rect' | 'oval', x: round(d.moved ? c.x : d.sx), y: round(d.moved ? c.y : d.sy), w: round(w), h: round(h), fill: 'none' } })
      nextTick(() => selectNote(id))
    }
  }
  emit('tool', 'select')
}

function onPointerUp(e: PointerEvent) {
  const d = drag
  drag = null
  panning.value = false
  try { viewport.value!.releasePointerCapture(e.pointerId) } catch {}
  if (!d) return
  if (d.kind === 'create' && creating.value) { const c = creating.value; creating.value = null; justDragged = true; setTimeout(() => (justDragged = false), 0); finishCreate(d, c); return }
  if (d.kind === 'pen') {
    creating.value = null
    justDragged = true; setTimeout(() => (justDragged = false), 0)
    if (d.pts.length > 2) {
      const x0 = Math.min(...d.pts.map(p => p[0]!)), y0 = Math.min(...d.pts.map(p => p[1]!))
      // Thin the stroke to at most 400 points before it is stored.
      const step = Math.max(1, Math.ceil(d.pts.length / 400))
      const pts = d.pts.filter((_, i) => i % step === 0 || i === d.pts.length - 1).map(p => [p[0]! - x0, p[1]! - y0])
      const id = uid()
      send({ type: 'addNote', id, note: { kind: 'pen', x: round(x0), y: round(y0), points: pts, color: '#1c1b19' } })
      nextTick(() => selectNote(id))
    }
    return
  }
  if (!d.moved) return
  justDragged = true
  setTimeout(() => (justDragged = false), 0)
  // Move, resize and endpoint drags all end the same way: every live override goes out as one batch.
  const keys = d.kind === 'move' ? d.orig.map(o => o.key) : d.kind === 'resize' ? d.items.filter(i => !i.locked).map(i => i.key) : d.kind === 'endpoint' ? [noteKey(d.id)] : []
  const ops: CanvasOp[] = []
  for (const key of keys) {
    const r = refOfKey(key), o = r.type === 'board' ? boardOv[r.id] : noteOv[r.id]
    if (o) ops.push((r.type === 'board' ? { type: 'updateBoard', path: r.id, patch: { ...o } } : { type: 'updateNote', id: r.id, patch: JSON.parse(JSON.stringify(o)) }) as CanvasOp)
  }
  send(...ops)
  nextTick(() => { for (const key of keys) { const r = refOfKey(key); if (r.type === 'board') delete boardOv[r.id]; else delete noteOv[r.id] } })
}

function onViewportClick(e: MouseEvent) {
  if (justDragged) return
  if ((e.target as HTMLElement).closest('[data-board], [data-ui], [data-note], .pin, [data-handle]')) return
  interacting.value = null
  selection.clear()
  renamingBoard.value = null
  emit('deselect')
}

// Notes: text editing, board rename
function startNoteEdit(n: NoteView) { if (canvasLevel.value && (n.kind === 'sticky' || n.kind === 'text')) { selectNote(n.id); editingNote.value = n.id } }
function commitNoteEdit(n: NoteView, e: Event | null, cancel = false) {
  if (editingNote.value !== n.id) return
  editingNote.value = null
  const el = e?.target as HTMLElement | undefined
  const text = (el?.innerText ?? n.text).replace(/\n$/, '')
  if (!cancel && text !== n.text) send({ type: 'updateNote', id: n.id, patch: { text } })
  if (!cancel && !text.trim() && !n.text.trim()) send({ type: 'deleteNote', id: n.id }) // an empty new note is not kept
}
// Focus the text field once per edit session (the flag is cleared when editing ends, so the next edit focuses again).
function noteRef(el: unknown, id: string) {
  const h = el as HTMLElement | null
  if (!h) return
  if (editingNote.value === id) { if (h.dataset.f !== '1') { h.dataset.f = '1'; nextTick(() => focusEl(h)) } } else delete h.dataset.f
}
function focusEl(el: unknown) { const n = el as HTMLElement | null; if (n) { n.focus(); const r = document.createRange(); r.selectNodeContents(n); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r) } }
/** Focus and select the rename field once when it appears. */
function focusRename(c: unknown) {
  const el = ((c as { $el?: unknown } | null)?.$el ?? c) as HTMLInputElement | null
  if (el && el.dataset && el.dataset.f !== '1') { el.dataset.f = '1'; nextTick(() => { el.focus(); el.select() }) }
}
function startRename(b: BoardView) { if (canvasLevel.value) { selectBoard(b.path); renamingBoard.value = b.path } }
function commitRename(b: BoardView, e: Event, cancel = false) {
  if (renamingBoard.value !== b.path) return
  renamingBoard.value = null
  const v = (e.target as HTMLInputElement).value.trim()
  if (!cancel && v && v !== b.title) send({ type: 'updateBoard', path: b.path, patch: { title: v } })
}

// ---- right-click menu ------------------------------------------------------------------------
const ctx = ref<{ type: 'board' | 'note' | 'canvas', id: string, x: number, y: number }>({ type: 'canvas', id: '', x: 0, y: 0 })
const ctxBoard = computed(() => ctx.value.type === 'board' ? boards.value.find(b => b.path === ctx.value.id) ?? null : null)
function onContextMenu(e: MouseEvent) {
  const t = e.target as HTMLElement
  const w = toWorld(e.clientX, e.clientY)
  const boardEl = t.closest('[data-board]') as HTMLElement | null
  const noteEl = t.closest('[data-note]') as HTMLElement | null
  if (noteEl?.dataset.id) { ctx.value = { type: 'note', id: noteEl.dataset.id, x: w.x, y: w.y }; if (canvasLevel.value) selectNote(noteEl.dataset.id) }
  else if (boardEl?.dataset.path) { ctx.value = { type: 'board', id: boardEl.dataset.path, x: w.x, y: w.y }; selectBoard(boardEl.dataset.path) }
  else ctx.value = { type: 'canvas', id: '', x: w.x, y: w.y }
}
function ctxDeleteBoard() {
  const b = ctxBoard.value
  if (b && window.confirm(`Delete the board "${b.title}"?\n\nIts file is removed from the current version (older versions keep it).`)) { send({ type: 'removeBoard', path: b.path }); selection.clear() }
}
function ctxAddBoard() { send({ type: 'addBoard', title: 'Board', x: round(ctx.value.x), y: round(ctx.value.y), w: 1280, h: 800 }) }
function ctxAddSticky() { send({ type: 'addNote', id: uid(), note: { kind: 'sticky', x: round(ctx.value.x), y: round(ctx.value.y), w: 240, text: '' } as any }) }

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', t: 'text', a: 'artboard', s: 'sticky', r: 'rect', o: 'oval', l: 'arrow', p: 'pen' }

interface KeyInfo { key: string, code?: string, mod?: boolean, shift?: boolean, alt?: boolean }

/** Ctrl/Cmd combinations the canvas owns. Returns true when handled (the caller then blocks the browser's own action). */
function handleMod(k: KeyInfo): boolean {
  if (!canvasLevel.value) return false
  if (k.code === 'KeyA' && !k.shift && !k.alt) { selection.selectAll(); return true }
  return false
}

function handleKey(input: string | KeyInfo) {
  const k: KeyInfo = typeof input === 'string' ? { key: input } : input
  const key = k.key
  if (key === 'undo') { if (props.editMode) emit('editUndo'); return }
  if (k.mod || k.alt) return // combinations are routed through handleMod, and only from the focused canvas
  if (focusBoard.value) {
    if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') step(1)
    else if (key === 'ArrowLeft' || key === 'PageUp') step(-1)
    else if (key === 'Escape') exitFocus()
    return
  }
  if (canvasLevel.value) {
    const t = TOOL_KEYS[key.toLowerCase()]
    if (t && key.length === 1) { emit('tool', t); return }
    if (key === 'Escape') { emit('tool', 'select'); selection.clear(); editingNote.value = null; return }
    if ((key === 'Delete' || key === 'Backspace') && selection.count.value) { deleteSelection(); return }
    if (key.startsWith('Arrow') && selection.count.value) { nudge(key); return }
  }
  if (key === '0') fit(true)
  else if (key === '+' || key === '=') zoomAt(1.2)
  else if (key === '-') zoomAt(1 / 1.2)
  else if (key === 'f' || key === 'Enter') { const p = selectedBoard.value ?? boards.value[0]?.path; if (p) enterFocus(p) }
  else if (key === 'Escape') { interacting.value = null; selection.clear(); emit('deselect') }
}

const boardWord = (n: number) => (n === 1 ? 'board' : `${n} boards`)
function confirmBoardDelete(list: { title: string }[]) {
  const what = list.length === 1 ? `the board "${list[0]!.title}"` : `${boardWord(list.length)}`
  return window.confirm(`Delete ${what}?\n\nThe ${list.length === 1 ? 'file is' : 'files are'} removed from the current version (older versions keep ${list.length === 1 ? 'it' : 'them'}).`)
}
/** Deletes everything selected (locked items stay) in one batch; boards ask once. */
function deleteSelection() {
  const list = selection.selected.value.filter(i => !i.locked)
  const gone = list.filter(i => i.kind === 'board').map(i => boards.value.find(b => boardKey(b.path) === i.key)!)
  if (gone.length && !confirmBoardDelete(gone)) return
  send(...list.map(i => (i.kind === 'board' ? { type: 'removeBoard', path: refOfKey(i.key).id } : { type: 'deleteNote', id: refOfKey(i.key).id }) as CanvasOp))
  selection.clear()
}
let shiftHeld = false
/** Arrow keys move the selection; the viewer folds a held key into one save. */
function nudge(key: string) {
  const step = shiftHeld ? 10 : 1
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
  send(...selection.selected.value.filter(i => !i.locked).map((i) => {
    const r = refOfKey(i.key), patch = { x: round(i.x + dx), y: round(i.y + dy) }
    return (r.type === 'board' ? { type: 'updateBoard', path: r.id, patch } : { type: 'updateNote', id: r.id, patch }) as CanvasOp
  }))
}

/** Does the canvas own the keyboard? True after the last press landed on it, so a stray Ctrl+D elsewhere stays the browser's. */
const canvasFocused = ref(false)
function onWindowPointer(e: PointerEvent) { canvasFocused.value = !!viewport.value?.contains(e.target as Node) }

function onKey(e: KeyboardEvent) {
  shiftHeld = e.shiftKey
  if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) return
  const mod = e.metaKey || e.ctrlKey
  if (mod || e.altKey) {
    // Browser shortcuts stay the browser's, unless the canvas has the focus and is being edited.
    if (mod && !e.altKey && canvasFocused.value && handleMod({ key: e.key, code: e.code, mod, shift: e.shiftKey, alt: e.altKey })) e.preventDefault()
    return
  }
  if (focusBoard.value && [' ', 'PageDown', 'PageUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault()
  if (canvasLevel.value && e.key.startsWith('Arrow') && selection.count.value) e.preventDefault()
  handleKey({ key: e.key, code: e.code, shift: e.shiftKey })
}

// ---- frame messaging -------------------------------------------------------------------------
function boardOfSource(src: MessageEventSource | null) {
  for (const [path, el] of frames) if (el.contentWindow === src) return boards.value.find(b => b.path === path)
  return undefined
}

// Messages must be plain data: values read from reactive props are Proxies, which the browser cannot structured-clone
// (that threw DataCloneError and stopped comment markers from locating themselves).
function postTo(path: string, msg: unknown) {
  frames.get(path)?.contentWindow?.postMessage(JSON.parse(JSON.stringify(msg)), '*')
}

function threadsFor(path: string) {
  return props.data.comments.filter((c: Comment) => !c.parent_id && c.anchor && c.board === path)
}

function locate(path: string) {
  const items = threadsFor(path).map(c => ({ id: c.id, selector: c.anchor!.selector, text: c.anchor!.text, rel: c.anchor!.rel }))
  if (items.length) postTo(path, { type: 'hub:locate', items })
}

function onMessage(e: MessageEvent) {
  const d = e.data
  if (!d || typeof d.type !== 'string' || !d.type.startsWith('hub:')) return
  const board = boardOfSource(e.source)
  if (!board) return
  if (d.type === 'hub:hello') {
    postTo(board.path, { type: 'hub:hello-result', info: props.hello() })
  } else if (d.type === 'hub:rpc') {
    const reply = (m: Record<string, unknown>) => postTo(board.path, { type: 'hub:rpc-result', id: d.id, ...m })
    if (typeof d.op !== 'string' || typeof d.scope !== 'string') return reply({ ok: false, error: 'bad request' })
    props.rpc({ op: d.op, scope: d.scope, key: d.key, value: d.value, prefix: d.prefix })
      .then(result => reply({ ok: true, result: result ?? null }))
      .catch((err: any) => reply({ ok: false, error: err?.data?.statusMessage ?? err?.statusMessage ?? err?.message ?? 'request failed' }))
  } else if (d.type === 'hub:key' && typeof d.key === 'string') {
    handleKey({ key: d.key, code: typeof d.code === 'string' ? d.code : undefined, mod: !!d.mod, shift: !!d.shift, alt: !!d.alt })
  } else if (d.type === 'hub:edit-select') {
    emit('editSelect', board.path, d.info ?? null)
  } else if (d.type === 'hub:edit-op' && d.op && props.editMode) {
    emit('editOp', board.path, d.op)
  } else if (d.type === 'hub:edit-note' && typeof d.text === 'string') {
    emit('editNote', d.text)
  } else if (d.type === 'hub:edit-tree') {
    emit('editTree', board.path, d.tree)
  } else if (d.type === 'hub:tweaks') {
    emit('editTweaks', board.path, { defs: d.defs ?? null, values: d.values ?? {} })
  } else if (d.type === 'hub:edit-export' && typeof d.html === 'string') {
    emit('editExport', d.html)
  } else if (d.type === 'hub:edit-reload') {
    emit('editReload', board.path)
  } else if (d.type === 'hub:ready') {
    postTo(board.path, { type: 'hub:comment-mode', enabled: props.commentMode })
    postTo(board.path, { type: 'hub:nav-keys', enabled: !!focusBoard.value })
    if (props.editMode) { postTo(board.path, { type: 'hub:edit-mode', enabled: true }); postTo(board.path, { type: 'hub:edit-cmd', cmd: 'drag-mode', mode: props.dragMode ?? 'free' }) }
    locate(board.path)
  } else if (d.type === 'hub:layout') {
    locate(board.path)
  } else if (d.type === 'hub:target' && props.commentMode) {
    emit('target', { board: board.path, anchor: d.anchor })
  } else if (d.type === 'hub:located') {
    const status: Record<string, boolean> = {}
    for (const it of d.items as { id: string, rect: { x: number, y: number, w: number, h: number } | null }[]) {
      const c = props.data.comments.find(c => c.id === it.id)
      if (!it.rect || !c) { delete pins[it.id]; status[it.id] = false; continue }
      const rel = c.anchor?.rel ?? { x: 0.5, y: 0.5 }
      pins[it.id] = { x: board.x + it.rect.x + rel.x * it.rect.w, y: board.y + it.rect.y + rel.y * it.rect.h }
      status[it.id] = true
    }
    emit('pinsChanged', status)
  }
}

watch(() => props.editMode, (enabled) => {
  if (enabled) {
    interacting.value = null
    frozenSrc.value = Object.fromEntries(boards.value.map(b => [b.path, b.src]))
  } else {
    frozenSrc.value = null // reload every board from the latest saved version
    selection.clear(); editingNote.value = null; renamingBoard.value = null
  }
  for (const b of boards.value) { postTo(b.path, { type: 'hub:edit-mode', enabled }); if (enabled) postTo(b.path, { type: 'hub:edit-cmd', cmd: 'drag-mode', mode: props.dragMode ?? 'free' }) }
})
watch(() => props.dragMode, (m) => { if (props.editMode) for (const b of boards.value) postTo(b.path, { type: 'hub:edit-cmd', cmd: 'drag-mode', mode: m ?? 'free' }) })
// A board that appears while editing (just created) is frozen at its first URL like the others.
watch(boards, (list) => {
  if (frozenSrc.value) for (const b of list) if (!(b.path in frozenSrc.value)) frozenSrc.value = { ...frozenSrc.value, [b.path]: b.src }
})

/** Reload one board from the live version (after an undo, or when an edit could not be saved). */
function reloadBoard(path: string) {
  const b = boards.value.find(b => b.path === path)
  if (!b) return
  const fresh = `${props.data.frameBase}${path.split('/').map(encodeURIComponent).join('/')}?r=${revOf.value[path] ?? 0}&k=${Date.now()}`
  if (frozenSrc.value) frozenSrc.value = { ...frozenSrc.value, [path]: fresh }
}

/** Which board is under this screen point, and where is that point in the board's own viewport (undoes the canvas zoom)? */
function boardAtPoint(cx: number, cy: number) {
  for (const [path, el] of frames) {
    if (focusBoard.value && focusBoard.value !== path) continue
    const r = el.getBoundingClientRect()
    if (r.width && r.height && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
      return { path, x: (cx - r.left) * (el.clientWidth / r.width), y: (cy - r.top) * (el.clientHeight / r.height) }
    }
  }
  return null
}

function editCmd(board: string, msg: Record<string, unknown>) {
  postTo(board, { type: 'hub:edit-cmd', ...msg })
}

watch(() => props.commentMode, (enabled) => {
  for (const b of boards.value) postTo(b.path, { type: 'hub:comment-mode', enabled })
  if (enabled) interacting.value = null
})
watch(() => props.data.comments, () => { for (const b of boards.value) locate(b.path) })
watch(() => [size.w, size.h], () => { if (focusBoard.value) layoutFocus() })
// A board that disappeared (new version) must not leave us stuck in focus mode.
watch(boards, (list) => { if (focusBoard.value && !list.some(b => b.path === focusBoard.value)) exitFocus() })

function broadcast(msg: unknown) {
  for (const b of boards.value) postTo(b.path, msg)
}

const draftPos = computed(() => {
  const d = props.draft
  if (!d) return null
  const b = boards.value.find(b => b.path === d.board)
  return b ? { x: b.x + d.anchor.click.x, y: b.y + d.anchor.click.y } : null
})

const visiblePins = computed(() => props.data.comments.filter(c => !c.parent_id && pins[c.id] && (!focusBoard.value || c.board === focusBoard.value)))
const numberOf = (c: Comment) => props.data.comments.filter(x => !x.parent_id).indexOf(c) + 1
const view = computed(() => ({ tx: tx.value, ty: ty.value, k: k.value }))

const firstBoard = computed(() => boards.value[0]?.path ?? null)
const selectedBoardPath = computed(() => selectedBoard.value)

// Selection box and handles, in world coordinates. One item or many: the same box, the same eight handles.
const selBox = computed(() => (canvasLevel.value ? selection.bbox.value : null))
const selNote = computed(() => { const it = selection.single.value; return it && it.key.startsWith('n:') ? notes.value.find(n => n.id === refOfKey(it.key).id) ?? null : null })
/** Line and arrow endpoints are dragged one at a time; pen strokes have no handles when alone. */
const endpointNote = computed(() => (selNote.value && isDirected(selNote.value.kind) && !selNote.value.locked ? selNote.value : null))
const showHandles = computed(() => !!selBox.value && !endpointNote.value && !(selNote.value && selNote.value.kind === 'pen') && selection.selected.value.some(i => !i.locked))
function hStyle(box: { x: number, y: number, w: number, h: number }, h: string) {
  const x = h.includes('w') ? box.x : h.includes('e') ? box.x + box.w : box.x + box.w / 2
  const y = h.includes('n') ? box.y : h.includes('s') ? box.y + box.h : box.y + box.h / 2
  return { left: x + 'px', top: y + 'px', transform: `translate(-50%, -50%) scale(${1 / k.value})`, cursor: ({ nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' } as Record<string, string>)[h] + '-resize' }
}
function endpoint(n: NoteView, which: 'start' | 'end') {
  const x = which === 'start' ? n.x : n.x + n.w, y = which === 'start' ? n.y : n.y + n.h
  return { left: x + 'px', top: y + 'px', transform: `translate(-50%, -50%) scale(${1 / k.value})`, cursor: 'move' }
}
const creatingPen = computed(() => creating.value?.pts ? creating.value.pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ') : '')
const inCanvasPage = computed(() => isCanvas.value && !focusBoard.value)

defineExpose({ boardAtPoint, editCmd, reloadBoard, firstBoard, selectedBoardPath, navKeys, fit, centerOn, pins, broadcast, view, draftPos, enterFocus, exitFocus, step, startPresent, focusBoard, focusIndex, boardCount: computed(() => boards.value.length), selectBoard, selectNote, zoomAt })

let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    const first = size.w === 0
    size.w = entry!.contentRect.width
    size.h = entry!.contentRect.height
    if (first) fit()
  })
  ro.observe(viewport.value!)
  window.addEventListener('message', onMessage)
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', onWindowPointer, true)
  window.addEventListener('keyup', e => { shiftHeld = e.shiftKey })
  viewport.value!.addEventListener('wheel', onWheel, { passive: false })
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('message', onMessage)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', onWindowPointer, true)
})
watch(isCanvas, () => nextTick(() => fit()))
</script>

<template>
  <ContextMenu :disabled="!isCanvas || !!focusBoard">
  <ContextMenuTrigger as-child>
  <div
    ref="viewport"
    class="canvas"
    :class="{ panning, page: !isCanvas, focus: !!focusBoard, tool: canvasLevel && tool !== 'select' && tool !== 'hand', hand: tool === 'hand' && canvasLevel }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @click="onViewportClick"
    @contextmenu="onContextMenu"
  >
    <div class="world" :class="{ anim: animate }" :style="{ transform: `translate(${tx}px, ${ty}px) scale(${k})` }">
      <div
        v-for="b in boards"
        :key="b.path"
        data-board
        :data-path="b.path"
        class="board"
        :class="{ interacting: interacting === b.path, selected: selection.has(boardKey(b.path)) && !focusBoard && isCanvas, full: focusBoard === b.path }"
        :style="{ left: b.x + 'px', top: b.y + 'px', width: dims(b).w + 'px', height: dims(b).h + 'px', visibility: focusBoard && focusBoard !== b.path ? 'hidden' : 'visible' }"
      >
        <div v-if="isCanvas && !focusBoard" class="board-title" :style="{ transform: `scale(${1 / k})`, width: b.w * k + 'px' }">
          <Input
            v-if="renamingBoard === b.path"
            :ref="focusRename"
            class="rename"
            data-ui
            :default-value="b.title"
            aria-label="Board name"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @keydown.esc.stop="commitRename(b, $event, true)"
            @blur="commitRename(b, $event)"
            @pointerdown.stop
          />
          <span v-else class="t" :class="{ renamable: canvasLevel }" @dblclick.stop="startRename(b)">{{ b.title }}</span>
          <span class="acts" data-ui>
            <Button v-if="b.w * k > 150" variant="ghost" size="icon-xs" title="Tweaks" aria-label="Tweaks" @click.stop="emit('openTweaks', b.path)" @pointerdown="hdrDown"><SlidersHorizontal /></Button>
            <Button v-if="b.w * k > 190" variant="ghost" size="icon-xs" title="Download this board" aria-label="Download this board" @click.stop="emit('exportBoard', b.path)" @pointerdown="hdrDown"><Download /></Button>
            <Button class="expand" variant="ghost" size="icon-xs" title="Open full window (F)" aria-label="Open full window" @click.stop="enterFocus(b.path)" @pointerdown="hdrDown"><Maximize2 /></Button>
            <Button v-if="b.w * k > 130" class="play" variant="secondary" size="xs" title="Play this board" @click.stop="emit('play', b.path)" @pointerdown="hdrDown"><Play class="size-2.5 fill-current" />PLAY</Button>
          </span>
        </div>
        <iframe
          :ref="(el) => { if (el) frames.set(b.path, el as HTMLIFrameElement); else frames.delete(b.path) }"
          :src="b.src"
          :title="b.title || 'Artifact'"
          sandbox="allow-scripts allow-popups allow-forms allow-downloads"
          referrerpolicy="no-referrer"
          :style="{ pointerEvents: !isCanvas || commentMode || elementLevel(b.path) || interacting === b.path || focusBoard === b.path ? 'auto' : 'none' }"
        />
        <div
          v-if="isCanvas && !commentMode && interacting !== b.path && focusBoard !== b.path"
          class="board-shield"
          :class="{ movable: canvasLevel && tool === 'select' }"
          :title="canvasLevel ? 'Drag to move, double-click to edit its content' : (b.interactive ? 'Double-click to interact' : '')"
          @pointerdown="onBoardDown($event, b)"
          @click="selectBoard(b.path)"
          @dblclick="canvasLevel ? enterFocus(b.path) : (b.interactive ? (interacting = b.path) : enterFocus(b.path))"
        />
      </div>

      <!-- notes and shapes sit above the boards -->
      <template v-for="n in notes" :key="n.id">
        <!-- sticky and text notes -->
        <div
          v-if="n.kind === 'sticky' || n.kind === 'text' || n.kind === 'title1'"
          data-note
          :data-id="n.id"
          class="note"
          :class="[n.kind, { sel: selection.has(noteKey(n.id)), editable: canvasLevel, editing: editingNote === n.id }]"
          :style="{
            left: n.x + 'px', top: n.y + 'px', width: (n.w || 240) + 'px', visibility: focusBoard ? 'hidden' : 'visible',
            ...(n.kind === 'sticky' ? { background: fillOf(n.fill).bg, borderColor: fillOf(n.fill).bd } : {}),
            ...(n.kind === 'text' ? { fontSize: (TEXT_PX[n.size] ?? 18) + 'px', fontWeight: n.bold ? 700 : 400, color: n.color } : {}),
            ...(n.kind === 'sticky' && n.h ? { minHeight: n.h + 'px' } : {}),
          }"
          @pointerdown="onNoteDown($event, n)"
          @dblclick.stop="startNoteEdit(n)"
        >
          <div
            :ref="(el) => noteRef(el, n.id)"
            class="ntext"
            :contenteditable="editingNote === n.id"
            :data-placeholder="n.kind === 'sticky' ? 'Write a note…' : 'Text'"
            @blur="commitNoteEdit(n, $event)"
            @keydown.stop="(ev: KeyboardEvent) => { if (ev.key === 'Escape') commitNoteEdit(n, ev, true); else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); (ev.target as HTMLElement).blur() } }"
          >{{ n.text }}</div>
        </div>
        <!-- shapes: svg, so a hollow rectangle only catches clicks on its outline -->
        <svg
          v-else-if="n.kind === 'rect' || n.kind === 'oval'"
          data-note
          :data-id="n.id"
          class="note vec shape"
          :class="{ sel: selection.has(noteKey(n.id)), editable: canvasLevel }"
          :style="{ left: n.x + 'px', top: n.y + 'px', width: n.w + 'px', height: n.h + 'px', visibility: focusBoard ? 'hidden' : 'visible' }"
          :viewBox="`0 0 ${n.w} ${n.h}`"
          overflow="visible"
          @pointerdown="onNoteDown($event, n)"
        >
          <rect v-if="n.kind === 'rect'" x="1" y="1" :width="Math.max(n.w - 2, 1)" :height="Math.max(n.h - 2, 1)" rx="3" :fill="fillOf(n.fill).bg" :stroke="n.color" stroke-width="2" />
          <ellipse v-else :cx="n.w / 2" :cy="n.h / 2" :rx="Math.max(n.w / 2 - 1, 1)" :ry="Math.max(n.h / 2 - 1, 1)" :fill="fillOf(n.fill).bg" :stroke="n.color" stroke-width="2" />
        </svg>
        <svg
          v-else-if="n.kind === 'line' || n.kind === 'arrow'"
          data-note
          :data-id="n.id"
          class="note vec"
          :class="{ sel: selection.has(noteKey(n.id)), editable: canvasLevel }"
          :style="{ left: noteBox(n).x + 'px', top: noteBox(n).y + 'px', width: Math.max(noteBox(n).w, 1) + 'px', height: Math.max(noteBox(n).h, 1) + 'px', visibility: focusBoard ? 'hidden' : 'visible' }"
          :viewBox="`0 0 ${arrowPath(n).bw} ${arrowPath(n).bh}`"
          overflow="visible"
          @pointerdown="onNoteDown($event, n)"
        >
          <line :x1="arrowPath(n).x1" :y1="arrowPath(n).y1" :x2="arrowPath(n).x2" :y2="arrowPath(n).y2" :stroke="n.color" stroke-width="2.5" stroke-linecap="round" />
          <polygon
            v-if="n.kind === 'arrow'"
            :points="`0,0 -14,-6 -14,6`"
            :fill="n.color"
            :transform="`translate(${arrowPath(n).x2} ${arrowPath(n).y2}) rotate(${arrowPath(n).ang * 180 / Math.PI})`"
          />
          <line :x1="arrowPath(n).x1" :y1="arrowPath(n).y1" :x2="arrowPath(n).x2" :y2="arrowPath(n).y2" stroke="transparent" stroke-width="16" />
        </svg>
        <svg
          v-else-if="n.kind === 'pen'"
          data-note
          :data-id="n.id"
          class="note vec"
          :class="{ sel: selection.has(noteKey(n.id)), editable: canvasLevel }"
          :style="{ left: noteBox(n).x + 'px', top: noteBox(n).y + 'px', width: noteBox(n).w + 'px', height: noteBox(n).h + 'px', visibility: focusBoard ? 'hidden' : 'visible' }"
          :viewBox="`0 0 ${noteBox(n).w} ${noteBox(n).h}`"
          overflow="visible"
          @pointerdown="onNoteDown($event, n)"
        >
          <path :d="penPath(n)" fill="none" :stroke="n.color" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          <path :d="penPath(n)" fill="none" stroke="transparent" stroke-width="14" />
        </svg>
      </template>

      <!-- selection frame and resize handles (canvas level) -->
      <template v-if="selBox && !editingNote">
        <div class="selbox" :style="{ left: selBox.x + 'px', top: selBox.y + 'px', width: selBox.w + 'px', height: selBox.h + 'px', borderWidth: 2 / k + 'px' }" />
        <template v-if="endpointNote">
          <span data-handle class="hd" :style="endpoint(endpointNote, 'start')" @pointerdown.stop="onEndpointDown($event, endpointNote, 'start')" />
          <span data-handle class="hd" :style="endpoint(endpointNote, 'end')" @pointerdown.stop="onEndpointDown($event, endpointNote, 'end')" />
        </template>
        <template v-else-if="showHandles">
          <span v-for="h in HANDLES" :key="h" data-handle class="hd" :style="hStyle(selBox, h)" @pointerdown.stop="onHandleDown($event, h)" />
        </template>
      </template>

      <!-- shape being drawn -->
      <template v-if="creating && inCanvasPage">
        <div v-if="creating.tool === 'artboard'" class="draw artboard" :style="{ left: creating.x + 'px', top: creating.y + 'px', width: creating.w + 'px', height: creating.h + 'px' }" />
        <div v-else-if="creating.tool === 'rect' || creating.tool === 'oval'" class="draw" :class="{ oval: creating.tool === 'oval' }" :style="{ left: creating.x + 'px', top: creating.y + 'px', width: creating.w + 'px', height: creating.h + 'px' }" />
        <svg v-else-if="creating.tool === 'arrow' || creating.tool === 'line'" class="draw-svg" overflow="visible" width="1" height="1" :style="{ left: creating.x + 'px', top: creating.y + 'px' }"><line x1="0" y1="0" :x2="creating.w" :y2="creating.h" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" /></svg>
        <svg v-else-if="creating.tool === 'pen'" class="draw-svg" overflow="visible" width="1" height="1" style="left: 0; top: 0"><path :d="creatingPen" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </template>

      <Button
        v-for="c in visiblePins"
        variant="ghost"
        :key="c.id"
        class="pin"
        :class="{ selected: selectedId === c.id, resolved: c.resolved }"
        :style="{ left: pins[c.id]!.x + 'px', top: pins[c.id]!.y + 'px', transform: `translate(-50%, -100%) scale(${1 / k})` }"
        :aria-label="`Open comment ${numberOf(c)} by ${c.author_email}`"
        @click.stop="emit('select', c.id)"
      >
        <span>{{ numberOf(c) }}</span>
      </Button>
      <span v-if="draftPos" class="pin draft" :style="{ left: draftPos.x + 'px', top: draftPos.y + 'px', transform: `translate(-50%, -100%) scale(${1 / k})` }"><span>+</span></span>
    </div>

    <ButtonGroup v-if="isCanvas && !focusBoard" class="zoom rounded-lg border bg-card shadow-md" data-ui>
      <Button variant="ghost" size="icon-sm" aria-label="Present" title="Present the whole canvas" @click="emit('present')"><Play class="size-3 fill-current" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Zoom out" @click="zoomAt(1 / 1.2)"><Minus /></Button>
      <Button class="pct tabular-nums" variant="ghost" size="sm" title="Fit all (0)" @click="fit(true)">{{ Math.round(k * 100) }}%</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Zoom in" @click="zoomAt(1.2)"><Plus /></Button>
    </ButtonGroup>

    <div v-if="focusBoard" class="focusbar" data-ui>
      <Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="Previous board" :disabled="boards.length < 2" @click="step(-1)"><ArrowLeft /></Button>
      <span class="count">{{ focusIndex + 1 }} / {{ boards.length }} · {{ boards[focusIndex]?.title }}</span>
      <Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="Next board" :disabled="boards.length < 2" @click="step(1)"><ArrowRight /></Button>
      <Button class="close rounded-full" variant="ghost" size="icon-sm" aria-label="Back to canvas (Esc)" title="Back to canvas (Esc)" @click="exitFocus"><X /></Button>
    </div>
  </div>
  </ContextMenuTrigger>
  <ContextMenuContent class="w-56">
    <template v-if="ctx.type === 'board' && ctxBoard">
      <ContextMenuItem @select="emit('play', ctxBoard.path)"><Play />Play</ContextMenuItem>
      <ContextMenuItem @select="enterFocus(ctxBoard.path)"><Maximize2 />Open full window<ContextMenuShortcut>F</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @select="emit('openTweaks', ctxBoard.path)"><SlidersHorizontal />Tweaks</ContextMenuItem>
      <ContextMenuItem @select="emit('exportBoard', ctxBoard.path)"><Download />Download board</ContextMenuItem>
      <template v-if="canvasLevel">
        <ContextMenuItem @select="startRename(ctxBoard)"><Pencil />Rename</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" @select="ctxDeleteBoard"><Trash2 />Delete board<ContextMenuShortcut>⌫</ContextMenuShortcut></ContextMenuItem>
      </template>
    </template>
    <template v-else-if="ctx.type === 'note'">
      <ContextMenuItem :disabled="!canvasLevel" variant="destructive" @select="send({ type: 'deleteNote', id: ctx.id })"><Trash2 />Delete</ContextMenuItem>
    </template>
    <template v-else>
      <template v-if="canvasLevel">
        <ContextMenuItem @select="ctxAddBoard"><Plus />Add board here</ContextMenuItem>
        <ContextMenuItem @select="ctxAddSticky"><StickyNote />Add sticky note</ContextMenuItem>
        <ContextMenuSeparator />
      </template>
      <ContextMenuItem @select="fit(true)"><ScanSearch />Fit all<ContextMenuShortcut>0</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuItem @select="zoomAt(1.2)"><Plus />Zoom in</ContextMenuItem>
      <ContextMenuItem @select="zoomAt(1 / 1.2)"><Minus />Zoom out</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @select="emit('present')"><Presentation />Present canvas</ContextMenuItem>
    </template>
  </ContextMenuContent>
  </ContextMenu>
</template>

<style scoped>
.canvas { user-select: none; -webkit-user-select: none; position: relative; overflow: hidden; background: var(--canvas-bg); background-image: radial-gradient(var(--canvas-dot) 1px, transparent 1px); background-size: 24px 24px; touch-action: none; cursor: grab; height: 100%; }
.canvas.panning { cursor: grabbing; }
.canvas.page, .canvas.focus { cursor: auto; }
.canvas.tool { cursor: crosshair; }
.canvas.page { background: var(--bg); background-image: none; }
.canvas.focus { background: #0e0d0c; background-image: none; }
.world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.world.anim { transition: transform .28s cubic-bezier(.2, .7, .2, 1); }
.canvas.page .world { width: 100%; height: 100%; }
.board { position: absolute; background: #fff; box-shadow: 0 0 0 1px var(--line), 0 8px 28px rgb(0 0 0 / .10); border-radius: 2px; }
.board.selected { box-shadow: 0 0 0 2px var(--accent-soft, #e9a898), 0 8px 28px rgb(0 0 0 / .12); }
.board.interacting { box-shadow: 0 0 0 2px var(--brand), 0 8px 28px rgb(0 0 0 / .14); }
.board.full { box-shadow: none; border-radius: 0; }
.canvas.page .board { box-shadow: none; border-radius: 0; }
.board iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
.board-shield { position: absolute; inset: 0; cursor: inherit; }
.board-shield.movable { cursor: move; }
.canvas.tool .board-shield { cursor: crosshair; }
.board-title { position: absolute; left: 0; bottom: 100%; padding-bottom: 6px; transform-origin: 0 100%; font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.board-title .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
.board-title .rename { flex: 1; min-width: 0; font: inherit; padding: 1px 4px; border: 1px solid var(--brand); border-radius: 3px; background: var(--panel); color: var(--fg); }
.board-title .acts { display: flex; gap: 2px; align-items: center; }
.note { position: absolute; font-size: 14px; line-height: 1.5; color: var(--muted); white-space: pre-wrap; pointer-events: none; }
.note.editable { pointer-events: auto; cursor: move; }
.note.title1 { font-size: 40px; font-weight: 650; color: var(--fg); line-height: 1.15; }
.note.sticky { border: 1px solid; border-radius: 3px; padding: 10px 12px; color: #3b2f14; box-shadow: 0 2px 6px rgb(0 0 0 / .08); font-size: 13px; min-height: 60px; }
.note.text { color: var(--fg); }
.note .ntext { outline: none; min-height: 1.2em; cursor: inherit; }
.note .ntext[contenteditable="true"] { user-select: text; -webkit-user-select: text; }
.board-title .rename { user-select: text; -webkit-user-select: text; }
.note.editing .ntext { cursor: text; }
.note .ntext:empty::before { content: attr(data-placeholder); opacity: .45; }
.note.vec { overflow: visible; }
.note.vec.editable { pointer-events: none; }
.note.vec.editable :deep(line), .note.vec.editable :deep(path), .note.vec.editable :deep(polygon) { pointer-events: stroke; cursor: move; }
.note.vec.editable :deep(rect), .note.vec.editable :deep(ellipse) { pointer-events: visiblePainted; cursor: move; }
.selbox { position: absolute; border: solid #3b82f6; pointer-events: none; box-sizing: border-box; }
.hd { position: absolute; width: 10px; height: 10px; background: #fff; border: 1.5px solid #3b82f6; border-radius: 2px; box-sizing: border-box; z-index: 5; }
.draw { position: absolute; border: 2px dashed #3b82f6; background: rgba(59, 130, 246, .08); pointer-events: none; box-sizing: border-box; }
.draw.oval { border-radius: 50%; }
.draw.artboard { background: rgba(255, 255, 255, .6); }
.draw-svg { position: absolute; pointer-events: none; }
.pin { position: absolute; transform-origin: 50% 100%; width: 28px; height: 28px; border-radius: 50% 50% 50% 0; background: var(--brand); color: #fff; border: 2px solid #fff; box-shadow: 0 2px 8px rgb(0 0 0 / .3); font: 600 12px/1 var(--font); display: grid; place-items: center; cursor: pointer; padding: 0; rotate: -45deg; }
.pin > span { rotate: 45deg; }
.pin.selected { background: var(--fg); outline: 3px solid var(--brand); }
.pin.resolved { background: #8a8f98; opacity: .7; }
.pin.draft { background: var(--brand); opacity: .85; pointer-events: none; }
.zoom { position: absolute; right: 12px; bottom: 12px; width: fit-content; }
.focusbar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; background: rgb(28 27 25 / .88); color: #fff; border-radius: 999px; padding: 4px; backdrop-filter: blur(8px); box-shadow: 0 6px 24px rgb(0 0 0 / .35); max-width: calc(100% - 24px); opacity: .92; transition: opacity .2s; }
.focusbar:hover { opacity: 1; }
.focusbar .count { padding: 0 10px; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
</style>
