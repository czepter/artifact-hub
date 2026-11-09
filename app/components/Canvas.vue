<script setup lang="ts">
import type { Comment, ViewData, Anchor } from '~/types'
import { orderedNoteIds, type Canvas as CanvasT, type CanvasOp } from '#shared/canvasOps'
import { type AlignMode, type BindTargetBox, type Box, type GeomItem, HANDLES, contentOutside, fitPenPoints, smoothPath, unionBox, alignPatches, bindTargetAt, distributePatches, boxesIntersect, constrainCreate, isDirected, itemBox, noteBox, noteGeometry, noteHit, normBox, resolveArrow, round1 } from '#shared/canvasGeometry'
import { deleteOps, detachBinds, groupKeys, nudgeOps, patchOps } from '#shared/canvasItemOps'
import type { NoteView } from '~/utils/canvasView'
import type { SelRef } from '~/composables/useCanvasSelection'

import { ArrowLeft, ArrowRight, Command, Crosshair, Lock, Maximize2, Minus, Play, Plus, X } from '@lucide/vue'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Button } from '@/components/ui/button'
import { boardKey, noteKey, refOfKey, useCanvasSelection } from '~/composables/useCanvasSelection'
import { ButtonGroup } from '@/components/ui/button-group'

import { TOOL_KEYS, TOOL_ORDER, type Tool } from '~/utils/canvasTools'

const props = defineProps<{
  data: ViewData
  /** Effective canvas: the saved one with not-yet-saved edits applied. */
  canvas?: CanvasT | null
  commentMode: boolean
  editMode: boolean
  tool: Tool
  /** Keep the drawing tool after each shape instead of going back to Select. */
  toolLock?: boolean
  /** Slideshow mode: the laser pointer is offered. */
  presenting?: boolean
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
  escape: []
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
  /** One user gesture: all of its operations, saved together as one undo step (`files`: pictures to store with it). */
  canvasOps: [ops: CanvasOp[], merge?: string, files?: { path: string, content: string }[]]
  palette: []
  canvasSelect: [sel: SelRef[]]
  tool: [tool: Tool]
  toolLock: [locked: boolean]
  play: [path: string]
  present: []
  openTweaks: [path: string]
  exportBoard: [path: string]
  transferBoard: [path: string, mode: 'copy' | 'move']
}>()

interface BoardView { group?: string, path: string, x: number, y: number, w: number, h: number, title: string, interactive: boolean, expand: string, src: string, locked: boolean, autosize?: boolean }
type Ov = { x: number, y: number, w: number, h: number, points: number[][] }

const viewport = ref<HTMLElement>()
const size = reactive({ w: 0, h: 0 })
const view_ = useCanvasView(viewport, size)
const { tx, ty, k, animate, pulse, zoomAt, centerOn, toWorld } = view_
const interacting = ref<string | null>(null) // double-clicked board whose page receives input while on the canvas
const focusBoard = ref<string | null>(null) // one board expanded to fill the window
const focusMode = ref<'fit' | 'play'>('fit') // fit: the whole board letterboxed into the window; play: the board at the window's full width, scrolling when taller
const frames = new Map<string, HTMLIFrameElement>()
const pins = reactive<Record<string, { x: number, y: number }>>({})
const panning = ref(false)
// While editing, frame URLs are frozen so a save (new version) never reloads the board under the editor.
const frozenSrc = ref<Record<string, string> | null>(null)
// Live (not yet committed) geometry while dragging or resizing.
const boardOv = reactive<Record<string, Partial<Ov>>>({})
const noteOv = reactive<Record<string, Partial<Ov>>>({})
const marquee = ref<Box | null>(null)
/** Notes the eraser has passed over; they are deleted together when the pointer is released. */
const erased = ref<string[]>([])
const spaceHeld = ref(false)
let lastClient: { x: number, y: number } | null = null // pointer over the canvas, for paste; cleared when it leaves
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

const boardBase = computed<BoardView[]>(() => {
  const c = cv.value
  const live = (p: string) => `${props.data.frameBase}${p.split('/').map(encodeURIComponent).join('/')}?r=${revOf.value[p] ?? 0}&s=${props.data.sharedRev ?? 0}`
  const src = (p: string) => frozenSrc.value?.[p] ?? live(p)
  if (c?.boards) {
    const order: string[] = Array.isArray(c.order) ? c.order : Object.keys(c.boards)
    const rest = Object.keys(c.boards).filter(p => !order.includes(p))
    return [...order, ...rest].filter(p => c.boards[p] && revOf.value[p] !== undefined).map((p) => {
      const b = c.boards[p]
      return { path: p, x: +b.x || 0, y: +b.y || 0, w: +b.w || 800, h: +b.h || 600, title: b.title || p, interactive: !!b.is_interactive, expand: b.expand || '', src: src(p), locked: !!b.locked, group: b.group, autosize: !!b.autosize }
    })
  }
  return [{ path: 'index.html', x: 0, y: 0, w: size.w, h: size.h, title: '', interactive: true, expand: 'fill', src: src('index.html'), locked: false }]
})

/** Live drag overrides applied on top; only boards with an override get a new object, so the others keep their identity. */
const boards = computed<BoardView[]>(() => boardBase.value.map((b) => {
  const o = boardOv[b.path]
  return o ? { ...b, x: o.x ?? b.x, y: o.y ?? b.y, w: o.w ?? b.w, h: o.h ?? b.h } : b
}))

/** A page-type board (expand: fill) takes the whole window when focused, so its layout reflows like a real page. */
function dims(b: BoardView) {
  if (focusBoard.value !== b.path) return { w: b.w, h: b.h }
  if (b.expand === 'fill') return { w: size.w, h: size.h }
  if (focusMode.value === 'play') return { w: b.w, h: Math.min(b.h, size.h / (size.w / b.w)) } // taller than the window: the page scrolls inside
  return { w: b.w, h: b.h }
}

const { heights: noteH, measure: measureNotes } = useNoteHeights(viewport)

