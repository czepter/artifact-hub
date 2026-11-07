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
  /** Items sharing a group id are selected together. */
  group?: string
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

// ---- view transform (pan/zoom) ------------------------------------------------------------------
export interface View { tx: number, ty: number, k: number }
export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 4

/** The view that shows all boxes centred with `pad` px around them, never zoomed in past `maxK`. Null when there are none. */
export function fitView(boxes: Box[], size: { w: number, h: number }, pad = 48, maxK = 1): View | null {
  const u = unionBox(boxes)
  if (!u) return null
  const k = Math.min((size.w - pad * 2) / (u.w || 1), (size.h - pad * 2) / (u.h || 1), maxK)
  return { k, tx: (size.w - u.w * k) / 2 - u.x * k, ty: (size.h - u.h * k) / 2 - u.y * k }
}

/** Zooms by `factor` keeping the screen point (cx, cy) fixed. */
export function zoomView(v: View, factor: number, cx: number, cy: number): View {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor))
  const f = k / v.k
  return { k, tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f }
}

/** Screen point (relative to the canvas element) to world coordinates. */
export const toWorldPoint = (v: View, sx: number, sy: number) => ({ x: (sx - v.tx) / v.k, y: (sy - v.ty) / v.k })

/** Line or arrow inside its own box (svg user space): end points, box size and the angle of the head. */
export function arrowPath(n: { kind: string, x: number, y: number, w: number, h: number }) {
  const b = noteBox(n), x1 = n.x - b.x, y1 = n.y - b.y, x2 = x1 + n.w, y2 = y1 + n.h
  return { x1, y1, x2, y2, bw: Math.max(b.w, 1), bh: Math.max(b.h, 1), ang: Math.atan2(n.h, n.w) }
}

