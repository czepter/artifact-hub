<script setup lang="ts">
import { X, ArrowLeft, Check, ChevronDown, Copy, Download, MessageSquare, PanelRight, Pencil, Pin, Play, RefreshCw, Share2, Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { Anchor, Comment, ViewData, EditSel } from '~/types'
import { CONTAINER_TAGS, paletteHtml, type PaletteKind } from '#shared/palette'
import { applyCanvasOps, mergeOps, type CanvasOp } from '#shared/canvasOps'
import type { TreeNode } from './LayerTree.vue'

type Tool = 'select' | 'hand' | 'text' | 'artboard' | 'sticky' | 'rect' | 'oval' | 'arrow' | 'line' | 'pen'

const props = defineProps<{ refId: string }>()

interface CanvasApi {
  centerOn: (x: number, y: number) => void
  pins: Record<string, { x: number, y: number }>
  broadcast: (m: unknown) => void
  view: { tx: number, ty: number, k: number }
  draftPos: { x: number, y: number } | null
  startPresent: () => void
  exitFocus: () => void
  navKeys: (enabled: boolean) => void
  editCmd: (board: string, msg: Record<string, unknown>) => void
  reloadBoard: (path: string) => void
  firstBoard: string | null
  selectedBoardPath: string | null
  focusBoard: string | null
  enterFocus: (path: string) => void
  boardAtPoint: (x: number, y: number) => { path: string, x: number, y: number } | null
  selectBoard: (path: string | null) => void
  selectNote: (id: string | null) => void
}

const data = ref<ViewData | null>(null)
const error = ref<{ status: number, message: string } | null>(null)
const pinnedVersion = ref<number | null>(null)
const versionKey = computed<string>({ get: () => (pinnedVersion.value ? String(pinnedVersion.value) : 'live'), set: (v) => { pinnedVersion.value = v === 'live' ? null : Number(v) } })
const commentMode = ref(false)
const draft = ref<{ board: string, anchor: Anchor } | null>(null)
const selectedId = ref<string | null>(null)
const showResolved = ref(false)
const located = reactive<Record<string, boolean>>({})
const canvasRef = ref<CanvasApi>()
const shellRef = ref<HTMLElement>()
const stageRef = ref<HTMLElement>()
const stage = reactive({ w: 800, h: 600 })
const busy = ref(false)
const formError = ref('')
const sidebarOpen = ref(false)
const presenting = ref(false)

// ---- visual editor (owner) ---------------------------------------------------------------------
// Two levels. Canvas level: boards, notes and shapes (saved to canvas.json). Element level: inside one board
// (saved as small operations replayed on the board's source). Both are batched, previewed optimistically and
// saved as one version per burst of edits through the same serialised queue.
const editMode = ref(false)
const sel = ref<EditSel | null>(null)
const editStatus = ref<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle')
const editMessage = ref('')
const editNote = ref('')
const history = ref<{ paths: string[], toVersion: number }[]>([])
const pending = new Map<string, Record<string, unknown>[]>()
const tool = ref<Tool>('select')
// Dragging moves things freely by default; 'flow' makes a drag reorder elements inside the page flow instead.
const dragMode = ref<'free' | 'flow'>('free')
onMounted(() => { try { if (localStorage.getItem('hub_dragmode') === 'flow') dragMode.value = 'flow' } catch {} })
watch(dragMode, (m) => { try { localStorage.setItem('hub_dragmode', m) } catch {} })
const panelTab = ref<'props' | 'code' | 'tweaks'>('props')
const canvasDraft = ref<any | null>(null)
const canvasSel = ref<{ type: 'board' | 'note', id: string }[]>([])
const layerTree = reactive<Record<string, TreeNode>>({})
const tweaksByBoard = reactive<Record<string, { defs: Record<string, any> | null, values: Record<string, unknown> }>>({})
const codeBusy = ref(false)
const codeError = ref('')
let canvasPending: CanvasOp[] = []
/** Full batches set aside so the next one cannot push a save past the server's 200-operation limit. */
const overflow: CanvasOp[][] = []
let commitTimer: ReturnType<typeof setTimeout> | undefined
let noteTimer: ReturnType<typeof setTimeout> | undefined
let baseVersion = 0
let chain: Promise<void> = Promise.resolve()
let enteredFocus = false

/** The saved canvas with not-yet-saved canvas edits applied (so the preview never waits for the server). */
const effectiveCanvas = computed(() => canvasDraft.value ?? data.value?.canvas ?? null)
const hasBoards = computed(() => !!effectiveCanvas.value?.boards)
/** Editing inside one board (a focused board, or a plain single page), as opposed to arranging boards. */
const elementLevel = computed(() => editMode.value && (!hasBoards.value || !!canvasRef.value?.focusBoard))
const activeBoard = computed(() => sel.value?.board ?? (canvasSel.value.length === 1 && canvasSel.value[0]!.type === 'board' ? canvasSel.value[0]!.id : null) ?? canvasRef.value?.focusBoard ?? canvasRef.value?.selectedBoardPath ?? canvasRef.value?.firstBoard ?? null)
const activeTree = computed(() => (activeBoard.value ? layerTree[activeBoard.value] ?? null : null))
const activeTweaks = computed(() => (activeBoard.value ? tweaksByBoard[activeBoard.value] ?? null : null))
const textFiles = computed(() => (data.value?.files ?? []).map(f => f.path))

async function toggleEdit() {
  if (editMode.value) return stopEdit()
  await load()
  if (!data.value || data.value.role !== 'owner' || data.value.artifact.version !== data.value.artifact.live) return
  commentMode.value = false
  closePopover()
  baseVersion = data.value.artifact.live
  history.value = []
  editStatus.value = 'idle'; editMessage.value = ''; editNote.value = ''; sel.value = null; canvasSel.value = []
  tool.value = 'select'; panelTab.value = 'props'
  editMode.value = true
  const c = canvasRef.value
  const n = Object.keys(data.value.canvas?.boards ?? {}).length
  // One board (or a plain page): edit its content straight away. Several boards: start by arranging them.
  if (data.value.canvas?.boards && c && !c.focusBoard && n === 1) {
    const target = c.selectedBoardPath ?? c.firstBoard
    if (target) { c.enterFocus(target); enteredFocus = true }
  }
}
async function stopEdit() {
  await flush()
  editMode.value = false
  sel.value = null; canvasSel.value = []; canvasDraft.value = null
  if (enteredFocus) { canvasRef.value?.exitFocus(); enteredFocus = false }
}

function onEditSelect(board: string, info: Record<string, unknown> | null) {
  sel.value = info ? ({ board, ...info } as unknown as EditSel) : null
}
function queueSave(immediate = false) {
  editStatus.value = 'dirty'; editMessage.value = ''
  clearTimeout(commitTimer)
  commitTimer = setTimeout(() => { void flush() }, immediate ? 0 : 1200)
}
function onEditOp(board: string, op: Record<string, unknown>) {
  const list = pending.get(board) ?? []
  list.push(op)
  pending.set(board, list)
  queueSave()
}
/** One user gesture = one call: the ops are applied to the preview together (all or none) and saved in one batch. */
let lastMerge = ''
function onCanvasOps(ops: CanvasOp[], merge = '') {
  if (!ops.length) return
  if (ops.length > 200) { onEditNote('That is too many items for one change (200 at most). Select fewer.'); return }
  const base = canvasDraft.value ?? data.value?.canvas ?? null
  try {
    canvasDraft.value = applyCanvasOps(base, (data.value?.files ?? []).map(f => f.path), ops).canvas
  } catch (e: any) { onEditNote(e?.message ?? 'That change is not allowed'); return }
  // The server takes at most 200 operations per save: save what is pending first rather than overflow it and lose it.
  // Each gesture is its own save and undo step; only repeats of the same kind (a held arrow key, a slider drag) fold together.
  const continues = !!merge && merge === lastMerge
  lastMerge = merge
  if (canvasPending.length && !continues) { overflow.push(canvasPending); canvasPending = [] }
  if (canvasPending.length + ops.length > 180) { overflow.push(canvasPending); canvasPending = []; void flush() }
  canvasPending = mergeOps(canvasPending, ops)
  // Adding or removing a board changes files, so it is saved at once; everything else waits for a pause.
  queueSave(ops.some(op => op.type === 'addBoard' || op.type === 'removeBoard' || op.type === 'duplicateBoard'))
}
const onCanvasOp = (op: CanvasOp, merge = '') => onCanvasOps([op], merge)
function onEditNote(text: string) {
  editNote.value = text
  clearTimeout(noteTimer)
  noteTimer = setTimeout(() => (editNote.value = ''), 5000)
}

function flush(): Promise<void> {
  clearTimeout(commitTimer)
  chain = chain.then(commitAll)
  return chain
}
const errText = (e: any, fallback: string) => e?.data?.statusMessage ?? e?.statusMessage ?? fallback
async function commitAll() {
  const id = data.value?.artifact.id
  if (!id) return
  // 1. canvas-level edits (set-aside batches first, then what is pending now)
  while (overflow.length || canvasPending.length) {
    const ops = overflow.shift() ?? canvasPending
    if (ops === canvasPending) canvasPending = []
    if (!ops.length) continue
    editStatus.value = 'saving'
    try {
      const r = await $fetch<{ version: number, removed: string[] }>(`/api/artifacts/${id}/canvas`, { method: 'POST', body: { baseVersion, ops } })
      history.value.push({ paths: ['canvas.json', ...r.removed], toVersion: baseVersion })
      baseVersion = r.version
      editStatus.value = 'saved'
      await load()
      if (!canvasPending.length && !overflow.length) canvasDraft.value = null
    } catch (e: any) {
      editStatus.value = 'error'; editMessage.value = errText(e, 'Could not save')
      canvasDraft.value = null; canvasPending = []; overflow.length = 0
      await resync([])
      return
    }
  }
  // 2. element-level edits, per board
  for (const [board, ops] of [...pending.entries()]) {
    if (!ops.length) continue
    pending.set(board, [])
    editStatus.value = 'saving'
    try {
      const r = await $fetch<{ version: number, warnings: string[] }>(`/api/artifacts/${id}/edit`, { method: 'POST', body: { path: board, baseVersion, ops } })
      history.value.push({ paths: [board], toVersion: baseVersion })
      baseVersion = r.version
      editStatus.value = 'saved'
      if (r.warnings?.length) onEditNote(`Some changes were skipped: ${r.warnings[0]}`)
    } catch (e: any) {
      editStatus.value = 'error'; editMessage.value = errText(e, 'Could not save')
      await resync([board]) // what the editor shows no longer matches what is stored
      return
    }
  }
}
async function resync(boards: string[]) {
  await load()
  baseVersion = data.value?.artifact.live ?? baseVersion
  sel.value = null
  for (const b of boards) canvasRef.value?.reloadBoard(b)
}

async function undo() {
  if (!editMode.value) return
  clearTimeout(commitTimer)
  const dirty = [...pending.entries()].filter(([, o]) => o.length).map(([b]) => b)
  if (dirty.length || canvasPending.length || overflow.length) { // unsaved changes: discard them and show the stored state again
    dirty.forEach(b => pending.set(b, []))
    canvasPending = []; overflow.length = 0; canvasDraft.value = null
    editStatus.value = 'idle'
    await resync(dirty)
    return
  }
  await chain
  const h = history.value.pop()
  if (!h) return
  editStatus.value = 'saving'
  try {
    for (const path of h.paths) {
      const r = await $fetch<{ version: number }>(`/api/artifacts/${data.value!.artifact.id}/revert`, { method: 'POST', body: { path, toVersion: h.toVersion, baseVersion } })
      baseVersion = r.version
    }
    editStatus.value = 'saved'
    sel.value = null
    await load()
    for (const path of h.paths) canvasRef.value?.reloadBoard(path)
  } catch (e: any) {
    history.value.push(h)
    editStatus.value = 'error'
    editMessage.value = errText(e, 'Could not undo')
  }
}

function panelCmd(c: Record<string, unknown>) {
  const board = sel.value?.board ?? activeBoard.value
  if (!board) return
  canvasRef.value?.editCmd(board, { id: sel.value?.id, ...c })
}
function addElement(kind: PaletteKind) {
  const board = sel.value?.board ?? canvasRef.value?.focusBoard ?? canvasRef.value?.firstBoard ?? 'index.html'
  const id = 'n' + Math.random().toString(36).slice(2, 8)
  const target = sel.value ? { id: sel.value.id, position: CONTAINER_TAGS.has(sel.value.tag) ? 'inside' : 'after' } : undefined
  const op = { type: 'insert', kind, id, ...(target ? { target } : {}) }
  canvasRef.value?.editCmd(board, { cmd: 'insert', op, html: paletteHtml(kind, id) })
}
// Picking an element in the canvas-wide layers opens its board for editing and selects it there.
function pickElement(p: { board: string, id: string }) {
  canvasRef.value?.enterFocus(p.board)
  setTimeout(() => canvasRef.value?.editCmd(p.board, { cmd: 'select', id: p.id }), 450)
}
function onLayerHover(id: string | null) { if (activeBoard.value) canvasRef.value?.editCmd(activeBoard.value, { cmd: 'hover', id }) }
function onEditTree(board: string, tree: unknown) { layerTree[board] = tree as TreeNode }
function onEditTweaks(board: string, t: { defs: Record<string, unknown> | null, values: Record<string, unknown> }) { tweaksByBoard[board] = t as { defs: Record<string, any> | null, values: Record<string, unknown> } }
function onTweakChange(values: Record<string, unknown>) {
  const board = activeBoard.value
  if (!board) return
  canvasRef.value?.editCmd(board, { cmd: 'tweak-set', props: values }) // live preview in the board
  tweaksByBoard[board] = { defs: tweaksByBoard[board]?.defs ?? null, values }
  onCanvasOp({ type: 'updateBoard', path: board, patch: { tweaks: Object.keys(values).length ? values : null } }, 'tweak:' + board)
}
async function onOpenTweaks(path: string) {
  if (data.value?.role !== 'owner') return
  if (!editMode.value) await toggleEdit()
  if (!editMode.value) return
  canvasRef.value?.selectBoard(path)
  panelTab.value = 'tweaks'
}
function playBoard(path: string) {
  const go = () => canvasRef.value?.enterFocus(path)
  if (editMode.value) void stopEdit().then(go); else go()
}
function editContent(path: string) { canvasRef.value?.enterFocus(path) }
async function onEditExport(html: string) {
  try { await navigator.clipboard.writeText(html); onEditNote('HTML copied to the clipboard') } catch { onEditNote('Could not copy: your browser blocked clipboard access') }
}
async function exportBoard(path: string) {
  try {
    const r = await $fetch<{ source: string }>(`/api/artifacts/${data.value!.artifact.id}/source`, { query: { path } })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([r.source], { type: 'text/html' }))
    a.download = path.split('/').pop() || 'board.html'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  } catch (e: any) { onEditNote(errText(e, 'Could not download the board')) }
}
async function applyCode(p: { mode: 'element' | 'file', path: string, id: string | null, text: string }) {
  codeBusy.value = true; codeError.value = ''
  try {
    await flush()
    if (p.mode === 'element' && p.id) {
      onEditOp(p.path, { type: 'replace', id: p.id, html: p.text })
      await flush()
      if (editStatus.value === 'error') throw new Error(editMessage.value)
    } else {
      const before = baseVersion
      const r = await $fetch<{ version: number }>(`/api/artifacts/${data.value!.artifact.id}/source`, { method: 'POST', body: { path: p.path, baseVersion, source: p.text } })
      history.value.push({ paths: [p.path], toVersion: before })
      baseVersion = r.version
      editStatus.value = 'saved'
    }
    canvasDraft.value = null
    await resync([p.path])
  } catch (e: any) { codeError.value = e?.message && !e?.data ? e.message : errText(e, 'Could not apply the change') } finally { codeBusy.value = false }
}
// Drag a palette item onto a board. The pointer is captured on the button so it keeps reporting while it is over
// the board's iframe; the frame draws the drop indicator and does the insertion.
const LABELS: Record<PaletteKind, string> = { heading: 'Heading', text: 'Text', button: 'Button', link: 'Link', image: 'Image', box: 'Box', divider: 'Divider', input: 'Input' }
const dragGhost = ref<{ label: string, x: number, y: number } | null>(null)
let drag: { kind: PaletteKind, x0: number, y0: number, moved: boolean, over: string | null } | null = null