const noteBase = computed<NoteView[]>(() => {
  const n = cv.value?.notes ?? {}
  // Back to front: `noteOrder` when the canvas has one, else the order the notes are stored in.
  return orderedNoteIds({ notes: n, noteOrder: cv.value?.noteOrder }).map((id) => {
    const v = n[id], g = noteGeometry(v), kind = g.kind
    return { id, kind, x: g.x, y: g.y, w: g.w, h: g.h, text: String(v.text ?? ''), fill: v.fill ?? (kind === 'sticky' ? 'yellow' : 'none'), color: v.color ?? '', size: v.size ?? 'm', bold: !!v.bold, points: g.points, locked: !!v.locked, group: v.group, src: v.src, fillStyle: v.fillStyle, stroke: v.stroke, strokeWidth: v.strokeWidth, strokeStyle: v.strokeStyle, roundness: v.roundness, arrowStart: v.arrowStart, arrowEnd: v.arrowEnd, bind: v.bind }
  })
})
const rawNotes = computed<NoteView[]>(() => noteBase.value.map((b) => {
  const o = noteOv[b.id]
  return o ? { ...b, x: o.x ?? b.x, y: o.y ?? b.y, w: o.w ?? b.w, h: o.h ?? b.h, points: o.points ?? b.points } : b
}))
/** What an arrow can attach to: boards, rectangles, ovals, sticky notes and text, back to front. */
const bindTargets = computed<BindTargetBox[]>(() => [
  ...boards.value.map(b => ({ type: 'board' as const, id: b.path, box: { x: b.x, y: b.y, w: b.w, h: b.h }, shape: 'rect' as const })),
  ...rawNotes.value.filter(r => ['rect', 'oval', 'sticky', 'text'].includes(r.kind)).map(r => ({ type: 'note' as const, id: r.id, box: { x: r.x, y: r.y, w: r.w, h: noteH[r.id] ?? (r.h || noteBox(r).h) }, shape: (r.kind === 'oval' ? 'oval' : 'rect') as 'oval' | 'rect' })),
])
/** Bound arrows are drawn from where their targets are now (unless being dragged), so moving a target needs no operation. */
const arrowCache = new Map<string, { r: NoteView, a: { x: number, y: number, w: number, h: number }, out: NoteView }>() // keeps an unmoved arrow's identity
const notes = computed<NoteView[]>(() => {
  const by = new Map(bindTargets.value.map(t => [t.type + ':' + t.id, t]))
  return rawNotes.value.map((r) => {
    if (!(r.bind && isDirected(r.kind) && !noteOv[r.id])) return r
    const a = resolveArrow(r, r.bind, t => by.get(t.type + ':' + t.id) ?? null), p = arrowCache.get(r.id)
    if (p && p.r === r && p.a.x === a.x && p.a.y === a.y && p.a.w === a.w && p.a.h === a.h) return p.out
    const out = { ...r, ...a }
    arrowCache.set(r.id, { r, a, out })
    return out
  })
})

/** Everything selectable, with its geometry as shown right now (live drag overrides included). */
const itemCache = new WeakMap<object, GeomItem>() // a view object keeps its GeomItem while its height is unchanged
const stable = (v: object, h: number, make: () => GeomItem) => {
  let i = itemCache.get(v)
  if (!i || i.h !== h) itemCache.set(v, i = make())
  return i
}
const allItems = computed<GeomItem[]>(() => [
  ...boards.value.map(b => stable(b, b.h, () => ({ key: boardKey(b.path), kind: 'board', x: b.x, y: b.y, w: b.w, h: b.h, locked: b.locked, group: b.group }))),
  ...notes.value.map((n) => {
    const h = isDirected(n.kind) ? n.h : (noteH[n.id] ?? (n.h || noteBox(n).h))
    return stable(n, h, () => ({ key: noteKey(n.id), kind: n.kind, x: n.x, y: n.y, w: n.w, h, points: n.points, locked: n.locked, group: n.group }))
  }),
])
const selection = useCanvasSelection(allItems)
const gestures = useCanvasGestures(selection, boardOv, noteOv, k, () => allItems.value.filter(i => drawnSet.value.has(i.key) && !selection.has(i.key)).map(itemBox), { targets: () => bindTargets.value, bindOf: id => cv.value?.notes?.[id]?.bind })
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
  const nk = b.expand === 'fill' ? 1 : focusMode.value === 'play' ? size.w / d.w : Math.min(size.w / d.w, size.h / d.h, 3)
  k.value = nk
  tx.value = (size.w - d.w * nk) / 2 - b.x * nk
  ty.value = (size.h - d.h * nk) / 2 - b.y * nk
}

