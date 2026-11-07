import type { CanvasOp } from '#shared/canvasOps'
import { type ClipPayload, clipBox, copyPayload, pasteOps } from '#shared/canvasItemOps'
import { noteKey } from '#shared/canvasItemOps'
import type { useCanvasSelection } from './useCanvasSelection'

/** Copy, paste, duplicate and z-order of the selection. Everything it does goes out as one batch through `send`. */
export function useCanvasClipboard(opts: {
  canvas: () => unknown, selection: ReturnType<typeof useCanvasSelection>, send: (...ops: CanvasOp[]) => void
  newId: () => string, pointer: () => { x: number, y: number } | null
}) {
  const { selection, send } = opts
  const clip = shallowRef<ClipPayload | null>(null)
  let pastes = 0
  const hasClip = computed(() => !!clip.value && (clip.value.notes.length > 0 || clip.value.boards.length > 0))
  const snapshot = () => copyPayload(opts.canvas() as never, selection.refs.value)

  /** Pastes copies moved by `d`; the pasted notes become the selection. */
  function pasteClip(c: ClipPayload, d: { dx: number, dy: number }) {
    const r = pasteOps(c, d, opts.newId)
    if (!r.ops.length) return false
    send(...r.ops)
    nextTick(() => selection.set(r.noteIds.map(noteKey)))
    return true
  }
  function copy() {
    if (!selection.count.value) return false
    clip.value = snapshot(); pastes = 0
    return true
  }
  /** At the pointer when it is over the canvas (a little further each time in the same place), else beside the original. */
  function pasteAtPointer() {
    const c = clip.value, box = c && clipBox(c)
    if (!c || !box) return false
    const n = ++pastes, off = 16 * (n - 1), to = opts.pointer() ?? { x: box.x + 24 * n, y: box.y + 24 * n }
    return pasteClip(c, { dx: to.x - box.x + off, dy: to.y - box.y + off })
  }
  function pasteAt(p: { x: number, y: number }) {
    const c = clip.value, box = c && clipBox(c)
    if (c && box) pasteClip(c, { dx: p.x - box.x, dy: p.y - box.y })
  }
  const duplicate = () => (selection.count.value ? pasteClip(snapshot(), { dx: 24, dy: 24 }) : false)
  /** Alt-drag: copies of the selection where the drag ended. */
  const cloneBy = (d: { dx: number, dy: number }) => pasteClip(snapshot(), d)
  /** Z-order applies to notes (they always sit above boards). */
  function reorder(mode: 'front' | 'back' | 'forward' | 'backward') {
    const ids = selection.refs.value.filter(r => r.type === 'note').map(r => r.id)
    if (!ids.length) return false
    send({ type: 'reorderNotes', ids, mode })
    return true
  }
  return { hasClip, copy, pasteAtPointer, pasteAt, duplicate, cloneBy, reorder }
}