function startPaletteDrag(kind: PaletteKind, e: PointerEvent) {
  if (e.button !== 0 || !editMode.value) return
  try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch {}
  drag = { kind, x0: e.clientX, y0: e.clientY, moved: false, over: null }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  window.addEventListener('pointercancel', onDragCancel)
  window.addEventListener('keydown', onDragKey)
}
function stopDragListeners() {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragCancel)
  window.removeEventListener('keydown', onDragKey)
  dragGhost.value = null
}
function onDragMove(e: PointerEvent) {
  if (!drag) return
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return
  drag.moved = true
  dragGhost.value = { label: LABELS[drag.kind], x: e.clientX + 14, y: e.clientY + 14 }
  const hit = canvasRef.value?.boardAtPoint(e.clientX, e.clientY) ?? null
  if (drag.over && drag.over !== hit?.path) canvasRef.value?.editCmd(drag.over, { cmd: 'drag-leave' })
  drag.over = hit?.path ?? null
  if (hit) canvasRef.value?.editCmd(hit.path, { cmd: 'drag-over', x: hit.x, y: hit.y })
}
function onDragEnd(e: PointerEvent) {
  const d = drag
  drag = null
  stopDragListeners()
  if (!d) return
  if (!d.moved) { addElement(d.kind); return } // a plain click adds at the default place
  const hit = canvasRef.value?.boardAtPoint(e.clientX, e.clientY) ?? null
  if (d.over && d.over !== hit?.path) canvasRef.value?.editCmd(d.over, { cmd: 'drag-leave' })
  if (!hit) return
  const id = 'n' + Math.random().toString(36).slice(2, 8)
  canvasRef.value?.editCmd(hit.path, { cmd: 'drag-drop', kind: d.kind, id, html: paletteHtml(d.kind, id), x: hit.x, y: hit.y })
}
function onDragCancel() {
  const d = drag
  drag = null
  stopDragListeners()
  if (d?.over) canvasRef.value?.editCmd(d.over, { cmd: 'drag-leave' })
}
function onDragKey(e: KeyboardEvent) { if (e.key === 'Escape') onDragCancel() }