function enterFocus(path: string, mode?: 'fit' | 'play') {
  if (!isCanvas.value || !boards.value.some(b => b.path === path)) return
  focusMode.value = mode ?? (focusBoard.value ? focusMode.value : 'fit')
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
  laser.value = false
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

// ---- which boards run a live page --------------------------------------------------------------
/** Each live board is a whole page (often in its own process), so only boards on or near the screen get one. Focus keeps its neighbours for instant stepping. A string, so panning that changes nothing triggers nothing. */
/** Zoomed out, boards are pictures. Two thresholds, so a zoom resting near one does not keep reloading pages. */
const closeEnough = ref(false)
watch(k, v => (closeEnough.value = v >= (closeEnough.value ? 0.24 : 0.3)), { immediate: true })
/** Boards this server could not draw (no headless browser): they stay live pages. */
const noThumb = reactive<Record<string, true>>({})
/** A miss may be transient (busy, an older version mid-publish): retry when the data changes. */
watch(() => props.data.thumbBase, () => { for (const p of Object.keys(noThumb)) delete noThumb[p] })
/** Live boards whose page has loaded; until then the picture stays in view. */
const frameLoaded = reactive<Record<string, true>>({})
/** The screen plus half a screen around it, in world space. */
const nearBox = computed(() => {
  if (!size.w) return null
  const w = size.w / k.value, h = size.h / k.value
  return { x: -tx.value / k.value - w / 2, y: -ty.value / k.value - h / 2, w: w * 2, h: h * 2 }
})
const liveKey = computed(() => {
  const list = boards.value
  if (!isCanvas.value) return list.map(b => b.path).join('\n')
  if (focusBoard.value) return list.filter((_, i) => Math.abs(i - focusIndex.value) <= 1).map(b => b.path).join('\n')
  const near = nearBox.value
  if (!near) return ''
  return list.filter(b => b.path === interacting.value || (boxesIntersect(b, near) && (closeEnough.value || props.commentMode || noThumb[b.path]))).map(b => b.path).join('\n')
})
const live = computed(() => new Set(liveKey.value.split('\n').filter(Boolean)))
/** Only what is near the screen is in the DOM (data stays complete). A string, so panning that changes nothing triggers nothing. */
const drawnKey = computed(() => {
  const near = nearBox.value
  if (!isCanvas.value) return boards.value.map(b => boardKey(b.path)).join('\n')
  if (!near) return ''
  if (focusBoard.value) return boards.value.filter((_, i) => Math.abs(i - focusIndex.value) <= 1).map(b => boardKey(b.path)).join('\n')
  const out: string[] = []
  for (const i of allItems.value) {
    const id = i.key.slice(2)
    if (selection.has(i.key) || boxesIntersect(itemBox(i), near) || (i.kind === 'board' ? interacting.value === id || renamingBoard.value === id : !!noteOv[id] || editingNote.value === id || erased.value.includes(id))) out.push(i.key)
  }
  return out.join('\n')
})
const drawnSet = computed(() => new Set(drawnKey.value.split('\n')))
const drawnBoards = computed(() => boards.value.filter(b => drawnSet.value.has(boardKey(b.path))))
const drawnNotes = computed(() => notes.value.filter(n => drawnSet.value.has(noteKey(n.id))))
watch(live, (s) => { for (const p of Object.keys(frameLoaded)) if (!s.has(p)) delete frameLoaded[p] })
// A board that is not loaded cannot report where its comments sit: until it can, they sit where they were placed.
watchEffect(() => {
  for (const c of props.data.comments) {
    const b = !c.parent_id && c.anchor?.click && c.board && !live.value.has(c.board) ? boards.value.find(x => x.path === c.board) : null
    if (b && !pins[c.id]) pins[c.id] = { x: b.x + c.anchor!.click.x, y: b.y + c.anchor!.click.y }
  }
})

function navKeys(enabled: boolean) {
  for (const b of boards.value) postTo(b.path, { type: 'hub:nav-keys', enabled })
}

// ---- selection ---------------------------------------------------------------------------------
watch(() => drawnNotes.value.map(n => n.id).join(), () => nextTick(measureNotes), { flush: 'post' }) // only when the set of drawn notes changes, not on every drag frame
watch(() => (canvasLevel.value ? selection.refs.value : []), v => emit('canvasSelect', v), { deep: true })
// Clicking something that is in a group selects the whole group.
const selectKey = (key: string | null) => selection.set(key ? groupKeys(allItems.value, key) : [])
function selectBoard(path: string | null) { selectKey(path ? boardKey(path) : null) }
function selectNote(id: string | null) { selectKey(id ? noteKey(id) : null) }

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
  | { kind: 'create', tool: Tool, sx: number, sy: number, moved: boolean }
  | { kind: 'pen', pts: number[][], moved: boolean }
  | { kind: 'marquee', sx: number, sy: number, additive: boolean, moved: boolean }
  /** Shift pressed on a board: a click toggles it in the selection, a drag becomes an additive marquee. */
  | { kind: 'erase', last: { x: number, y: number } }
  | { kind: 'shiftpress', key: string, x: number, y: number, additive: boolean, moved: boolean }
let drag: Drag | null = null
let justDragged = false
const uid = () => 'nt' + Math.random().toString(36).slice(2, 8)
const round = round1
/** One user gesture = one batch: everything it changes goes out together, so it is one undo step. */
const send = (...ops: CanvasOp[]) => { if (ops.length) emit('canvasOps', ops) }
/** Arrow-key nudges: repeats of the key fold into the same save and undo step. */
const sendNudge = (...ops: CanvasOp[]) => { if (ops.length) emit('canvasOps', ops, 'nudge') }
/** Moves and resizes: arrows moved without their targets come loose from them. */
const drawnSize = (id: string) => notes.value.find(n => n.id === id)
const sendMove = (ops: CanvasOp[]) => send(...detachBinds(ops, cv.value?.notes, new Set(selection.keys.value), drawnSize))

function capture(e: PointerEvent) { try { viewport.value!.setPointerCapture(e.pointerId) } catch {} }

const creationTool = computed(() => canvasLevel.value && props.tool !== 'select' && props.tool !== 'hand' && props.tool !== 'eraser')

function onPointerDown(e: PointerEvent) {
  if (!isCanvas.value || focusBoard.value || (e.button !== 0 && e.button !== 1)) return
  const t = e.target as HTMLElement
  // The toolbar, zoom pill and rename field always take their own presses; board header icons only yield to a drawing tool.
  if (t.closest('.zoom, .focusbar, [data-toolbar], .rename') || (!creationTool.value && t.closest('[data-ui]'))) return
  if (!t.closest('[contenteditable="true"], input, textarea')) e.preventDefault()
  if (canvasLevel.value && e.button === 0 && props.tool !== 'select' && props.tool !== 'hand' && props.tool !== 'eraser' && !spaceHeld.value) {
    // Creation tools: a drag draws the shape, a click drops a default-sized one.
    const w = toWorld(e.clientX, e.clientY)
    drag = props.tool === 'pen' ? { kind: 'pen', pts: [[w.x, w.y]], moved: false } : { kind: 'create', tool: props.tool, sx: w.x, sy: w.y, moved: false }
    creating.value = props.tool === 'pen' ? { tool: 'pen', x: w.x, y: w.y, w: 0, h: 0, pts: [[w.x, w.y]] } : { tool: props.tool, x: w.x, y: w.y, w: 0, h: 0 }
    capture(e)
    return
  }
  // Space held: the press pans, even over boards and notes.
  if (canvasLevel.value && e.button === 0 && props.tool === 'eraser' && !spaceHeld.value) {
    const w = toWorld(e.clientX, e.clientY)
    drag = { kind: 'erase', last: w }; erased.value = []; eraseAt(w, w)
    capture(e)
    return
  }
  // On empty canvas (Select tool) a drag draws a selection rectangle; the Hand tool, Space and the middle button pan.
  if (canvasLevel.value && e.button === 0 && props.tool === 'select' && !spaceHeld.value) {
    const w = toWorld(e.clientX, e.clientY)
    drag = { kind: 'marquee', sx: w.x, sy: w.y, additive: e.shiftKey, moved: false }
    return // the pointer is captured once it moves, so a double-click on a title still reaches it
  }
  drag = { kind: 'pan', x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value, moved: false }
}

function onShieldClick(e: MouseEvent, b: BoardView) { if (!justDragged && !e.shiftKey) selectBoard(b.path) }

/** Marks the notes under the line from `a` to `b` (checked every few px so a fast stroke skips nothing). Boards are never erased. */
function eraseAt(a: { x: number, y: number }, b: { x: number, y: number }) {
  const tol = 5 / k.value, steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * k.value / 5)), hit = new Set(erased.value)
  for (let i = 0; i <= steps; i++) {
    const p = { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }
    for (const n of notes.value) if (!n.locked && noteHit(noteH[n.id] ? { ...n, h: noteH[n.id]! } : n, p, tol)) hit.add(n.id)
  }
  if (hit.size !== erased.value.length) erased.value = [...hit]
}

function onBoardDown(e: PointerEvent, b: BoardView) {
  if (!canvasLevel.value || props.tool !== 'select' || e.button !== 0 || spaceHeld.value) return
  if (e.shiftKey) { // click toggles, drag draws an additive marquee (the press never reaches the iframe: the shield owns it)
    e.stopPropagation(); e.preventDefault()
    drag = { kind: 'shiftpress', key: boardKey(b.path), x: e.clientX, y: e.clientY, additive: true, moved: false }
    return
  }
  gestures.startMove(e, boardKey(b.path))
}
function onNoteDown(e: PointerEvent, n: NoteView) {
  if (!canvasLevel.value || props.tool !== 'select' || e.button !== 0 || editingNote.value === n.id || spaceHeld.value) return
  if (e.shiftKey) { e.stopPropagation(); e.preventDefault(); selection.toggleGroup(noteKey(n.id)); return }
  gestures.startMove(e, noteKey(n.id))
}

function onPointerMove(e: PointerEvent) {
  lastClient = { x: e.clientX, y: e.clientY }
  if (gestures.active()) { if (gestures.onMove(e) === 'start') capture(e); return }
  if (!drag) return
  const d = drag
  if (d.kind === 'create') {
    const w = toWorld(e.clientX, e.clientY)
    if (!d.moved && Math.hypot(w.x - d.sx, w.y - d.sy) * k.value < 4) return
    d.moved = true
    // Shift: square / circle, or a line at a multiple of 15 degrees. Alt: draw from the centre.
    const lined = d.tool === 'arrow' || d.tool === 'line'
    creating.value = { tool: d.tool, ...constrainCreate(lined ? 'line' : 'box', { x: d.sx, y: d.sy }, w, { shift: e.shiftKey, alt: e.altKey }) }
    return
  }
  if (d.kind === 'erase') { const w = toWorld(e.clientX, e.clientY); eraseAt(d.last, w); d.last = w; return }
  if (d.kind === 'marquee' || d.kind === 'shiftpress') {
    const w = toWorld(e.clientX, e.clientY)
    if (d.kind === 'shiftpress') {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return
      const s = toWorld(d.x, d.y)
      drag = { kind: 'marquee', sx: s.x, sy: s.y, additive: true, moved: true }
      capture(e)
      marquee.value = normBox(s, w)
      return
    }
    if (!d.moved && Math.hypot(w.x - d.sx, w.y - d.sy) * k.value < 4) return
    d.moved = true
    capture(e)
    marquee.value = normBox({ x: d.sx, y: d.sy }, w)
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
    panning.value = true
  }
  tx.value = d.tx + dx; ty.value = d.ty + dy
}

