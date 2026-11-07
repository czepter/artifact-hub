// Turns a selection (or a finished gesture) into canvas operations. Pure, so the viewer's one delete,
// nudge and commit path is the same everywhere and is unit-tested.
import type { CanvasOp } from './canvasOps'

export type SelRef = { type: 'board' | 'note', id: string }
export const boardKey = (path: string) => `b:${path}`
export const noteKey = (id: string) => `n:${id}`
export const refOfKey = (key: string): SelRef => ({ type: key[0] === 'b' ? 'board' : 'note', id: key.slice(2) })

interface Keyed { key: string, locked?: boolean }

/** Delete operations for the selection. Locked items are skipped. */
export function deleteOps(items: Keyed[]): CanvasOp[] {
  return items.filter(i => !i.locked).map((i) => {
    const r = refOfKey(i.key)
    return (r.type === 'board' ? { type: 'removeBoard', path: r.id } : { type: 'deleteNote', id: r.id }) as CanvasOp
  })
}

/** Move every unlocked item by (dx, dy) from where it is now. */
export function nudgeOps(items: (Keyed & { x: number, y: number })[], dx: number, dy: number): CanvasOp[] {
  return items.filter(i => !i.locked).map((i) => {
    const r = refOfKey(i.key), patch = { x: Math.round((i.x + dx) * 10) / 10, y: Math.round((i.y + dy) * 10) / 10 }
    return (r.type === 'board' ? { type: 'updateBoard', path: r.id, patch } : { type: 'updateNote', id: r.id, patch }) as CanvasOp
  })
}

/** The update operations for a set of live geometry overrides (what a drag changed), one per item that has one. */
export function overrideOps(keys: string[], boardOv: Record<string, object | undefined>, noteOv: Record<string, object | undefined>): CanvasOp[] {
  const ops: CanvasOp[] = []
  for (const key of keys) {
    const r = refOfKey(key), o = r.type === 'board' ? boardOv[r.id] : noteOv[r.id]
    if (!o) continue
    const patch = JSON.parse(JSON.stringify(o))
    ops.push((r.type === 'board' ? { type: 'updateBoard', path: r.id, patch } : { type: 'updateNote', id: r.id, patch }) as CanvasOp)
  }
  return ops
}