// Last chance to save when the tab closes.
function onPageHide() {
  if (canvasPending.length && data.value) void fetch(`/api/artifacts/${data.value.artifact.id}/canvas`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseVersion, ops: canvasPending }) })
  for (const [board, ops] of pending) {
    if (!ops.length || !data.value) continue
    void fetch(`/api/artifacts/${data.value.artifact.id}/edit`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: board, baseVersion, ops }) })
  }
}

async function load() {
  try {
    const next = await $fetch<ViewData>(`/api/view/${props.refId}`, { query: pinnedVersion.value ? { v: pinnedVersion.value } : {} })
    // Skip no-op updates so refreshing never rebuilds iframes.
    if (!data.value || JSON.stringify(next) !== JSON.stringify(data.value)) data.value = next
    error.value = null
  } catch (e: any) {
    error.value = { status: e?.statusCode ?? e?.status ?? 0, message: e?.statusMessage ?? e?.message ?? 'Failed to load' }
  }
}

// ---- live updates: SSE, with a slow poll as a safety net ----------------------------------------
let timer: ReturnType<typeof setInterval> | undefined
let source: EventSource | undefined
let ro: ResizeObserver | undefined
onMounted(async () => {
  await load()
  if (data.value && data.value.role === 'owner') $fetch(`/api/artifacts/${data.value.artifact.id}/opened`, { method: 'POST' }).catch(() => {})
  timer = setInterval(() => { if (!document.hidden && !draft.value) load() }, 30000)
  source = new EventSource(`/api/view/${props.refId}/events`)
  let opened = false
  source.addEventListener('ready', () => { if (opened) load(); opened = true }) // resync after a reconnect
  const refresh = () => { if (!draft.value) load() }
  source.addEventListener('version', refresh)
  source.addEventListener('comments', refresh)
  source.addEventListener('meta', refresh)
  source.addEventListener('data', (e) => {
    try {
      const d = JSON.parse((e as MessageEvent).data)
      canvasRef.value?.broadcast({ type: 'hub:data-changed', scope: d.scope, keys: d.keys })
    } catch {}
  })
  document.addEventListener('keydown', onDocKey)
  window.addEventListener('pagehide', onPageHide)
})
watch(stageRef, (el) => {
  ro?.disconnect()
  if (!el) return
  ro = new ResizeObserver(([e]) => { stage.w = e!.contentRect.width; stage.h = e!.contentRect.height })
  ro.observe(el)
})
onBeforeUnmount(() => {
  clearInterval(timer); source?.close(); ro?.disconnect()
  document.removeEventListener('keydown', onDocKey)
  window.removeEventListener('pagehide', onPageHide)
  clearTimeout(commitTimer); clearTimeout(noteTimer)
})
watch(pinnedVersion, load)