function finishCreate(d: Extract<Drag, { kind: 'create' }>, c: NonNullable<typeof creating.value>, alt = false) {
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
      const x = round(d.moved ? c.x : d.sx), y = round(d.moved ? c.y : d.sy)
      // An arrow drawn from or to a board or note attaches to it.
      const tol = 8 / k.value, a = d.moved ? bindTargetAt({ x, y }, bindTargets.value, tol) : null, z = d.moved ? bindTargetAt({ x: x + w, y: y + h }, bindTargets.value, tol) : null
      const ref = (t: BindTargetBox | null) => (t && tool === 'arrow' && !alt ? { type: t.type, id: t.id } : undefined)
      if (a && z && a.type === z.type && a.id === z.id) { /* both ends on one target: attach only the start */ }
      const bind = ref(a) || ref(z) ? { ...(ref(a) ? { start: ref(a) } : {}), ...(ref(z) && !(a && z && a.id === z.id && a.type === z.type) ? { end: ref(z) } : {}) } : undefined
      send({ type: 'addNote', id, note: { kind: tool, x, y, w: round(w), h: round(h), ...(bind ? { bind } : {}) } })
      nextTick(() => selectNote(id))
    } else {
      const w = d.moved && c.w > 8 && c.h > 8 ? c.w : 160, h = d.moved && c.w > 8 && c.h > 8 ? c.h : 100
      send({ type: 'addNote', id, note: { kind: tool as 'rect' | 'oval', x: round(d.moved ? c.x : d.sx), y: round(d.moved ? c.y : d.sy), w: round(w), h: round(h), fill: 'none' } })
      nextTick(() => selectNote(id))
    }
  }
  if (!props.toolLock) emit('tool', 'select')
}

/** The browser took the pointer away: an eraser stroke is dropped, not carried out. */
function onPointerCancel(e: PointerEvent) {
  if (drag?.kind === 'erase') { erased.value = []; drag = null; return }
  onPointerUp(e)
}

function onPointerUp(e: PointerEvent) {
  const done = gestures.end()
  const d = drag
  drag = null
  panning.value = false
  try { viewport.value!.releasePointerCapture(e.pointerId) } catch {}
  if (done.moved) { // move, resize and endpoint drags end the same way: every live override goes out as one batch
    justDragged = true; setTimeout(() => (justDragged = false), 0)
    if (done.clone) board_.cloneBy(done.clone) // Alt-drag: copies land where the drag ended
    else if (done.kind === 'endpoint') send(...done.ops)
    else sendMove(done.ops.map(o => o.type === 'updateBoard' && (o.patch.w !== undefined || o.patch.h !== undefined) ? { ...o, patch: { ...o.patch, autosize: null } } : o)) // a manual resize ends auto-sizing
    nextTick(done.clear)
    return
  }
  if (d?.kind === 'erase') {
    const ids = erased.value; erased.value = []
    justDragged = true; setTimeout(() => (justDragged = false), 0)
    send(...ids.map(id => ({ type: 'deleteNote', id }) as CanvasOp)) // one stroke, one undo step
    return
  }
  if (d?.kind === 'shiftpress') { selection.toggleGroup(d.key); justDragged = true; setTimeout(() => (justDragged = false), 0); return } // the click that follows must not reselect
  if (d?.kind === 'marquee') {
    const box = marquee.value
    marquee.value = null
    if (d.moved && box) {
      justDragged = true; setTimeout(() => (justDragged = false), 0)
      const hits = allItems.value.filter(i => !i.locked && boxesIntersect(itemBox(i), box)).map(i => i.key) // locked items are not marquee-selected
      const withGroups = [...new Set(hits.flatMap(k => groupKeys(allItems.value, k)))] // a group is selected whole
      selection.set(d.additive ? [...selection.keys.value, ...withGroups] : withGroups)
    }
    return
  }
  if (!d) return
  if (d.kind === 'create' && creating.value) { const c = creating.value; creating.value = null; justDragged = true; setTimeout(() => (justDragged = false), 0); finishCreate(d, c, e.altKey); return }
  if (d.kind === 'pen') {
    creating.value = null
    justDragged = true; setTimeout(() => (justDragged = false), 0)
    if (d.pts.length > 2) {
      const x0 = Math.min(...d.pts.map(p => p[0]!)), y0 = Math.min(...d.pts.map(p => p[1]!))
      // Simplify the stroke (Ramer-Douglas-Peucker, 1 screen px) and keep it within 400 points; it is drawn as a smooth curve.
      const pts = fitPenPoints(d.pts.map(p => [p[0]! - x0, p[1]! - y0]), 1 / k.value, 399)
      const id = uid()
      send({ type: 'addNote', id, note: { kind: 'pen', x: round(x0), y: round(y0), points: pts } })
      nextTick(() => selectNote(id))
    }
    return
  }
  if (d.moved) { justDragged = true; setTimeout(() => (justDragged = false), 0) }
}

function onViewportClick(e: MouseEvent) {
  if (justDragged || e.shiftKey) return // shift-click on empty canvas leaves the selection alone
  if ((e.target as HTMLElement).closest('[data-board], [data-ui], [data-note], .pin, [data-handle]')) return
  interacting.value = null
  selection.clear()
  renamingBoard.value = null
  emit('deselect')
}

// Notes: text editing, board rename
/** Double-click: text notes and shapes edit their text. Inside a group it first selects just that member. */
function startNoteEdit(n: NoteView) {
  if (!canvasLevel.value || n.locked) return
  if (n.group && selection.count.value > 1) { selection.only(noteKey(n.id)); return }
  if (['sticky', 'text', 'rect', 'oval'].includes(n.kind)) { selectNote(n.id); editingNote.value = n.id }
}
/** Text edit finished (`text` null: cancelled). Only an empty new sticky or text note is dropped; an empty shape stays. */
function commitNoteEdit(n: NoteView, text: string | null) {
  if (editingNote.value !== n.id) return
  editingNote.value = null
  const empty = text !== null && !text.trim() && !n.text.trim() && (n.kind === 'sticky' || n.kind === 'text')
  if (text !== null && text !== n.text) send({ type: 'updateNote', id: n.id, patch: { text } }, ...(empty ? [{ type: 'deleteNote', id: n.id } as CanvasOp] : []))
  else if (empty) send({ type: 'deleteNote', id: n.id })
}
function startRename(b: BoardView) { if (canvasLevel.value) { selectBoard(b.path); renamingBoard.value = b.path } }
function commitRename(b: BoardView, v: string | null) { // null: cancelled
  if (renamingBoard.value !== b.path) return
  renamingBoard.value = null
  if (v && v !== b.title) send({ type: 'updateBoard', path: b.path, patch: { title: v } })
}

