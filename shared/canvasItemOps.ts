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
export interface ClipPayload { notes: { id: string, note: Record<string, any> }[], boards: { path: string, entry: Record<string, any> }[] }

/** What the selection looks like on the clipboard: copies of the stored notes and board entries. */
export function copyPayload(canvas: { boards?: Record<string, any>, notes?: Record<string, any> } | null | undefined, refs: SelRef[]): ClipPayload {
  const clip: ClipPayload = { notes: [], boards: [] }
  for (const r of refs) {
    if (r.type === 'note' && canvas?.notes?.[r.id]) clip.notes.push({ id: r.id, note: JSON.parse(JSON.stringify(canvas.notes[r.id])) })
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
  const noteMap = new Map<string, string>(), boardMap = new Map<string, string>()
  // Groups that are copied with two or more members stay groups (under a new id).
  const members = new Map<string, number>()
  for (const g of [...clip.notes.map(n => n.note.group), ...clip.boards.map(b => b.entry.group)]) if (typeof g === 'string') members.set(g, (members.get(g) ?? 0) + 1)
  const groupMap = new Map<string, string>([...members].filter(([, n]) => n > 1).map(([g]) => [g, 'g' + newId().replace(/^nt/, '')]))
  // Boards first, so arrows copied with them can attach to the copies.
  for (const b of clip.boards) {
    // The copy gets a path chosen here, so the caller knows what to select afterwards.
    const dot = b.path.lastIndexOf('.'), copyTo = `${b.path.slice(0, dot).replace(/-[a-z0-9]{6}$/, '')}-${newId().replace(/^nt/, '')}${b.path.slice(dot)}`
    const ok = copyTo.split('/').every(seg => seg.length <= 80)
    if (ok) { boardPaths.push(copyTo); boardMap.set(b.path, copyTo) }
    ops.push({ type: 'duplicateBoard', path: b.path, x: r1((+b.entry.x || 0) + d.dx), y: r1((+b.entry.y || 0) + d.dy), ...(ok ? { copyTo } : {}) })
    const g = groupMap.get(b.entry.group)
    if (ok && g) ops.push({ type: 'updateBoard', path: copyTo, patch: { group: g } })
  }
  const pasteable = clip.notes.filter(n => NOTE_KINDS.includes((n.note.kind ?? 'sticky') as never))
  for (const n of pasteable) noteMap.set(n.id, newId())
  // Shapes before arrows: an arrow can only be bound to something that exists.
  const isArrow = (n: { note: Record<string, any> }) => n.note.kind === 'arrow'
  for (const { id: oldId, note } of [...pasteable.filter(n => !isArrow(n)), ...pasteable.filter(isArrow)]) {
    const copy: Record<string, unknown> = { ...note }
    delete copy.locked; delete copy.group; delete copy.bind
    const g = groupMap.get(note.group as string)
    if (g) copy.group = g
    // An arrow keeps its attachments to things that were copied along with it; the rest come loose.
    const bind: Record<string, unknown> = {}
    for (const end of ['start', 'end'] as const) {
      const t = note.kind === 'arrow' ? (note.bind as any)?.[end] : undefined
      const to = t ? (t.type === 'board' ? boardMap.get(t.id) : noteMap.get(t.id)) : undefined
      if (t && to) bind[end] = { type: t.type, id: to }
    }
    if (Object.keys(bind).length) copy.bind = bind
    copy.x = r1((+(note.x as number) || 0) + d.dx); copy.y = r1((+(note.y as number) || 0) + d.dy)
    const id = noteMap.get(oldId)!
    noteIds.push(id)
    ops.push({ type: 'addNote', id, note: copy } as CanvasOp)
  }
  return { ops, noteIds, boardPaths }
}

// ---- group, lock, style, bindings ---------------------------------------------------------------------------
type Patchable = { key: string }
const updateFor = (key: string, patch: Record<string, unknown>): CanvasOp => {
  const r = refOfKey(key)
  return (r.type === 'board' ? { type: 'updateBoard', path: r.id, patch } : { type: 'updateNote', id: r.id, patch }) as CanvasOp
}

/** All items that share a group with `key` (or just `key`). Clicking a grouped item selects the whole group. */
export function groupKeys(items: (Patchable & { group?: string })[], key: string): string[] {
  const g = items.find(i => i.key === key)?.group
  return g ? items.filter(i => i.group === g).map(i => i.key) : [key]
}
/** Put the items in one new group (two or more). Items that were in other groups join it. */
export function groupOps(items: Patchable[], groupId: string): CanvasOp[] {
  return items.length < 2 ? [] : items.map(i => updateFor(i.key, { group: groupId }))
}
export function ungroupOps(items: (Patchable & { group?: string })[]): CanvasOp[] {
  return items.filter(i => i.group).map(i => updateFor(i.key, { group: null }))
}
export function lockOps(items: Patchable[], locked: boolean): CanvasOp[] {
  return items.map(i => updateFor(i.key, { locked: locked ? true : null }))
}

export interface StyleChange { stroke?: string, strokeWidth?: number, strokeStyle?: string, fill?: string, roundness?: string, arrowStart?: string, arrowEnd?: string }
/** Which style fields apply to which kind of note. */
export const STYLE_FIELDS: Record<string, (keyof StyleChange)[]> = {
  rect: ['stroke', 'strokeWidth', 'strokeStyle', 'fill', 'roundness'], oval: ['stroke', 'strokeWidth', 'strokeStyle', 'fill'],
  line: ['stroke', 'strokeWidth', 'strokeStyle', 'arrowStart', 'arrowEnd'], arrow: ['stroke', 'strokeWidth', 'strokeStyle', 'arrowStart', 'arrowEnd'], pen: ['stroke', 'strokeWidth', 'strokeStyle'],
}
/** One update per selected note for the style fields that apply to its kind; all of it is one batch. */
export function styleOps(notes: { id: string, kind: string }[], change: StyleChange): CanvasOp[] {
  const ops: CanvasOp[] = []
  for (const n of notes) {
    const patch: Record<string, unknown> = {}
    for (const f of STYLE_FIELDS[n.kind] ?? []) if (change[f] !== undefined) patch[f] = change[f]
    if (Object.keys(patch).length) ops.push({ type: 'updateNote', id: n.id, patch } as CanvasOp)
  }
  return ops
}

/**
 * An arrow that is moved or resized on its own comes loose from the things it was bound to: the update operations get
 * a `bind` patch without the ends whose target is not moving along (`moving`: selection keys).
 */
export function detachBinds(ops: CanvasOp[], notes: Record<string, any> | undefined, moving: Set<string>, drawn?: (id: string) => { w: number, h: number } | undefined): CanvasOp[] {
  return ops.map((op) => {
    if (op.type !== 'updateNote' || (op.patch as any).bind !== undefined) return op
    const bind = notes?.[op.id]?.bind
    if (!bind) return op
    const keep: Record<string, unknown> = {}
    for (const end of ['start', 'end'] as const) {
      const t = bind[end]
      if (t && moving.has(t.type === 'board' ? boardKey(t.id) : noteKey(t.id))) keep[end] = t
    }
    if (Object.keys(keep).length === Number(!!bind.start) + Number(!!bind.end)) return op
    // The arrow keeps the shape it is drawn with now: a stored size may be stale if a target moved since it was bound.
    const g = drawn?.(op.id)
    return { ...op, patch: { ...op.patch, ...(g ? { w: g.w, h: g.h } : {}), bind: Object.keys(keep).length ? keep : null } } as CanvasOp
  })
}