// window.artifact support: frames ask, we answer with this viewer's session.
function hello() {
  const d = data.value
  if (!d) return null
  return {
    artifactId: d.artifact.id, version: d.artifact.version, live: d.artifact.live,
    viewer: { name: d.role === 'owner' ? (d.email ?? 'owner') : d.email, role: d.role, canWrite: d.role !== 'view' && !!d.email },
  }
}
function rpc(req: { op: string, scope: string, key?: unknown, value?: unknown, prefix?: unknown }) {
  return $fetch(`/api/view/${props.refId}/data`, { method: 'POST', body: req })
}

// ---- comments ----------------------------------------------------------------------------------
const roots = computed(() => (data.value?.comments ?? []).filter(c => !c.parent_id))
const openCount = computed(() => roots.value.filter(r => !r.resolved).length)
const visibleRoots = computed(() => roots.value.filter(c => showResolved.value || !c.resolved))
const repliesOf = (id: string) => (data.value?.comments ?? []).filter(c => c.parent_id === id)
const canComment = computed(() => !!data.value && data.value.role !== 'view')
const needsEmail = computed(() => !!data.value && data.value.role === 'comment' && !data.value.email)
const isLive = computed(() => !!data.value && data.value.artifact.version === data.value.artifact.live)
const selected = computed(() => roots.value.find(c => c.id === selectedId.value))

function onTarget(t: { board: string, anchor: Anchor }) {
  draft.value = t
  selectedId.value = null
  formError.value = ''
}

async function post(path: string, body?: unknown) {
  return $fetch(`/api/view/${props.refId}/${path}`, { method: 'POST', body })
}

async function submitDraft(body: string) {
  if (!draft.value) return
  busy.value = true
  formError.value = ''
  try {
    await post('comments', { body, board: draft.value.board, anchor: draft.value.anchor, version: data.value!.artifact.version })
    draft.value = null
    await load()
  } catch (e: any) { formError.value = e?.statusMessage ?? 'Could not post' } finally { busy.value = false }
}