// ---- right-click menu ------------------------------------------------------------------------
const ctx = ref<{ type: 'board' | 'note' | 'canvas', id: string, x: number, y: number }>({ type: 'canvas', id: '', x: 0, y: 0 })
const ctxBoard = computed(() => ctx.value.type === 'board' ? boards.value.find(b => b.path === ctx.value.id) ?? null : null)
function onContextMenu(e: MouseEvent) {
  const t = e.target as HTMLElement
  const w = toWorld(e.clientX, e.clientY)
  const boardEl = t.closest('[data-board]') as HTMLElement | null
  const noteEl = t.closest('[data-note]') as HTMLElement | null
  if (noteEl?.dataset.id) { ctx.value = { type: 'note', id: noteEl.dataset.id, x: w.x, y: w.y }; if (canvasLevel.value && !selection.has(noteKey(noteEl.dataset.id))) selectNote(noteEl.dataset.id) }
  else if (boardEl?.dataset.path) { ctx.value = { type: 'board', id: boardEl.dataset.path, x: w.x, y: w.y }; if (!selection.has(boardKey(boardEl.dataset.path))) selectBoard(boardEl.dataset.path) } // a right-click inside the selection keeps it
  else ctx.value = { type: 'canvas', id: '', x: w.x, y: w.y }
}
function ctxAddBoard() { send({ type: 'addBoard', title: 'Board', x: round(ctx.value.x), y: round(ctx.value.y), w: 1280, h: 800 }) }
function ctxAddSticky() { send({ type: 'addNote', id: uid(), note: { kind: 'sticky', x: round(ctx.value.x), y: round(ctx.value.y), w: 240, text: '' } as any }) }

interface KeyInfo { key: string, code?: string, mod?: boolean, shift?: boolean, alt?: boolean }

/** Ctrl/Cmd combinations the canvas owns. Returns true when handled (the caller then blocks the browser's own action). */
function handleMod(k: KeyInfo): boolean {
  if (!canvasLevel.value) return false
  const c = k.code
  if (k.alt) return false
  if (c === 'KeyA' && !k.shift) { selection.selectAll(); return true }
  if (c === 'KeyK' && !k.shift) { emit('palette'); return true }
  if (c === 'KeyG') return k.shift ? ungroupSelection() : groupSelection()
  if (c === 'KeyL' && k.shift) return toggleLock()
  if (c === 'KeyC' && !k.shift) return board_.copy()
  if (c === 'KeyD' && !k.shift) return board_.duplicate()
  if ((k.key === ']' || k.key === '[') && !k.shift) return board_.reorder(k.key === ']' ? 'front' : 'back')
  return false
}

