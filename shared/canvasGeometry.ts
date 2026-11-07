// Pure canvas geometry, shared by the viewer and the unit tests. No DOM, no Vue.
// Everything here works in world coordinates (canvas px), before the pan/zoom transform.

export interface Box { x: number, y: number, w: number, h: number }

/** A selectable thing, with its geometry already resolved (defaults filled in, live overrides applied). */
export interface GeomItem {
  /** Selection key: `n:<noteId>` or `b:<boardPath>`. */
  key: string
  kind: 'board' | 'sticky' | 'text' | 'rect' | 'oval' | 'line' | 'arrow' | 'pen' | (string & {})
  x: number, y: number, w: number, h: number
  /** Pen strokes: points relative to x/y. */
  points?: number[][]
  locked?: boolean
}

/** What a transform wants to change on one item. Only the keys present are written. */
export interface GeomPatch { x?: number, y?: number, w?: number, h?: number, points?: number[][] }

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type Handle = (typeof HANDLES)[number]

export const MIN_BOARD = 40
export const MIN_NOTE = 8
export const MAX_SIZE = 8000
/** Scale never goes below this, even when a selection has nothing with a minimum (lines, pen strokes). */
const MIN_SCALE = 0.02

export const round1 = (n: number) => Math.round(n * 10) / 10

export const isDirected = (kind: string) => kind === 'line' || kind === 'arrow'
/** Sticky notes and text grow with their content: their height is not part of a multi-item resize. */
export const hasAutoHeight = (kind: string) => kind === 'sticky' || kind === 'text'

/** Bounding box of a note in world coordinates (lines and arrows may have negative extents). */
export function noteBox(n: { kind: string, x: number, y: number, w: number, h: number, points?: number[][] }): Box {
  if (isDirected(n.kind)) return { x: Math.min(n.x, n.x + n.w), y: Math.min(n.y, n.y + n.h), w: Math.abs(n.w), h: Math.abs(n.h) }
  if (n.kind === 'pen') {
    const pts = n.points ?? []
    const xs = pts.map(p => p[0]!), ys = pts.map(p => p[1]!)
    const x0 = Math.min(0, ...xs), y0 = Math.min(0, ...ys)
    return { x: n.x + x0, y: n.y + y0, w: Math.max(8, Math.max(0, ...xs) - x0), h: Math.max(8, Math.max(0, ...ys) - y0) }
  }
  return { x: n.x, y: n.y, w: n.w, h: n.h || (n.kind === 'sticky' ? 120 : 40) }
}

export function itemBox(it: GeomItem): Box {
  return it.kind === 'board' ? { x: it.x, y: it.y, w: it.w, h: it.h } : noteBox(it)
}

/** Smallest box containing all boxes, or null for none. */
export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y))
  const x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const dirOf = (handle: string) => ({ ex: handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0, ey: handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0 })

export interface ScaleOptions {
  /** Pointer movement since the gesture began, in world px. */
  dx: number, dy: number
  /** Corner handles only: scale both axes by the same factor. */
  keepAspect?: boolean
  /** Scale around the middle of the box instead of the opposite edge. */
  fromCenter?: boolean
}

export interface ScaleResult {
  patches: Record<string, GeomPatch>
  /** The selection box after the transform. */
  box: Box
  sx: number, sy: number
}

/**
 * Scales a selection about one anchor, the way a single resize handle would, for any number of items.
 * Locked items are skipped (they keep their place). The factor is clamped for the whole selection, so relative
 * layout never distorts: no item gets smaller than its minimum or larger than MAX_SIZE.
 */
export function scaleItems(items: GeomItem[], bbox: Box, handle: string, opts: ScaleOptions): ScaleResult {
  const { ex, ey } = dirOf(handle)
  const movable = items.filter(i => !i.locked)
  const multi = items.length > 1
  // Raw factors from the pointer.
  let sx = ex && bbox.w > 0 ? (bbox.w + ex * opts.dx * (opts.fromCenter ? 2 : 1)) / bbox.w : 1
  let sy = ey && bbox.h > 0 ? (bbox.h + ey * opts.dy * (opts.fromCenter ? 2 : 1)) / bbox.h : 1
  if (opts.keepAspect && ex && ey) {
    const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy
    sx = sy = s
  }
  // Limits per axis: min over what each item needs, max over what each item allows.
  const limits = (axis: 'x' | 'y') => {
    let lo = MIN_SCALE, hi = Infinity
    for (const it of movable) {
      if (axis === 'y' && multi && hasAutoHeight(it.kind)) continue
      const size = axis === 'x' ? itemBox(it).w : itemBox(it).h
      if (!(size > 0)) continue
      const min = it.kind === 'board' ? MIN_BOARD : (isDirected(it.kind) || it.kind === 'pen') ? 0 : MIN_NOTE
      if (min) lo = Math.max(lo, min / size)
      hi = Math.min(hi, MAX_SIZE / size)
    }
    return [lo, Math.max(lo, hi)] as const
  }
  const clampTo = (s: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, s))
  const lx = limits('x'), ly = limits('y')
  if (opts.keepAspect && ex && ey) {
    // One shared factor that respects both axes' limits.
    const s = clampTo(clampTo(sx, lx), ly)
    sx = sy = s
  } else { sx = clampTo(sx, lx); sy = clampTo(sy, ly) }
  if (!ex) sx = 1
  if (!ey) sy = 1

  const ax = opts.fromCenter ? bbox.x + bbox.w / 2 : ex > 0 ? bbox.x : ex < 0 ? bbox.x + bbox.w : bbox.x
  const ay = opts.fromCenter ? bbox.y + bbox.h / 2 : ey > 0 ? bbox.y : ey < 0 ? bbox.y + bbox.h : bbox.y
  const px = (v: number) => ax + (v - ax) * sx
  const py = (v: number) => ay + (v - ay) * sy

  const patches: Record<string, GeomPatch> = {}
  for (const it of movable) {
    const p: GeomPatch = {}
    const keepH = multi && hasAutoHeight(it.kind)
    if (it.kind === 'pen') {
      p.x = round1(px(it.x)); p.y = round1(py(it.y))
      p.points = (it.points ?? []).map(pt => [round1(pt[0]! * sx), round1(pt[1]! * sy)])
    } else if (isDirected(it.kind)) {
      p.x = round1(px(it.x)); p.y = round1(py(it.y)); p.w = round1(it.w * sx); p.h = round1(it.h * sy)
    } else {
      p.x = round1(px(it.x)); p.w = round1(it.w * sx)
      if (keepH) p.y = round1(py(it.y))
      else { p.y = round1(py(it.y)); p.h = round1(it.h * sy) }
    }
    patches[it.key] = p
  }
  const ub = unionBox(movable.map(i => patchBox(i, patches[i.key]!)))
  return { patches, box: ub ?? bbox, sx, sy }
}

/** Box of an item after a patch (used to report the new selection box). */
function patchBox(it: GeomItem, p: GeomPatch): Box {
  return itemBox({ ...it, ...p } as GeomItem)
}

/** Moves one endpoint of a line or arrow; the other endpoint stays where it is. */
export function moveEndpoint(it: { x: number, y: number, w: number, h: number }, which: 'start' | 'end', dx: number, dy: number): Required<Pick<GeomPatch, 'x' | 'y' | 'w' | 'h'>> {
  if (which === 'end') return { x: it.x, y: it.y, w: round1(it.w + dx), h: round1(it.h + dy) }
  return { x: round1(it.x + dx), y: round1(it.y + dy), w: round1(it.w - dx), h: round1(it.h - dy) }
}