async function reply(body: string) {
  if (!selected.value) return
  busy.value = true
  formError.value = ''
  try {
    await post('comments', { body, parentId: selected.value.id })
    await load()
  } catch (e: any) { formError.value = e?.statusMessage ?? 'Could not post' } finally { busy.value = false }
}

async function toggleResolve() {
  const c = selected.value
  if (!c) return
  await post(`comments/${c.id}/resolve`, { resolved: !c.resolved })
  await load()
}

async function saveEmail(email: string) {
  formError.value = ''
  try {
    await $fetch('/api/identity', { method: 'POST', body: { email } })
    await load()
  } catch (e: any) { formError.value = e?.statusMessage ?? 'Invalid e-mail' }
}

function select(id: string) {
  const same = selectedId.value === id
  selectedId.value = same ? null : id
  draft.value = null
  formError.value = ''
  const p = canvasRef.value?.pins[id]
  if (p && !same) canvasRef.value?.centerOn(p.x, p.y)
}

function deselect() {
  // A comment being written is only dropped by its Cancel/close button, never by a stray click.
  selectedId.value = null
  formError.value = ''
}

function closePopover() {
  selectedId.value = null
  draft.value = null
  formError.value = ''
}

// The popover sits at the marker, in stage coordinates, and follows pan and zoom.
const anchor = computed(() => {
  const c = canvasRef.value
  if (!c) return null
  const w = draft.value ? c.draftPos : selectedId.value ? c.pins[selectedId.value] : null
  if (!w) return null
  return { x: c.view.tx + w.x * c.view.k, y: c.view.ty + w.y * c.view.k }
})
const popoverOpen = computed(() => !!draft.value || !!selected.value)
const popoverStyle = computed(() => {
  const W = 320
  const a = anchor.value
  if (!a) return { right: '12px', top: '12px' } // detached thread: dock top-right
  let left = a.x + 22
  if (left + W > stage.w - 8) left = a.x - 22 - W
  left = Math.max(8, Math.min(left, stage.w - W - 8))
  const top = Math.max(8, Math.min(a.y - 40, stage.h - 200))
  return { left: `${left}px`, top: `${top}px` }
})

// ---- artifact menu (owner) ---------------------------------------------------------------------
const menuOpen = ref(false)
const renaming = ref(false)
const renameValue = ref('')
const renameInput = ref<{ $el: HTMLInputElement }>()
const isOwner = computed(() => data.value?.role === 'owner')

const icons: Record<string, string> = {
  share: 'M8 10V2M5 5l3-3 3 3M3 9v4h10V9',
  export: 'M8 2v8M5 7l3 3 3-3M3 13h10',
  duplicate: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  rename: 'M3 13l.7-3L11 2.7a1.4 1.4 0 012 2L5.7 12 3 13z',
  pin: 'M9.5 2l4.5 4.5-2.2.7-2.6 2.6.4 3.2-1 1L6 10.5 2.5 14 2 13.5 5.5 10 2.3 7.8l1-1 3.2.4 2.6-2.6z',
  refresh: 'M13 8a5 5 0 11-1.6-3.7M13 2.5v3h-3',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5',
  play: 'M5 3l8 5-8 5z',
  check: 'M3 8.5l3.2 3.2L13 4.5',
  comment: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z',
  list: 'M3 4h10M3 8h10M3 12h6',
}

function closeMenu() { menuOpen.value = false; shareOpen.value = false }
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { closeMenu(); if (renaming.value) renaming.value = false; endPresent() }
  if (editMode.value && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) { e.preventDefault(); void undo() }
  // The same shortcuts also work when keyboard focus is in the panel rather than in the board.
  if (editMode.value && sel.value && !e.ctrlKey && !e.metaKey && !(e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable], button')) {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); panelCmd({ cmd: 'delete' }) }
    else if (sel.value.free && e.key.startsWith('Arrow')) {
      e.preventDefault()
      const n = e.shiftKey ? 10 : 1
      panelCmd({ cmd: 'nudge', dx: e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, dy: e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0 })
    }
  }
  if (editMode.value && sel.value && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && !(e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) { e.preventDefault(); panelCmd({ cmd: 'duplicate' }) }
}

function startRename() {
  menuOpen.value = false
  renameValue.value = data.value!.artifact.title
  renaming.value = true
  nextTick(() => { renameInput.value?.$el?.focus(); renameInput.value?.$el?.select() })
}
async function commitRename() {
  const t = renameValue.value.trim()
  renaming.value = false
  if (!t || t === data.value!.artifact.title) return
  await $fetch(`/api/artifacts/${data.value!.artifact.id}`, { method: 'PATCH', body: { title: t } })
  await load()
}
async function togglePin() {
  menuOpen.value = false
  await $fetch(`/api/artifacts/${data.value!.artifact.id}`, { method: 'PATCH', body: { pinned: !data.value!.artifact.pinned } })
  await load()
}
async function duplicate() {
  menuOpen.value = false
  const r = await $fetch<{ id: string }>(`/api/artifacts/${data.value!.artifact.id}/duplicate`, { method: 'POST' })
  await navigateTo(`/a/${r.id}`, { external: true })
}
function exportZip() {
  menuOpen.value = false
  const v = pinnedVersion.value ? `?v=${pinnedVersion.value}` : ''
  window.location.href = `/api/artifacts/${data.value!.artifact.id}/export${v}`
}
async function refresh() { menuOpen.value = false; await load() }
const deleteOpen = ref(false)
function askRemove() { menuOpen.value = false; deleteOpen.value = true }
async function remove() {
  menuOpen.value = false
  await $fetch(`/api/artifacts/${data.value!.artifact.id}`, { method: 'DELETE' })
  await navigateTo('/', { external: true })
}