// ---- pictures ---------------------------------------------------------------------------------------
const pictures = useCanvasPictures({
  canEdit: () => canvasLevel.value, canPaste: () => canvasLevel.value && canvasFocused.value, newId: uid, selection, toWorld, pointer: () => lastClient, viewport, size,
  emitOps: (ops, files) => emit('canvasOps', ops, undefined, files), notify: msg => emit('editNote', msg), frameBase: () => props.data.frameBase, rev: p => revOf.value[p],
})
const { imageUrl, onDrop, hasFiles } = pictures
/** Ctrl+V arrives as a paste event: a picture on the system clipboard wins, else what was copied on the canvas. */
const onPaste = (e: ClipboardEvent) => { pictures.onPaste(e); if (!e.defaultPrevented && canvasLevel.value && canvasFocused.value && !(e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]') && board_.pasteAtPointer()) e.preventDefault() }

// ---- laser pointer, minimap -------------------------------------------------------------------------
const laser = ref(false)
const mapItems = computed(() => allItems.value.map(i => ({ box: itemBox(i), board: i.kind === 'board' })))
const contentBounds = computed(() => unionBox(mapItems.value.map(i => i.box)))
const showMinimap = computed(() => isCanvas.value && !focusBoard.value && contentOutside(contentBounds.value, { tx: tx.value, ty: ty.value, k: k.value }, size))

// ---- group and lock ---------------------------------------------------------------------------------
const { groupSelection, ungroupSelection, toggleLock, selectionLocked, selectionGrouped } = useCanvasGrouping(selection, send, uid)

// ---- copy, paste, duplicate, z-order ---------------------------------------------------------------
const board_ = useCanvasClipboard({ canvas: () => cv.value, selection, send, newId: uid, pointer: () => (lastClient ? toWorld(lastClient.x, lastClient.y) : null), geometry: id => notes.value.find(n => n.id === id) })
/** Align or distribute the selection (from the side panel). */
const align = (mode: AlignMode) => sendMove(patchOps(alignPatches(selection.selected.value, mode)))
const distribute = (axis: 'x' | 'y') => sendMove(patchOps(distributePatches(selection.selected.value, axis)))
function zoomToSelection() {
  const b = selection.bbox.value
  if (b) view_.fitTo([b], true, 2)
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
    else if (key.toLowerCase() === 'l' && props.presenting) laser.value = !laser.value
    return
  }
  if (canvasLevel.value) {
    const t = TOOL_KEYS[key.toLowerCase()]
    if (t && key.length === 1) { emit('tool', t); return }
    if ((key === ']' || key === '[') && canvasFocused.value && board_.reorder(key === ']' ? 'forward' : 'backward')) return // by the character, so it works on any layout
    // Keys 1-9 pick the toolbar slots; Shift+1 fits everything and Shift+2 the selection. By physical key, so it works on any layout.
    const digit = /^Digit([1-9])$/.exec(k.code ?? '')?.[1]
    if (digit && !k.shift) { emit('tool', TOOL_ORDER[+digit - 1]!); return }
    if (k.shift && k.code === 'Digit1') { fit(true); return }
    if (k.shift && k.code === 'Digit2') { zoomToSelection(); return }
    if (key.toLowerCase() === 'q' && creationTool.value) { emit('toolLock', !props.toolLock); return } // lock the drawing tool
    if (key === 'Escape') { emit('tool', 'select'); emit('toolLock', false); selection.clear(); editingNote.value = null; marquee.value = null; erased.value = []; if (drag?.kind === 'erase') drag = null; return }
    if (canvasFocused.value) {
      if ((key === 'Delete' || key === 'Backspace') && selection.count.value) { deleteSelection(); return }
      if (key.startsWith('Arrow') && selection.count.value) { nudge(key); return }
    }
  }
  if (key === '0') fit(true)
  else if (key === '+' || key === '=') zoomAt(1.2)
  else if (key === '-') zoomAt(1 / 1.2)
  else if (key === 'f' || key === 'Enter') { const p = selectedBoard.value ?? boards.value[0]?.path; if (p) enterFocus(p) }
  else if (key === 'Escape') { interacting.value = null; selection.clear(); emit('deselect') }
}

function confirmBoardDelete(list: { title: string }[]) {
  const what = list.length === 1 ? `the board "${list[0]!.title}"` : `${list.length} boards`
  return window.confirm(`Delete ${what}?\n\nThe ${list.length === 1 ? 'file is' : 'files are'} removed from the current version (older versions keep ${list.length === 1 ? 'it' : 'them'}).`)
}
/** Deletes everything selected (locked items stay) in one batch; boards ask once. */
function deleteSelection() {
  const list = selection.selected.value.filter(i => !i.locked)
  if (!list.length) return
  const gone = list.filter(i => i.kind === 'board').map(i => boards.value.find(b => boardKey(b.path) === i.key)!)
  if (gone.length && !confirmBoardDelete(gone)) return
  send(...deleteOps(list))
  selection.clear()
}
let shiftHeld = false
/** Arrow keys move the selection; the viewer folds a held key into one save. */
function nudge(key: string) {
  const step = shiftHeld ? 10 : 1
  sendNudge(...detachBinds(nudgeOps(selection.selected.value, key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0), cv.value?.notes, new Set(selection.keys.value), drawnSize))
}

/** Does the canvas own the keyboard? True after the last press landed on it, so a stray Ctrl+D elsewhere stays the browser's. */
const canvasFocused = ref(false)
function onWindowPointer(e: PointerEvent) {
  const t = e.target as HTMLElement
  // The toolbar, zoom pill and header buttons keep their own arrow-key behaviour.
  canvasFocused.value = !!viewport.value?.contains(t) && !t.closest('[data-toolbar], .zoom, .focusbar, [data-ui], button, input, textarea, [contenteditable="true"]')
  // Pressing the canvas takes the keyboard from a toolbar button that still has focus (Space would otherwise press it).
  if (canvasFocused.value) (document.activeElement as HTMLElement | null)?.blur?.()
}

const onBlur = () => { spaceHeld.value = false }
function onKeyUp(e: KeyboardEvent) { shiftHeld = e.shiftKey; if (e.key === ' ') spaceHeld.value = false }

function onKey(e: KeyboardEvent) {
  shiftHeld = e.shiftKey
  if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) return
  if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return // a dialog or menu owns the keyboard
  const mod = e.metaKey || e.ctrlKey
  if (mod || e.altKey) {
    // Browser shortcuts stay the browser's, unless the canvas has the focus and is being edited.
    if (mod && !e.altKey && canvasFocused.value && handleMod({ key: e.key, code: e.code, mod, shift: e.shiftKey, alt: e.altKey })) e.preventDefault()
    return
  }
  // Hold Space for a temporary hand (only once the canvas has been clicked, so Space on a focused button still presses it).
  if (e.key === ' ' && canvasLevel.value && canvasFocused.value && !(e.target as HTMLElement)?.closest?.('button, a, [role="button"], [role="menuitem"]')) { e.preventDefault(); spaceHeld.value = true; return }
  if (focusBoard.value && [' ', 'PageDown', 'PageUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault()
  if (canvasLevel.value && canvasFocused.value && e.key.startsWith('Arrow') && selection.count.value) e.preventDefault()
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

/** A link clicked inside a board: another board gets the focus, another file loads in this frame, an external address opens in a new tab. */
function navigateFrom(board: BoardView, href: string) {
  let u: URL
  try { u = new URL(href) } catch { return }
  const base = new URL(props.data.frameBase, location.origin)
  if (u.origin === base.origin && u.pathname.startsWith(base.pathname)) {
    let path: string
    try { path = u.pathname.slice(base.pathname.length).split('/').map(decodeURIComponent).join('/') } catch { return }
    if (isCanvas.value && boards.value.some(b => b.path === path)) { enterFocus(path); return }
    if (revOf.value[path] !== undefined) { const el = frames.get(board.path); if (el) el.src = `${u.origin}${u.pathname}${u.search}` }
    return
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') window.open(u.href, '_blank', 'noopener,noreferrer')
}

/** Boards with autosize follow their page: the frame reports its content size and the board is resized to match (edit mode only, since it saves). */
function fitToContent(b: BoardView, cw: unknown, ch: unknown) {
  if (!props.editMode || !b.autosize || b.locked || focusBoard.value || boardOv[b.path]) return
  const h = Math.round(Number(ch)), w = Math.round(Number(cw))
  if (!(h >= 40) || !(w >= 40)) return
  const patch: { w?: number, h?: number } = {}
  if (Math.abs(h - b.h) > 2) patch.h = Math.min(h, 8000)
  if (w > b.w + 2) patch.w = Math.min(w, 8000) // content wider than the board: widen; never shrink the width, the page reflows to it
  if (Object.keys(patch).length) send({ type: 'updateBoard', path: b.path, patch: { ...patch, autosize: true } })
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
  } else if (d.type === 'hub:navigate' && typeof d.href === 'string') {
    navigateFrom(board, d.href)
  } else if (d.type === 'hub:escape') {
    emit('escape')
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
  } else if (d.type === 'hub:tweaks' || d.type === 'hub:tweaks-ready') {
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
    fitToContent(board, d.width, d.height)
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
  const fresh = `${props.data.frameBase}${path.split('/').map(encodeURIComponent).join('/')}?r=${revOf.value[path] ?? 0}&s=${props.data.sharedRev ?? 0}&k=${Date.now()}`
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

/** Live tweak values to a Design Component board: it re-renders in place, no reload. */
function tweaksUpdate(board: string, values: Record<string, unknown>) {
  postTo(board, { type: 'hub:tweaks-update', values })
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
const numbers = computed(() => new Map(props.data.comments.filter(x => !x.parent_id).map((c, i) => [c.id, i + 1])))
const view = computed(() => ({ tx: tx.value, ty: ty.value, k: k.value }))
const getView = () => view.value // a function, so the minimap (not this render) tracks the pan
// Pan/zoom is written straight to the DOM so wheel events do not re-render this component.
const worldEl = ref<HTMLElement>()
// The zoom-dependent bits (--ki = 1/k for counter-scaling, the % label) are written here too, so zooming does not re-render.
const pctEl = ref<HTMLElement>()
const titleK = computed(() => 2 ** (Math.round(Math.log2(k.value) * 4) / 4)) // coarse, so board titles re-render rarely
let lastK = 0
let wcTimer: ReturnType<typeof setTimeout> | undefined
// 1/k for counter-scaled overlays: a plain variable, written onto [data-ki] elements only (not .world, which would restyle every descendant).
let ki = 1 / k.value
const kiNow = () => ki // not reactive on purpose: a fresh element reads the current value, mounted ones are updated by the watcher
watch([tx, ty, k, worldEl, pctEl], () => {
  const el = worldEl.value
  if (el) {
    const t = `translate(${tx.value}px, ${ty.value}px) scale(${k.value})`
    if (t !== el.style.transform) {
      const moving = !!el.style.transform // the first write on mount is not movement
      el.style.transform = t
      if (moving && k.value === lastK) { // own compositor layer only while panning: a zoom would re-raster it every step, and left on it keeps text at the old scale
        el.style.willChange = 'transform'
        clearTimeout(wcTimer)
        wcTimer = setTimeout(() => { el.style.willChange = '' }, 200)
      } else if (moving) { clearTimeout(wcTimer); el.style.willChange = '' }
    }
    if (k.value !== lastK) {
      lastK = k.value; ki = 1 / k.value
      for (const e of el.querySelectorAll<HTMLElement>('[data-ki]')) e.style.setProperty('--ki', String(ki))
    }
  }
  const pct = Math.round(k.value * 100) + '%'
  if (pctEl.value && pctEl.value.textContent !== pct) pctEl.value.textContent = pct
}, { flush: 'sync' })

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
  return { left: x + 'px', top: y + 'px', '--ki': kiNow(), transform: `translate(-50%, -50%) scale(var(--ki))`, cursor: ({ nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' } as Record<string, string>)[h] + '-resize' }
}
function endpoint(n: NoteView, which: 'start' | 'end') {
  const x = which === 'start' ? n.x : n.x + n.w, y = which === 'start' ? n.y : n.y + n.h
  return { left: x + 'px', top: y + 'px', '--ki': kiNow(), transform: `translate(-50%, -50%) scale(var(--ki))`, cursor: 'move' }
}
// (a long stroke is drawn from a thinned copy while it is being drawn, so the preview stays cheap)
const creatingPen = computed(() => { const p = creating.value?.pts; if (!p) return ''; const st = Math.ceil(p.length / 250); return smoothPath(st > 1 ? p.filter((_, i) => i % st === 0 || i === p.length - 1) : p) })
const inCanvasPage = computed(() => isCanvas.value && !focusBoard.value)

defineExpose({ tweaksUpdate, zoomToSelection, align, distribute, boardAtPoint, editCmd, reloadBoard, firstBoard, selectedBoardPath, navKeys, fit, centerOn, pins, broadcast, view, draftPos, enterFocus, exitFocus, step, startPresent, focusBoard, focusIndex, boardCount: computed(() => boards.value.length), selectBoard, selectNote, zoomAt })

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
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('paste', onPaste)
  window.addEventListener('blur', onBlur)
  viewport.value!.addEventListener('wheel', onWheel, { passive: false })
})
onBeforeUnmount(() => {
  clearTimeout(wcTimer)
  ro?.disconnect()
  window.removeEventListener('message', onMessage)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('blur', onBlur)
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
    :class="{ panning, page: !isCanvas, focus: !!focusBoard, tool: canvasLevel && tool !== 'select' && tool !== 'hand' && tool !== 'eraser', hand: (tool === 'hand' || spaceHeld) && canvasLevel, eraser: tool === 'eraser' && canvasLevel }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerleave="lastClient = null"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @click="onViewportClick"
    @dragover="(e: DragEvent) => hasFiles(e) && e.preventDefault()"
    @drop="onDrop"
    @contextmenu="onContextMenu"
  >
    <div ref="worldEl" class="world" :class="{ anim: animate }">
      <div
        v-for="b in drawnBoards"
        :key="b.path"
        data-board
        :data-path="b.path"
        class="board"
        :class="{ interacting: interacting === b.path, selected: selection.has(boardKey(b.path)) && !focusBoard && isCanvas, full: focusBoard === b.path }"
        :style="{ left: b.x + 'px', top: b.y + 'px', width: dims(b).w + 'px', height: dims(b).h + 'px', visibility: focusBoard && focusBoard !== b.path ? 'hidden' : 'visible' }"
      >
        <CanvasBoardTitle
          v-if="isCanvas && !focusBoard" :board="b" :k="titleK" :ki-now="kiNow" :can-edit="canvasLevel" :renaming="renamingBoard === b.path" :drawing="creationTool"
          @rename="startRename(b)" @commit="(v) => commitRename(b, v)" @tweaks="emit('openTweaks', b.path)" @export="emit('exportBoard', b.path)" @focus="enterFocus(b.path)" @play="emit('play', b.path)"
        />
        <img v-if="isCanvas && !noThumb[b.path] && !frameLoaded[b.path]" data-thumb class="thumb" :src="data.thumbBase + encodeURIComponent(b.path)" alt="" loading="lazy" decoding="async" draggable="false" @error="noThumb[b.path] = true">
        <iframe
          v-if="live.has(b.path)"
          :ref="(el) => { if (el) frames.set(b.path, el as HTMLIFrameElement); else frames.delete(b.path) }"
          :src="b.src"
          :title="b.title || 'Artifact'"
          sandbox="allow-scripts allow-popups allow-forms allow-downloads allow-modals"
          referrerpolicy="no-referrer"
          :style="{ visibility: isCanvas && !frameLoaded[b.path] && !noThumb[b.path] ? 'hidden' : 'inherit', pointerEvents: !panning && (!isCanvas || commentMode || elementLevel(b.path) || interacting === b.path || focusBoard === b.path) ? 'auto' : 'none' }"
          @load="frameLoaded[b.path] = true"
        />
        <div
          v-if="isCanvas && !commentMode && interacting !== b.path && focusBoard !== b.path"
          class="board-shield"
          :class="{ movable: canvasLevel && tool === 'select' }"
          :title="canvasLevel ? 'Drag to move, double-click to edit its content' : (b.interactive ? 'Double-click to interact' : '')"
          @pointerdown="onBoardDown($event, b)"
          @click="onShieldClick($event, b)"
          @dblclick="canvasLevel ? (b.group && selection.count.value > 1 ? selection.only(boardKey(b.path)) : enterFocus(b.path)) : (b.interactive ? (interacting = b.path) : enterFocus(b.path))"
        />
      </div>

      <!-- notes and shapes sit above the boards -->
      <CanvasNote
        v-for="n in drawnNotes" :key="n.id" :n="n" :selected="selection.has(noteKey(n.id))" :editable="canvasLevel" :editing="editingNote === n.id" :hidden="!!focusBoard" :erasing="erased.includes(n.id)" :image-src="imageUrl(n)"
        @down="onNoteDown($event, n)" @edit="startNoteEdit(n)" @commit="(text) => commitNoteEdit(n, text)"
      />

      <!-- selection frame and resize handles (canvas level) -->
      <template v-if="selBox && !editingNote">
        <div class="selbox" data-ki :style="{ '--ki': kiNow(), left: selBox.x + 'px', top: selBox.y + 'px', width: selBox.w + 'px', height: selBox.h + 'px', borderWidth: 'calc(2px * var(--ki))' }" />
        <Lock v-if="selectionLocked" class="lock-badge" aria-label="Locked" data-ki :style="{ '--ki': kiNow(), left: selBox.x + selBox.w + 'px', top: selBox.y + 'px', transform: `translate(-100%, -120%) scale(var(--ki))` }" />
        <template v-if="endpointNote">
          <span data-handle class="hd" data-ki :style="endpoint(endpointNote, 'start')" @pointerdown.stop="gestures.startEndpoint($event, endpointNote, 'start')" />
          <span data-handle class="hd" data-ki :style="endpoint(endpointNote, 'end')" @pointerdown.stop="gestures.startEndpoint($event, endpointNote, 'end')" />
        </template>
        <template v-else-if="showHandles">
          <span v-for="h in HANDLES" :key="h" data-handle class="hd" data-ki :style="hStyle(selBox, h)" @pointerdown.stop="gestures.startResize($event, h)" />
        </template>
      </template>

      <!-- snapping guides and the selection rectangle -->
      <div v-for="(g, i) in gestures.guides.value" :key="'g' + i" class="guide" data-ki :style="g.axis === 'x' ? { '--ki': kiNow(), left: g.pos + 'px', top: g.from + 'px', width: 'calc(1px * var(--ki))', height: g.to - g.from + 'px' } : { '--ki': kiNow(), top: g.pos + 'px', left: g.from + 'px', height: 'calc(1px * var(--ki))', width: g.to - g.from + 'px' }" />
      <div v-if="gestures.bindHint.value" class="bind-hl" data-ki :style="{ '--ki': kiNow(), left: gestures.bindHint.value.box.x - 4 + 'px', top: gestures.bindHint.value.box.y - 4 + 'px', width: gestures.bindHint.value.box.w + 8 + 'px', height: gestures.bindHint.value.box.h + 8 + 'px', borderWidth: 'calc(2px * var(--ki))' }" />
      <div v-if="marquee" class="marquee" data-ki :style="{ '--ki': kiNow(), left: marquee.x + 'px', top: marquee.y + 'px', width: marquee.w + 'px', height: marquee.h + 'px', borderWidth: 'calc(1px * var(--ki))' }" />

      <!-- shape being drawn -->
      <template v-if="creating && inCanvasPage">
        <div v-if="creating.tool === 'artboard'" class="draw artboard" :style="{ left: creating.x + 'px', top: creating.y + 'px', width: creating.w + 'px', height: creating.h + 'px' }" />
        <div v-else-if="creating.tool === 'rect' || creating.tool === 'oval'" class="draw" :class="{ oval: creating.tool === 'oval' }" :style="{ left: creating.x + 'px', top: creating.y + 'px', width: creating.w + 'px', height: creating.h + 'px' }" />
        <svg v-else-if="creating.tool === 'arrow' || creating.tool === 'line'" class="draw-svg" overflow="visible" width="1" height="1" :style="{ left: creating.x + 'px', top: creating.y + 'px' }"><line x1="0" y1="0" :x2="creating.w" :y2="creating.h" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" /></svg>
        <svg v-else-if="creating.tool === 'pen'" class="draw-svg" overflow="visible" width="1" height="1" style="left: 0; top: 0"><path :d="creatingPen" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </template>

      <Button
        v-for="c in visiblePins"
        variant="ghost"
        :key="c.id"
        class="pin"
        data-ki
        :class="{ selected: selectedId === c.id, resolved: c.resolved }"
        :style="{ '--ki': kiNow(), left: pins[c.id]!.x + 'px', top: pins[c.id]!.y + 'px', transform: `translate(-50%, -100%) scale(var(--ki))` }"
        :aria-label="`Open comment ${numbers.get(c.id)} by ${c.author_email}`"
        @click.stop="emit('select', c.id)"
      >
        <span>{{ numbers.get(c.id) }}</span>
      </Button>
      <span v-if="draftPos" class="pin draft" data-ki :style="{ '--ki': kiNow(), left: draftPos.x + 'px', top: draftPos.y + 'px', transform: `translate(-50%, -100%) scale(var(--ki))` }"><span>+</span></span>
    </div>

    <CanvasMinimap v-if="showMinimap" :items="mapItems" :get-view="getView" :size="size" @jump="(x, y) => centerOn(x, y)" />
    <LaserOverlay v-if="laser && focusBoard" />
    <ButtonGroup v-if="isCanvas && !focusBoard" class="zoom rounded-lg border bg-card shadow-md" data-ui>
      <Button v-if="canvasLevel" variant="ghost" size="icon-sm" aria-label="Command palette" title="Command palette (Ctrl K)" @click="emit('palette')"><Command /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Present" title="Present the whole canvas" @click="emit('present')"><Play class="size-3 fill-current" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Zoom out" @click="zoomAt(1 / 1.2)"><Minus /></Button>
      <Button class="pct tabular-nums" variant="ghost" size="sm" title="Fit all (0)" @click="fit(true)"><span ref="pctEl" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Zoom in" @click="zoomAt(1.2)"><Plus /></Button>
    </ButtonGroup>

    <div v-if="focusBoard" class="focusbar" data-ui>
      <Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="Previous board" :disabled="boards.length < 2" @click="step(-1)"><ArrowLeft /></Button>
      <span class="count">{{ focusIndex + 1 }} / {{ boards.length }} · {{ boards[focusIndex]?.title }}</span>
      <Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="Next board" :disabled="boards.length < 2" @click="step(1)"><ArrowRight /></Button>
      <Button v-if="presenting" class="rounded-full" :class="{ 'bg-white/20': laser }" variant="ghost" size="icon-sm" :aria-pressed="laser" aria-label="Laser pointer (L)" title="Laser pointer (L)" @click="laser = !laser"><Crosshair /></Button>
      <Button class="close rounded-full" variant="ghost" size="icon-sm" aria-label="Back to canvas (Esc)" title="Back to canvas (Esc)" @click="exitFocus"><X /></Button>
    </div>
  </div>
  </ContextMenuTrigger>
  <CanvasContextMenu
    :type="ctx.type" :id="ctx.id" :canvas-level="canvasLevel" :has-clip="board_.hasClip.value" :locked="selectionLocked" :grouped="selectionGrouped" :can-group="selection.count.value > 1"
    @play="ctxBoard && emit('play', ctxBoard.path)" @focus="ctxBoard && enterFocus(ctxBoard.path)" @tweaks="ctxBoard && emit('openTweaks', ctxBoard.path)" @export="ctxBoard && emit('exportBoard', ctxBoard.path)"
    @lock="toggleLock" @group="groupSelection" @ungroup="ungroupSelection" @duplicate="board_.duplicate" @rename="ctxBoard && startRename(ctxBoard)" @delete-board="deleteSelection" @transfer="(m) => ctxBoard && emit('transferBoard', ctxBoard.path, m)" @copy="board_.copy" @delete-note="deleteSelection"
    @reorder="board_.reorder" @add-board="ctxAddBoard" @add-sticky="ctxAddSticky" @paste="board_.pasteAt(ctx)" @fit="fit(true)" @zoom="zoomAt" @present="emit('present')"
  />
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
.board iframe, .board .thumb { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
.board-shield { position: absolute; inset: 0; cursor: inherit; }
.board-shield.movable { cursor: move; }
.canvas.tool .board-shield { cursor: crosshair; }
.bind-hl { position: absolute; border: solid var(--brand); border-radius: 4px; pointer-events: none; box-sizing: border-box; z-index: 4; }
.canvas.eraser, .canvas.eraser .board-shield { cursor: cell; }
.lock-badge { position: absolute; width: 14px; height: 14px; padding: 2px; border-radius: 4px; background: #fff; color: var(--brand); box-shadow: 0 0 0 1px var(--brand); transform-origin: 100% 100%; pointer-events: none; z-index: 5; }
.guide { position: absolute; background: var(--brand); pointer-events: none; z-index: 4; }
.marquee { position: absolute; border: solid var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); pointer-events: none; box-sizing: border-box; }
.selbox { position: absolute; border: solid var(--brand); pointer-events: none; box-sizing: border-box; }
.hd { position: absolute; width: 10px; height: 10px; background: #fff; border: 1.5px solid var(--brand); border-radius: 2px; box-sizing: border-box; z-index: 5; }
.draw { position: absolute; border: 2px dashed var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); pointer-events: none; box-sizing: border-box; }
.draw.oval { border-radius: 50%; }
.draw.artboard { background: rgba(255, 255, 255, .6); }
.draw-svg { position: absolute; pointer-events: none; }
.pin { position: absolute; transform-origin: 50% 100%; width: 28px; height: 28px; border-radius: 50% 50% 50% 0; background: var(--brand); color: #fff; border: 2px solid #fff; box-shadow: 0 2px 8px rgb(0 0 0 / .3); font: 600 12px/1 var(--font); display: grid; place-items: center; cursor: pointer; padding: 0; rotate: -45deg; transition: none; }
.pin > span { rotate: 45deg; }
.pin.selected { background: var(--fg); outline: 3px solid var(--brand); }
.pin.resolved { background: #8a8f98; opacity: .7; }
.pin.draft { background: var(--brand); opacity: .85; pointer-events: none; }
.zoom { position: absolute; right: 12px; bottom: 12px; width: fit-content; }
.focusbar { z-index: 6; position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; background: rgb(28 27 25 / .88); color: #fff; border-radius: 999px; padding: 4px; backdrop-filter: blur(8px); box-shadow: 0 6px 24px rgb(0 0 0 / .35); max-width: calc(100% - 24px); opacity: .92; transition: opacity .2s; }
.focusbar:hover { opacity: 1; }
.focusbar .count { padding: 0 10px; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
</style>
