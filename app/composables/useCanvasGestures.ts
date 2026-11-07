import type { CanvasOp } from '#shared/canvasOps'
import { type Box, type GeomItem, type GeomPatch, moveEndpoint, round1, scaleItems } from '#shared/canvasGeometry'
import { overrideOps, refOfKey, noteKey } from '#shared/canvasItemOps'
import type { useCanvasSelection } from './useCanvasSelection'

type Ov = Partial<{ x: number, y: number, w: number, h: number, points: number[][] }>
type G =
  | { kind: 'move', x: number, y: number, orig: { key: string, x: number, y: number }[], moved: boolean }
  | { kind: 'resize', handle: string, x: number, y: number, items: GeomItem[], bbox: Box, moved: boolean }
  | { kind: 'endpoint', id: string, which: 'start' | 'end', x: number, y: number, orig: Box, moved: boolean }

/**
 * Drags that transform the selection: move, resize (one item or many, same code) and moving a line's end point.
 * While dragging only the live overrides (`boardOv` / `noteOv`) change, so nothing is sent to the server per frame;
 * on release everything goes out as one batch of operations, which is one undo step.
 */
export function useCanvasGestures(selection: ReturnType<typeof useCanvasSelection>, boardOv: Record<string, Ov | undefined>, noteOv: Record<string, Ov | undefined>, k: Ref<number>) {
  let g: G | null = null
  const active = () => g !== null

  function setOverride(key: string, patch: Ov) {
    const r = refOfKey(key)
    if (r.type === 'board') boardOv[r.id] = patch; else noteOv[r.id] = patch
  }

  /** Pressing a selectable thing: it becomes the selection (unless already part of one); a drag moves the whole selection. */
  function startMove(e: PointerEvent, key: string) {
    e.stopPropagation(); e.preventDefault() // no text selection, and no native drag that would cancel the pointer stream
    if (!selection.has(key)) selection.only(key)
    g = { kind: 'move', x: e.clientX, y: e.clientY, orig: selection.selected.value.filter(i => !i.locked).map(i => ({ key: i.key, x: i.x, y: i.y })), moved: false }
  }
  /** A handle of the selection box. */
  function startResize(e: PointerEvent, handle: string) {
    e.stopPropagation(); e.preventDefault()
    const bbox = selection.bbox.value
    if (!bbox) return
    g = { kind: 'resize', handle, x: e.clientX, y: e.clientY, items: selection.selected.value.map(i => ({ ...i, points: i.points?.map(p => [...p]) })), bbox: { ...bbox }, moved: false }
  }
  function startEndpoint(e: PointerEvent, n: { id: string, x: number, y: number, w: number, h: number }, which: 'start' | 'end') {
    e.stopPropagation(); e.preventDefault()
    g = { kind: 'endpoint', id: n.id, which, x: e.clientX, y: e.clientY, orig: { x: n.x, y: n.y, w: n.w, h: n.h }, moved: false }
  }

  /** Pointer moved. Returns 'start' the first time the drag passes the click threshold, true afterwards. */
  function onMove(e: PointerEvent): 'start' | boolean {
    if (!g) return false
    const dx = e.clientX - g.x, dy = e.clientY - g.y
    let first = false
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 4) return false
      g.moved = true; first = true
    }
    const wx = dx / k.value, wy = dy / k.value
    if (g.kind === 'move') for (const o of g.orig) setOverride(o.key, { x: round1(o.x + wx), y: round1(o.y + wy) })
    else if (g.kind === 'resize') {
      const r = scaleItems(g.items, g.bbox, g.handle, { dx: wx, dy: wy, keepAspect: e.shiftKey, fromCenter: e.altKey })
      for (const [key, p] of Object.entries(r.patches) as [string, GeomPatch][]) setOverride(key, p)
    } else noteOv[g.id] = moveEndpoint(g.orig, g.which, wx, wy)
    return first ? 'start' : true
  }

  /** Pointer released: the whole gesture as one batch (empty if nothing moved). */
  function end(): { moved: boolean, ops: CanvasOp[], clear: () => void } {
    const d = g
    g = null
    if (!d || !d.moved) return { moved: false, ops: [], clear: () => {} }
    const keys = d.kind === 'move' ? d.orig.map(o => o.key) : d.kind === 'resize' ? d.items.filter(i => !i.locked).map(i => i.key) : [noteKey(d.id)]
    const ops = overrideOps(keys, boardOv, noteOv)
    const clear = () => { for (const key of keys) { const r = refOfKey(key); if (r.type === 'board') delete boardOv[r.id]; else delete noteOv[r.id] } }
    return { moved: true, ops, clear }
  }

  return { active, startMove, startResize, startEndpoint, onMove, end }
}