/** Pen stroke as an svg path, relative to the stroke's box. */
export function penPath(n: { kind: string, x: number, y: number, w: number, h: number, points: number[][] }) {
  const b = noteBox(n), ox = n.x - b.x, oy = n.y - b.y
  return n.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]! + ox},${p[1]! + oy}`).join(' ')
}

// ---- note geometry from stored data ---------------------------------------------------------------
/** Position, size and points of a stored note, with the defaults the viewer draws it with. */
export function noteGeometry(v: Record<string, any>) {
  const kind: string = v.kind ?? 'sticky'
  return { kind, x: +v.x || 0, y: +v.y || 0, w: v.w !== undefined ? +v.w : (kind === 'sticky' ? 240 : 360), h: +v.h || 0, points: (Array.isArray(v.points) ? v.points : []) as number[][] }
}

// ---- boxes ----------------------------------------------------------------------------------------
export const normBox = (a: { x: number, y: number }, b: { x: number, y: number }): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
export const boxesIntersect = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

// ---- snapping -------------------------------------------------------------------------------------
export interface Guide { axis: 'x' | 'y', pos: number, from: number, to: number }
const lines = (b: Box, axis: 'x' | 'y') => (axis === 'x' ? [b.x, b.x + b.w / 2, b.x + b.w] : [b.y, b.y + b.h / 2, b.y + b.h])

/** The smallest move that puts one of `mine` on one of `targets`, within `thr`; 0 when nothing is close. */
export function snapLines(mine: number[], targets: number[], thr: number): number {
  let best = 0, bd = thr + 1e-9
  for (const m of mine) for (const t of targets) { const d = t - m; if (Math.abs(d) < Math.abs(bd) || (Math.abs(d) === Math.abs(bd) && best === 0)) { if (Math.abs(d) <= thr) { best = d; bd = d } } }
  return best
}

/**
 * Snaps a moving box to the edges and centres of other boxes. `threshold` is in world px (use px / zoom).
 * Returns the correction to add to the box position, and the guide lines to draw once corrected.
 */
export function snapBox(moving: Box, others: Box[], threshold: number): { dx: number, dy: number, guides: Guide[] } {
  const dx = snapLines(lines(moving, 'x'), others.flatMap(o => lines(o, 'x')), threshold)
  const dy = snapLines(lines(moving, 'y'), others.flatMap(o => lines(o, 'y')), threshold)
  const m: Box = { ...moving, x: moving.x + dx, y: moving.y + dy }
  return { dx, dy, guides: guidesFor(m, others) }
}

/** Guide lines where the box now lines up with another box (edge or centre). */
export function guidesFor(m: Box, others: Box[]): Guide[] {
  const out: Guide[] = []
  const eps = 0.01
  for (const axis of ['x', 'y'] as const) {
    const cross = axis === 'x' ? 'y' : 'x', size = axis === 'x' ? 'h' : 'w'
    for (const mv of lines(m, axis)) {
      for (const o of others) {
        if (!lines(o, axis).some(l => Math.abs(l - mv) < eps)) continue
        const from = Math.min(m[cross], o[cross]), to = Math.max(m[cross] + m[size], o[cross] + o[size])
        if (!out.some(g => g.axis === axis && Math.abs(g.pos - mv) < eps)) out.push({ axis, pos: mv, from, to })
        else { const g = out.find(g => g.axis === axis && Math.abs(g.pos - mv) < eps)!; g.from = Math.min(g.from, from); g.to = Math.max(g.to, to) }
      }
    }
  }
  return out
}

// ---- align and distribute ---------------------------------------------------------------------------
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** Moves unlocked items so their boxes share an edge or centre. Locked items stay, and do not set the target. */
export function alignPatches(items: GeomItem[], mode: AlignMode): Record<string, GeomPatch> {
  const live = items.filter(i => !i.locked)
  if (live.length < 2) return {}
  const boxes = live.map(itemBox)
  const horizontal = mode === 'left' || mode === 'hcenter' || mode === 'right'
  const lo = Math.min(...boxes.map(b => (horizontal ? b.x : b.y))), hi = Math.max(...boxes.map(b => (horizontal ? b.x + b.w : b.y + b.h)))
  const out: Record<string, GeomPatch> = {}
  live.forEach((it, i) => {
    const b = boxes[i]!
    const size = horizontal ? b.w : b.h, start = horizontal ? b.x : b.y
    const target = mode === 'left' || mode === 'top' ? lo : mode === 'right' || mode === 'bottom' ? hi - size : (lo + hi) / 2 - size / 2
    const d = target - start
    if (Math.abs(d) < 0.05) return
    out[it.key] = horizontal ? { x: round1(it.x + d) } : { y: round1(it.y + d) }
  })
  return out
}

/** Spreads three or more unlocked items so the gaps between their boxes are equal; the outer two stay. */
export function distributePatches(items: GeomItem[], axis: 'x' | 'y'): Record<string, GeomPatch> {
  const live = items.filter(i => !i.locked).map(i => ({ it: i, b: itemBox(i) }))
  if (live.length < 3) return {}
  const pos = (b: Box) => (axis === 'x' ? b.x : b.y), size = (b: Box) => (axis === 'x' ? b.w : b.h)
  live.sort((a, b) => pos(a.b) - pos(b.b))
  const first = live[0]!, last = live[live.length - 1]!
  const span = pos(last.b) + size(last.b) - pos(first.b)
  const gap = (span - live.reduce((s, l) => s + size(l.b), 0)) / (live.length - 1)
  const out: Record<string, GeomPatch> = {}
  let cursor = pos(first.b) + size(first.b) + gap
  for (const l of live.slice(1, -1)) {
    const d = cursor - pos(l.b)
    if (Math.abs(d) >= 0.05) out[l.it.key] = axis === 'x' ? { x: round1(l.it.x + d) } : { y: round1(l.it.y + d) }
    cursor += size(l.b) + gap
  }
  return out
}

// ---- constrained drawing ----------------------------------------------------------------------------
/**
 * The shape being drawn from `s` to pointer `c`. Boxes (rect, oval, board): Shift makes a square, Alt draws from the centre.
 * Lines and arrows: Shift snaps the angle to 15 degrees, Alt makes `s` the middle. Lines keep signed extents.
 */
export function constrainCreate(kind: 'box' | 'line', s: { x: number, y: number }, c: { x: number, y: number }, o: { shift?: boolean, alt?: boolean } = {}): Box {
  let dx = c.x - s.x, dy = c.y - s.y
  if (kind === 'box') {
    if (o.shift) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = (dx < 0 ? -m : m); dy = (dy < 0 ? -m : m) }
    if (o.alt) return { x: s.x - Math.abs(dx), y: s.y - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 }
    return { x: Math.min(s.x, s.x + dx), y: Math.min(s.y, s.y + dy), w: Math.abs(dx), h: Math.abs(dy) }
  }
  if (o.shift) {
    const step = Math.PI / 12, a = Math.round(Math.atan2(dy, dx) / step) * step, len = Math.hypot(dx, dy)
    dx = Math.round(len * Math.cos(a) * 1e6) / 1e6; dy = Math.round(len * Math.sin(a) * 1e6) / 1e6
  }
  if (o.alt) return { x: s.x - dx, y: s.y - dy, w: dx * 2, h: dy * 2 }
  return { x: s.x, y: s.y, w: dx, h: dy }
}

// ---- arrow binding ----------------------------------------------------------------------------------
export type BindShape = 'rect' | 'oval'
export interface BindTargetBox { type: 'board' | 'note', id: string, box: Box, shape: BindShape }
const centreOf = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/**
 * Where an arrow end bound to `box` is drawn: on the edge of the box (a rectangle or an ellipse) along the line from
 * the box centre towards `from` (the other end of the arrow), then `gap` px further out.
 */
export function boundEndpoint(from: { x: number, y: number }, box: Box, shape: BindShape, gap = 6): { x: number, y: number } {
  const c = centreOf(box), dx = from.x - c.x, dy = from.y - c.y, len = Math.hypot(dx, dy)
  if (len < 1e-6) return { x: c.x, y: box.y - gap }
  const hw = Math.max(box.w / 2, 1e-6), hh = Math.max(box.h / 2, 1e-6)
  const t = shape === 'oval' ? 1 / Math.hypot(dx / hw, dy / hh) : Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  return { x: round1(c.x + dx * t + (dx / len) * gap), y: round1(c.y + dy * t + (dy / len) * gap) }
}

/**
 * The geometry an arrow is drawn with: each bound end sits on its target, the unbound end stays where it is stored.
 * Moving a target therefore needs no operation: the next render resolves the arrow again.
 */
export function resolveArrow(n: { x: number, y: number, w: number, h: number }, bind: { start?: { type: string, id: string } | null, end?: { type: string, id: string } | null } | undefined, find: (t: { type: string, id: string }) => BindTargetBox | null, gap = 6) {
  if (!bind) return { x: n.x, y: n.y, w: n.w, h: n.h }
  const s0 = { x: n.x, y: n.y }, e0 = { x: n.x + n.w, y: n.y + n.h }
  const st = bind.start ? find(bind.start) : null, et = bind.end ? find(bind.end) : null
  if (!st && !et) return { x: n.x, y: n.y, w: n.w, h: n.h }
  const s = st ? boundEndpoint(et ? centreOf(et.box) : e0, st.box, st.shape, gap) : s0
  const e = et ? boundEndpoint(st ? centreOf(st.box) : s0, et.box, et.shape, gap) : e0
  return { x: s.x, y: s.y, w: round1(e.x - s.x), h: round1(e.y - s.y) }
}

/** The topmost target whose box (grown by `tol`) contains the point; `targets` are listed back to front. */
export function bindTargetAt(p: { x: number, y: number }, targets: BindTargetBox[], tol: number): BindTargetBox | null {
  for (let i = targets.length - 1; i >= 0; i--) {
    const b = targets[i]!.box
    if (p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) return targets[i]!
  }
  return null
}

// ---- hit testing (eraser) ---------------------------------------------------------------------------------
const distToSegment = (p: { x: number, y: number }, a: { x: number, y: number }, b: { x: number, y: number }) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Is the point on this note, within `tol`? Lines and pen strokes are hit near the stroke, other notes anywhere inside. */
export function noteHit(n: { kind: string, x: number, y: number, w: number, h: number, points?: number[][] }, p: { x: number, y: number }, tol: number): boolean {
  if (isDirected(n.kind)) return distToSegment(p, { x: n.x, y: n.y }, { x: n.x + n.w, y: n.y + n.h }) <= tol
  if (n.kind === 'pen') {
    const pts = (n.points ?? []).map(q => ({ x: n.x + q[0]!, y: n.y + q[1]! }))
    if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y) <= tol
    return pts.some((a, i) => i > 0 && distToSegment(p, pts[i - 1]!, a) <= tol)
  }
  const b = noteBox(n)
  return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol
}
