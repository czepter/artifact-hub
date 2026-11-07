// Turns a selection (or a finished gesture) into canvas operations. Pure, so the viewer's one delete,
// nudge and commit path is the same everywhere and is unit-tested.
import { NOTE_KINDS, type CanvasOp } from './canvasOps'
import { type Box, type GeomItem, type GeomPatch, noteGeometry, noteBox, unionBox } from './canvasGeometry'

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


/** Update operations for geometry patches keyed by selection key (align, distribute). */
export function patchOps(patches: Record<string, GeomPatch>): CanvasOp[] {
  return Object.entries(patches).map(([key, patch]) => {
    const r = refOfKey(key)
    return (r.type === 'board' ? { type: 'updateBoard', path: r.id, patch: { ...patch } } : { type: 'updateNote', id: r.id, patch: JSON.parse(JSON.stringify(patch)) }) as CanvasOp
  })
}

/** Selection items with resolved geometry, read from a stored canvas (the side panel has no live view). */
export function itemsFromCanvas(canvas: { boards?: Record<string, any>, notes?: Record<string, any> } | null | undefined, refs: SelRef[]): GeomItem[] {
  const out: GeomItem[] = []
  for (const r of refs) {
    if (r.type === 'board') {
      const b = canvas?.boards?.[r.id]
      if (b) out.push({ key: boardKey(r.id), kind: 'board', x: +b.x || 0, y: +b.y || 0, w: +b.w || 800, h: +b.h || 600, locked: !!b.locked })
    } else {
      const v = canvas?.notes?.[r.id]
      if (v) { const g = noteGeometry(v); out.push({ key: noteKey(r.id), kind: g.kind, x: g.x, y: g.y, w: g.w, h: g.h || (g.kind === 'line' || g.kind === 'arrow' ? 0 : noteBox(g).h), points: g.points, locked: !!v.locked }) }
    }
  }
  return out
}

// ---- copy and paste ---------------------------------------------------------------------------------
export interface ClipPayload { notes: { note: Record<string, unknown> }[], boards: { path: string, entry: Record<string, any> }[] }

/** What the selection looks like on the clipboard: copies of the stored notes and board entries. */
export function copyPayload(canvas: { boards?: Record<string, any>, notes?: Record<string, any> } | null | undefined, refs: SelRef[]): ClipPayload {
  const clip: ClipPayload = { notes: [], boards: [] }
  for (const r of refs) {
    if (r.type === 'note' && canvas?.notes?.[r.id]) clip.notes.push({ note: JSON.parse(JSON.stringify(canvas.notes[r.id])) })
    else if (r.type === 'board' && canvas?.boards?.[r.id]) clip.boards.push({ path: r.id, entry: JSON.parse(JSON.stringify(canvas.boards[r.id])) })
  }
  return clip
}

export function clipBox(clip: ClipPayload): Box | null {
  const boxes: Box[] = [
    ...clip.notes.map(n => { const g = noteGeometry(n.note); return noteBox({ ...g, h: g.h }) }),
    ...clip.boards.map(b => ({ x: +b.entry.x || 0, y: +b.entry.y || 0, w: +b.entry.w || 800, h: +b.entry.h || 600 })),
  ]
  return unionBox(boxes)
}

/**
 * Operations that paste the clipboard moved by (dx, dy). Notes get new ids; boards are duplicated (their files are
 * copied by the server). Group, lock and arrow bindings are not carried over: they refer to the originals.
 */
export function pasteOps(clip: ClipPayload, d: { dx: number, dy: number }, newId: () => string): { ops: CanvasOp[], noteIds: string[], boardPaths: string[] } {
  const ops: CanvasOp[] = [], noteIds: string[] = [], boardPaths: string[] = []
  const r1 = (n: number) => Math.round(n * 10) / 10
  for (const { note } of clip.notes) {
    if (!NOTE_KINDS.includes((note.kind ?? 'sticky') as never)) continue
    const copy: Record<string, unknown> = { ...note }
    delete copy.group; delete copy.locked; delete copy.bind
    copy.x = r1((+(note.x as number) || 0) + d.dx); copy.y = r1((+(note.y as number) || 0) + d.dy)
    const id = newId()
    noteIds.push(id)
    ops.push({ type: 'addNote', id, note: copy } as CanvasOp)
  }
  for (const b of clip.boards) {
    // The copy gets a path chosen here, so the caller knows what to select afterwards.
    const dot = b.path.lastIndexOf('.'), copyTo = `${b.path.slice(0, dot).replace(/-[a-z0-9]{6}$/, '')}-${newId().replace(/^nt/, '')}${b.path.slice(dot)}`
    const ok = copyTo.split('/').every(seg => seg.length <= 80)
    if (ok) boardPaths.push(copyTo)
    ops.push({ type: 'duplicateBoard', path: b.path, x: r1((+b.entry.x || 0) + d.dx), y: r1((+b.entry.y || 0) + d.dy), ...(ok ? { copyTo } : {}) })
  }
  return { ops, noteIds, boardPaths }
}