// ---- sharing (owner) ---------------------------------------------------------------------------
const shareOpen = ref(false)
const shares = ref<{ token: string, role: string, revoked: number, created_at: string }[]>([])
const copied = ref('')
const origin = computed(() => (import.meta.client ? location.origin : ''))
async function loadShares() { shares.value = await $fetch(`/api/artifacts/${data.value!.artifact.id}/shares`) }
function openShare() { menuOpen.value = false; shareOpen.value = true; void loadShares() }
async function createShare(role: 'comment' | 'view') {
  await $fetch(`/api/artifacts/${data.value!.artifact.id}/shares`, { method: 'POST', body: { role } })
  shares.value = await $fetch(`/api/artifacts/${data.value!.artifact.id}/shares`)
}
async function revoke(token: string) {
  await $fetch(`/api/artifacts/${data.value!.artifact.id}/shares/${token}`, { method: 'DELETE' })
  shares.value = await $fetch(`/api/artifacts/${data.value!.artifact.id}/shares`)
}
async function copy(token: string) {
  await navigator.clipboard.writeText(`${origin.value}/s/${token}`)
  copied.value = token
  setTimeout(() => (copied.value = ''), 1500)
}

// ---- present: the canvas takes the whole app window (header and sidebar hide); no browser fullscreen ------
async function present() {
  if (editMode.value) await stopEdit()
  commentMode.value = false
  closePopover()
  presenting.value = true
  nextTick(() => {
    canvasRef.value?.startPresent() // canvas artifacts: first board, stepping through `order`
    canvasRef.value?.navKeys(true) // let Esc/arrows reach us from inside the page
  })
}
function endPresent() {
  if (!presenting.value) return
  presenting.value = false
  canvasRef.value?.exitFocus()
  canvasRef.value?.navKeys(false)
}
function onFocusChange(path: string | null) {
  if (path === null && presenting.value) endPresent()
  sel.value = null // the selection belonged to the board we just left
  if (path === null) canvasSel.value = []
}

useHead(() => ({ title: data.value ? `${data.value.artifact.title} · Artifact Hub` : 'Artifact Hub' }))
</script>

<template>
  <div v-if="error" class="center">
    <Card class="w-full max-w-sm">
      <CardHeader>
        <CardTitle as="h1">{{ error.status === 404 ? 'Not available' : 'Could not open this' }}</CardTitle>
        <CardDescription>{{ error.status === 404 ? 'No artifact is served at this address. A share link may have been revoked, or the artifact deleted.' : error.message }}</CardDescription>
      </CardHeader>
      <CardContent v-if="error.status === 404" class="grid gap-2">
        <p class="text-sm text-muted-foreground">Owner? Sign in to open it from your library.</p>
        <Button as-child variant="outline"><NuxtLink to="/">Go to sign-in</NuxtLink></Button>
      </CardContent>
    </Card>
  </div>

  <div v-else-if="data" ref="shellRef" class="shell" :class="{ closed: !sidebarOpen && !editMode, presenting, editing: editMode, focused: !!canvasRef?.focusBoard && !presenting }">
    <header v-show="!presenting" class="bar">
      <div class="pill">
        <Button v-if="isOwner" as-child variant="ghost" size="icon-sm"><NuxtLink to="/artifacts" aria-label="All artifacts"><ArrowLeft /></NuxtLink></Button>

        <Input
          v-if="renaming"
          ref="renameInput"
          v-model="renameValue"
          class="h-8 w-[min(320px,40vw)] font-semibold"
          aria-label="Artifact name"
          @keydown.enter="commitRename"
          @keydown.esc.stop="renaming = false"
          @blur="commitRename"
        />
        <DropdownMenu v-else-if="isOwner" v-model:open="menuOpen">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="sm" class="max-w-[40vw] gap-1.5 font-semibold">
              <span class="truncate">{{ data.artifact.title }}</span>
              <ChevronDown class="text-muted-foreground" />
              <Pin v-if="data.artifact.pinned" class="size-3" aria-label="Pinned" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-64">
            <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">Owned by you<br>Updated {{ ago(data.artifact.updatedAt) }} · v{{ data.artifact.live }}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="exportZip"><Download />Export as .zip</DropdownMenuItem>
            <DropdownMenuItem @select="duplicate"><Copy />Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="startRename"><Pencil />Rename</DropdownMenuItem>
            <DropdownMenuItem @select="togglePin"><Pin />{{ data.artifact.pinned ? 'Unpin' : 'Pin to top' }}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="refresh"><RefreshCw />Refresh</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" @select="askRemove"><Trash2 />Delete artifact</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <h1 v-else class="px-2 text-sm font-semibold">{{ data.artifact.title }}</h1>

        <Select v-model="versionKey">
          <SelectTrigger size="sm" class="w-auto gap-2" aria-label="Version"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="live">Live (v{{ data.artifact.live }})</SelectItem>
            <SelectItem v-for="v in data.versions" :key="v.version" :value="String(v.version)">v{{ v.version }}{{ v.label ? ` · ${v.label}` : '' }}</SelectItem>
          </SelectContent>
        </Select>
        <span v-if="!isLive" class="hide-sm text-xs text-muted-foreground">Viewing an older version</span>
      </div>
      <div class="pill">
        <Button v-if="isOwner" :variant="editMode ? 'default' : 'ghost'" size="sm" :aria-pressed="editMode" :disabled="!isLive || presenting" :title="isLive ? 'Edit this board visually' : 'Switch to the live version to edit'" @click="toggleEdit">
          <Check v-if="editMode" /><Pencil v-else />{{ editMode ? 'Done' : 'Edit' }}
        </Button>
        <IconBtn label="Present" :disabled="editMode" @click="present"><Play /></IconBtn>
        <IconBtn v-if="canComment || needsEmail" :label="commentMode ? 'Done commenting' : 'Comment'" :active="commentMode" :disabled="editMode" @click="commentMode = !commentMode; if (!commentMode) closePopover()">
          <MessageSquare />
        </IconBtn>
        <Popover v-if="isOwner" :open="shareOpen" @update:open="(o: boolean) => { shareOpen = o; if (o) loadShares() }">
          <Tooltip><TooltipTrigger as-child><PopoverTrigger as-child><Button variant="ghost" size="icon-sm" aria-label="Share"><Share2 /></Button></PopoverTrigger></TooltipTrigger><TooltipContent side="bottom">Share</TooltipContent></Tooltip>
          <PopoverContent align="end" class="w-[360px] max-w-[90vw] space-y-3">
            <div class="flex flex-wrap gap-2">
              <Button size="sm" @click="createShare('comment')">New comment link</Button>
              <Button size="sm" variant="outline" @click="createShare('view')">New view link</Button>
            </div>
            <ul class="grid gap-2">
              <li v-for="s in shares.filter(s => !s.revoked)" :key="s.token" class="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{{ s.role }}</Badge>
                <code class="text-xs text-muted-foreground">…{{ s.token.slice(-6) }}</code>
                <span class="grow" />
                <Button size="xs" variant="outline" @click="copy(s.token)">{{ copied === s.token ? 'Copied' : 'Copy link' }}</Button>
                <Button size="xs" variant="outline" @click="revoke(s.token)">Revoke</Button>
              </li>
              <li v-if="!shares.some(s => !s.revoked)" class="text-sm text-muted-foreground">No active links. Artifacts are private until you create one.</li>
            </ul>
          </PopoverContent>
        </Popover>
        <IconBtn :label="`Comments (${openCount} open)`" :active="sidebarOpen" @click="sidebarOpen = !sidebarOpen">
          <PanelRight />
          <Badge v-if="openCount" class="absolute -right-1 -top-1 h-[18px] min-w-[18px] justify-center rounded-full px-1 text-[11px] tabular-nums">{{ openCount }}</Badge>
        </IconBtn>
      </div>
    </header>

    <main ref="stageRef" class="stage">
      <Canvas
        ref="canvasRef"
        :data="data"
        :canvas="effectiveCanvas"
        :comment-mode="commentMode"
        :edit-mode="editMode"
        :tool="tool"
        :drag-mode="dragMode"
        :selected-id="selectedId"
        :draft="draft"
        :rpc="rpc"
        :hello="hello"
        @target="onTarget"
        @select="select"
        @deselect="deselect"
        @focus-change="onFocusChange"
        @edit-select="onEditSelect"
        @edit-op="onEditOp"
        @edit-note="onEditNote"
        @edit-undo="undo"
        @edit-tree="onEditTree"
        @edit-tweaks="onEditTweaks"
        @edit-export="onEditExport"
        @edit-reload="(b: string) => resync([b])"
        @canvas-ops="onCanvasOps"
        @canvas-select="(s) => (canvasSel = s)"
        @tool="(t) => (tool = t)"
        @play="playBoard"
        @present="present"
        @open-tweaks="onOpenTweaks"
        @export-board="exportBoard"
        @pins-changed="(s) => Object.assign(located, s)"
      />
      <CanvasToolbar v-if="editMode && hasBoards && !canvasRef?.focusBoard && !presenting" v-model:tool="tool" />
      <Button v-if="presenting && !data.canvas?.boards" class="exit-present" variant="secondary" size="icon-sm" aria-label="Exit presentation (Esc)" title="Exit (Esc)" @click="endPresent"><X /></Button>
      <div v-if="commentMode && !draft && !presenting" class="hint" role="status">Click anything on the page to comment on it</div>

      <ThreadPopover
        v-if="popoverOpen && !presenting && !editMode"
        :key="draft ? 'draft' : selectedId!"
        class="popover"
        :style="popoverStyle"
        :mode="draft ? 'draft' : 'thread'"
        :target="draft ? { tag: draft.anchor.tag, text: draft.anchor.text } : undefined"
        :thread="selected"
        :replies="selected ? repliesOf(selected.id) : []"
        :number="selected ? roots.indexOf(selected) + 1 : undefined"
        :version-note="selected && selected.version !== data.artifact.version ? `v${selected.version}` : ''"
        :detached="!!selected?.anchor && located[selected.id] === false"
        :can-comment="canComment"
        :needs-email="needsEmail"
        :busy="busy"
        :error="formError"
        @submit="submitDraft"
        @reply="reply"
        @resolve="toggleResolve"
        @save-email="saveEmail"
        @close="closePopover"
      />
    </main>

    <aside v-show="(sidebarOpen || editMode) && !presenting" class="side" :aria-label="editMode ? 'Editor' : 'All comments'">
      <EditorPanel
        v-if="editMode"
        v-model:tab="panelTab"
        v-model:drag-mode="dragMode"
        :sel="sel"
        :status="editStatus"
        :message="editMessage"
        :note="editNote"
        :can-undo="history.length > 0 || editStatus === 'dirty'"
        :element-level="elementLevel"
        :tree="activeTree"
        :canvas-sel="canvasSel"
        :trees="layerTree"
        :canvas="effectiveCanvas"
        :is-canvas="hasBoards"
        :board-count="Object.keys(effectiveCanvas?.boards ?? {}).length"
        :artifact-id="data.artifact.id"
        :files="textFiles"
        :active-board="activeBoard"
        :tweaks="activeTweaks"
        :code-busy="codeBusy"
        :code-error="codeError"
        @cmd="panelCmd"
        @add="addElement"
        @drag="startPaletteDrag"
        @undo="undo"
        @done="stopEdit"
        @hover="onLayerHover"
        @pick-note="(id) => canvasRef?.selectNote(id)"
        @pick-board="(p) => canvasRef?.selectBoard(p)"
        @pick-element="pickElement"
        @canvas-op="onCanvasOp"
        @canvas-ops="onCanvasOps"
        @edit-content="editContent"
        @play="playBoard"
        @tweak="onTweakChange"
        @code-apply="applyCode"
        @export-board="exportBoard"
      />
      <label v-if="!editMode" class="flex items-center gap-2 px-1 pb-1 text-sm text-muted-foreground"><Checkbox v-model="showResolved" /> Show resolved</label>
      <p v-if="!editMode && !visibleRoots.length" class="muted empty">
        {{ canComment ? 'No comments yet. Turn on Comment, then click anything on the page.' : 'No comments yet.' }}
      </p>
      <Button
        v-for="c in (editMode ? [] : visibleRoots)"
        :key="c.id"
        variant="ghost"
        class="item h-auto whitespace-normal"
        :class="{ selected: selectedId === c.id, resolved: c.resolved, detached: !!c.anchor && located[c.id] === false }"
        @click="select(c.id)"
      >
        <span class="num">{{ roots.indexOf(c) + 1 }}</span>
        <span class="txt">
          <span class="line1"><strong>{{ c.author_kind === 'model' ? 'Claude' : c.author_email }}</strong> <span class="muted">{{ ago(c.created_at) }}</span></span>
          <span class="snip">{{ c.body }}</span>
          <span v-if="repliesOf(c.id).length || c.resolved || (c.anchor && located[c.id] === false) || c.version !== data.artifact.version" class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span v-if="repliesOf(c.id).length">{{ repliesOf(c.id).length }} {{ repliesOf(c.id).length === 1 ? 'reply' : 'replies' }}</span>
            <Badge v-if="c.resolved" variant="secondary">resolved</Badge>
            <Badge v-if="c.anchor && located[c.id] === false" variant="destructive">detached</Badge>
            <Badge v-if="c.version !== data.artifact.version" variant="outline">v{{ c.version }}</Badge>
          </span>
        </span>
      </Button>
    </aside>
  </div>

  <AlertDialog v-if="data" v-model:open="deleteOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete “{{ data.artifact.title }}”?</AlertDialogTitle>
        <AlertDialogDescription>This permanently removes all versions, comments, share links and stored data. It cannot be undone.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep it</AlertDialogCancel>
        <AlertDialogAction class="bg-destructive text-white hover:bg-destructive/90" @click="remove">Delete artifact</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <div v-if="dragGhost" class="ghost" :style="{ left: dragGhost.x + 'px', top: dragGhost.y + 'px' }" aria-hidden="true">{{ dragGhost.label }}</div>

  <div v-else-if="!data && !error" class="center"><span class="muted">Loading…</span></div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: 1fr 300px; grid-template-rows: 1fr; height: 100%; background: var(--bg); position: relative; }
.shell.closed { grid-template-columns: 1fr 0; }
.shell.editing { grid-template-columns: 1fr 340px; }
.shell.focused { grid-template-rows: 52px 1fr; }
.shell.focused .bar { grid-row: 1; margin: 0; padding: 0 10px; height: 52px; align-self: stretch; background: var(--panel); border-bottom: 1px solid var(--border); }
.shell.focused .pill { background: transparent; border: 0; box-shadow: none; padding: 0; }
.shell.focused .stage { grid-row: 2; }
.shell.focused .side { grid-row: 1 / -1; margin: 0; border-radius: 0; border-width: 0 0 0 1px; box-shadow: none; }
.shell.presenting { grid-template-columns: 1fr; grid-template-rows: 1fr; }
.shell.presenting .stage { grid-column: 1; }
.bar { grid-column: 1; grid-row: 1; z-index: 25; align-self: start; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin: 10px 12px 0; min-width: 0; pointer-events: none; }
.bar > .pill:last-child { margin-left: auto; }
.pill { pointer-events: auto; display: flex; align-items: center; gap: 4px; padding: 4px 6px; min-width: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 4px 18px rgb(0 0 0 / .14); }
.stage { grid-column: 1; grid-row: 1; position: relative; min-width: 0; min-height: 0; overflow: hidden; }
.ghost { position: fixed; z-index: 1000; pointer-events: none; padding: 6px 12px; border-radius: 8px; background: var(--primary); color: var(--primary-foreground); font: 600 12px/1 system-ui, sans-serif; box-shadow: 0 6px 20px rgb(0 0 0 / .25); }
.exit-present { position: absolute; top: 12px; right: 12px; z-index: 20; opacity: .6; transition: opacity .2s; }
.exit-present:hover, .exit-present:focus-visible { opacity: 1; }
.hint { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); background: var(--fg); color: var(--bg); padding: 6px 12px; border-radius: 999px; font-size: 13px; pointer-events: none; }
.popover { position: absolute; z-index: 15; max-height: calc(100% - 16px); }
.side { grid-column: 2; grid-row: 1; margin: 10px 10px 10px 0; border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 4px 18px rgb(0 0 0 / .14); background: var(--panel); overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.empty { margin: 8px 4px; }
.item { display: flex; justify-content: flex-start; gap: 10px; align-items: flex-start; text-align: left; border: 1px solid transparent; background: transparent; border-radius: 10px; padding: 8px; cursor: pointer; width: 100%; }
.item:hover { background: var(--hover); }
.item.selected { border-color: var(--brand); background: var(--bg); }
.item.resolved .snip { color: var(--muted-foreground); }
.item.resolved .num { background: var(--muted); color: var(--muted-foreground); }
.item.detached .num { background: var(--destructive); color: #fff; }
.item.detached { border-style: dashed; border-color: var(--border); }
.num { background: var(--primary); color: var(--primary-foreground); border-radius: 999px; min-width: 22px; height: 22px; display: inline-grid; place-items: center; font-size: 12px; font-weight: 600; flex: none; font-variant-numeric: tabular-nums; }
.txt { display: grid; gap: 2px; min-width: 0; font-size: 13px; }
.line1 { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.snip { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.small { font-size: 12px; }
@media (max-width: 800px) {
  .shell, .shell.closed { grid-template-columns: 1fr; grid-template-rows: 1fr auto; }
  .shell.presenting { grid-template-rows: 1fr; }
  .side { grid-column: 1; grid-row: 2; margin: 0 10px 10px; max-height: 40vh; }
  .hide-sm { display: none; }
  .popover { left: 8px !important; right: 8px !important; top: auto !important; bottom: 8px; width: auto !important; max-height: 70%; }
}
</style>
