// Native rendering of a canvas: canvas.json -> a scene (resolved geometry, wrapped text) -> SVG or XML.
// Pure and dependency-free, so it runs on the server and could run in the browser. Everything user-controlled
// (text, titles, ids, colours, numbers) is escaped or validated here; the output has no scripts, no foreignObject
// and no external references, only inline data: images the caller vouched for.
import { arrowPath, noteBox, noteGeometry, penPath, resolveArrow, unionBox, isDirected, type BindTargetBox, type Box } from './canvasGeometry'
import { orderedNoteIds } from './canvasOps'
import { FILL, TEXT_PX, dashOf, fillOf, headOf, radiusOf, strokeOf, widthOf } from './canvasStyle'

// ---- options and environment ---------------------------------------------------------------------------------
export type Theme = 'light' | 'dark'
export interface RenderOptions {
  theme: Theme
  /** `canvas` (the theme's canvas colour), `white`, `transparent` or `#rrggbb`. */
  background: string
  /** Render only this board (its HTML, without the canvas around it). */
  board?: string
  /** Space around the content, in canvas px (ignored for a single board). */
  padding: number
  /** Output scale; only used for the pixel size written on the svg element. */
  scale: number
  /** Size to use for a page artifact (no canvas.json), in px. */
  page: { w: number, h: number }
}
export const DEFAULT_OPTIONS: RenderOptions = { theme: 'light', background: 'canvas', padding: 48, scale: 1, page: { w: 1280, h: 800 } }

/** What the renderer needs from its host. Missing pieces degrade to a placeholder, never to an error. */
export interface RenderEnv {
  /** Width in px of `text` set in the canvas font. */
  measure(text: string, px: number, bold: boolean): number
  /** The bytes of an artifact image (`assets/<hash>.<ext>`) as a data URI, or null if absent or not a real image. */
  image(src: string): string | null
  /** A rendered picture of a board's HTML as a PNG data URI, or null when no browser renderer is available. */
  boardImage?(path: string, size: { w: number, h: number }): string | null
  /** The readable text of a board's HTML (headings, paragraphs, buttons...) used when there is no picture. */
  boardText?(path: string): OutlineLine[] | null
}
export interface OutlineLine { text: string, size: number, bold: boolean }

export class RenderError extends Error { constructor(public status: number, message: string) { super(message) } }

export const THEMES: Record<Theme, { fg: string, muted: string, line: string, canvasBg: string, brand: string }> = {
  light: { fg: '#1e1e1e', muted: '#666666', line: '#e1e1e1', canvasBg: '#e6e6e6', brand: '#0d6fd6' },
  dark: { fg: '#f2f2f2', muted: '#a6a6a6', line: '#424242', canvasBg: '#181818', brand: '#4da3ff' },
}
export const FONT_FAMILY = "'Liberation Sans', Arial, Helvetica, sans-serif"
const LINE_HEIGHT = 1.5

// ---- scene -----------------------------------------------------------------------------------------------------
export interface SceneBoard {
  path: string, title: string, x: number, y: number, w: number, h: number, interactive: boolean
  /** `screenshot`: a picture of the real HTML; `outline`: frame plus the page's text (no browser renderer). */
  render: 'screenshot' | 'outline'
  image?: string
  outline: { text: string, size: number, bold: boolean, y: number }[]
}
export interface SceneNote {
  id: string, kind: string, x: number, y: number, w: number, h: number
  text: string, lines: string[], fontPx: number, bold: boolean, color: string
  fill: string, fillStyle?: string, stroke: string, strokeWidth: number, strokeStyle?: string, roundness?: string
  arrowStart: string, arrowEnd: string, points: number[][], image?: string | null, src?: string, locked: boolean, group?: string
  bind?: { start?: { type: string, id: string }, end?: { type: string, id: string } }
}
export interface Scene {
  title: string, theme: Theme, background: string
  /** The area drawn, in canvas coordinates. */
  view: Box
  boards: SceneBoard[], notes: SceneNote[]
  /** Set when the canvas had nothing to draw. */
  empty: boolean
  /** Board titles are drawn above their boards (a whole canvas, not a single board or page). */
  titles: boolean
}

type Loose = Record<string, any>
const num = (v: unknown, d: number, lo = -100000, hi = 100000) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}
const HEX = /^#[0-9a-f]{6}$/i
const hex = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v : d)

/** Wraps text to `maxW` the way the viewer's `white-space: pre-wrap` does: at spaces, over-long words by character. */
export function wrapText(text: string, maxW: number, px: number, bold: boolean, measure: RenderEnv['measure']): string[] {
  const out: string[] = []
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!para) { out.push(''); continue }
    let line = ''
    for (const tok of para.match(/\S+\s*|\s+/g) ?? []) {
      const fits = (s: string) => measure(s.trimEnd(), px, bold) <= maxW
      if (fits(line + tok)) { line += tok; continue }
      if (line) { out.push(line.trimEnd()); line = '' }
      if (fits(tok)) { line = tok; continue }
      for (const ch of Array.from(tok)) { // a word wider than the box: break it
        if (line && !fits(line + ch)) { out.push(line); line = '' }
        line += ch
      }
    }
    out.push(line.trimEnd())
    if (out.length > 400) break
  }
  return out.slice(0, 400)
}

/** Lays a board's text out as a plain outline: used when the HTML itself cannot be drawn. */
function layoutOutline(lines: OutlineLine[], w: number, h: number, env: RenderEnv) {
  const out: SceneBoard['outline'] = []
  let y = 28
  for (const l of lines) {
    const px = Math.min(48, Math.max(10, l.size)), lh = px * 1.35
    for (const t of wrapText(l.text, Math.max(40, w - 48), px, l.bold, env.measure)) {
      if (y + lh > h - 28) return out
      out.push({ text: t, size: px, bold: l.bold, y: y + px })
      y += lh
    }
    y += px * 0.4
  }
  return out
}

function boardList(canvas: Loose, opts: RenderOptions): { path: string, b: Loose }[] {
  const boards: Record<string, Loose> = canvas.boards && typeof canvas.boards === 'object' ? canvas.boards : {}
  const order: string[] = Array.isArray(canvas.order) ? canvas.order.filter((p: unknown) => typeof p === 'string') : Object.keys(boards)
  const rest = Object.keys(boards).filter(p => !order.includes(p))
  const all = [...order, ...rest].filter((p, i, a) => boards[p] && a.indexOf(p) === i).map(path => ({ path, b: boards[path]! }))
  return opts.board ? all.filter(x => x.path === opts.board) : all
}

/** Resolves a canvas (parsed canvas.json, or null for a single-page artifact) into drawable geometry. */
export function buildScene(canvas: Loose | null, env: RenderEnv, o: Partial<RenderOptions> = {}): Scene {
  const opts: RenderOptions = { ...DEFAULT_OPTIONS, ...o }
  const theme = THEMES[opts.theme]
  const background = opts.background === 'transparent' ? 'transparent' : opts.background === 'white' ? '#ffffff' : HEX.test(opts.background) ? opts.background : theme.canvasBg
  const title = typeof canvas?.title === 'string' ? canvas.title.slice(0, 200) : ''

  // Boards. A page artifact (no canvas.json) is one board called index.html.
  const defs = canvas
    ? boardList(canvas, opts)
    : [{ path: 'index.html', b: { x: 0, y: 0, w: opts.page.w, h: opts.page.h, title: '' } as Loose }]
  if (opts.board && !defs.length) throw new RenderError(404, `No such board: ${opts.board}`)
  const boards: SceneBoard[] = defs.map(({ path, b }) => {
    const w = num(b.w, 800, 1, 8000), h = num(b.h, 600, 1, 8000)
    const img = env.boardImage?.(path, { w, h }) ?? null
    const outline = img ? [] : layoutOutline(env.boardText?.(path) ?? [], w, h, env)
    return { path, title: typeof b.title === 'string' && b.title ? b.title.slice(0, 200) : path, x: num(b.x, 0), y: num(b.y, 0), w, h, interactive: !!b.is_interactive, render: img ? 'screenshot' : 'outline', image: img ?? undefined, outline }
  })

  // Notes: geometry as the viewer computes it, text wrapped to the box, bound arrows resolved against their targets.
  const notes: SceneNote[] = []
  if (canvas && !opts.board) {
    const raw: Loose = canvas.notes && typeof canvas.notes === 'object' ? canvas.notes : {}
    for (const id of orderedNoteIds({ notes: raw, noteOrder: canvas.noteOrder }).slice(0, 1000)) {
      const v = raw[id]
      if (!v || typeof v !== 'object') continue
      const g = noteGeometry({ ...v, x: num(v.x, 0), y: num(v.y, 0), w: v.w === undefined ? undefined : num(v.w, 0, -8000, 8000), h: num(v.h, 0, -8000, 8000), points: Array.isArray(v.points) ? v.points.slice(0, 400).filter((p: unknown) => Array.isArray(p) && p.length === 2).map((p: number[]) => [num(p[0], 0), num(p[1], 0)]) : [] })
      const kind = ['sticky', 'text', 'rect', 'oval', 'line', 'arrow', 'pen', 'image'].includes(g.kind) ? g.kind : 'sticky'
      const text = typeof v.text === 'string' ? v.text.slice(0, 2000) : ''
      const bold = !!v.bold
      const px = kind === 'sticky' ? 13 : (TEXT_PX[v.size as string] ?? 18)
      const fillName = typeof v.fill === 'string' && (v.fill in FILL || HEX.test(v.fill)) ? v.fill : (kind === 'sticky' ? 'yellow' : 'none')
      const color = hex(v.color, '')
      const n: SceneNote = {
        id: String(id).slice(0, 100), kind, x: g.x, y: g.y, w: g.w, h: g.h, text, lines: [], fontPx: px, bold, color,
        fill: fillName, fillStyle: v.fillStyle, stroke: hex(v.stroke, ''), strokeWidth: num(v.strokeWidth, 0, 0, 24) || 0,
        strokeStyle: v.strokeStyle, roundness: v.roundness, arrowStart: v.arrowStart, arrowEnd: v.arrowEnd, points: g.points, locked: !!v.locked,
        group: typeof v.group === 'string' ? v.group.slice(0, 40) : undefined, src: typeof v.src === 'string' ? v.src : undefined,
      } as SceneNote
      if (v.bind && typeof v.bind === 'object') {
        const t = (x: any) => (x && (x.type === 'board' || x.type === 'note') && typeof x.id === 'string' ? { type: x.type as string, id: x.id.slice(0, 100) } : undefined)
        const bs = t(v.bind.start), be = t(v.bind.end)
        if (bs || be) n.bind = { start: bs, end: be }
      }
      if (kind === 'sticky') {
        n.lines = wrapText(text, Math.max(10, n.w - 26), px, bold, env.measure)
        n.h = Math.max(60, n.h || 0, n.lines.length * px * LINE_HEIGHT + 22)
      } else if (kind === 'text') {
        n.lines = wrapText(text, Math.max(10, n.w), px, bold, env.measure)
        n.h = Math.max(px * LINE_HEIGHT, n.lines.length * px * LINE_HEIGHT)
      } else if ((kind === 'rect' || kind === 'oval') && text) {
        n.lines = wrapText(text, Math.max(10, n.w - 12), px, bold, env.measure)
      } else if (kind === 'image') {
        n.image = n.src ? env.image(n.src) : null
      }
      n.w = kind === 'rect' || kind === 'oval' || kind === 'image' ? Math.max(1, Math.abs(n.w)) : n.w
      notes.push(n)
    }
    // Bound arrows end on the edge of their targets.
    const targets = new Map<string, BindTargetBox>()
    for (const b of boards) targets.set('board:' + b.path, { type: 'board', id: b.path, box: { x: b.x, y: b.y, w: b.w, h: b.h }, shape: 'rect' })
    for (const n of notes) if (['rect', 'oval', 'sticky', 'text'].includes(n.kind)) targets.set('note:' + n.id, { type: 'note', id: n.id, box: { x: n.x, y: n.y, w: n.w, h: n.h || noteBox(n).h }, shape: n.kind === 'oval' ? 'oval' : 'rect' })
    for (const n of notes) if (n.bind && isDirected(n.kind)) Object.assign(n, resolveArrow(n, n.bind, t => targets.get(t.type + ':' + t.id) ?? null))
  }

  // The area to draw: one board exactly, or everything with some air (and room for the board titles above boards).
  let view: Box
  let empty = false
  if (opts.board) {
    const b = boards[0]!
    view = { x: b.x, y: b.y, w: b.w, h: b.h }
  } else {
    const showTitles = !!canvas
    const boxes: Box[] = [
      ...boards.map(b => ({ x: b.x, y: b.y - (showTitles ? 26 : 0), w: b.w, h: b.h + (showTitles ? 26 : 0) })),
      ...notes.map((n) => { const b = noteBox(n); const m = n.kind === 'pen' || isDirected(n.kind) ? 14 : 4; return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m } }),
    ]
    const u = unionBox(boxes)
    const pad = canvas ? Math.min(400, Math.max(0, opts.padding)) : 0
    if (u) view = { x: u.x - pad, y: u.y - pad, w: u.w + 2 * pad, h: u.h + 2 * pad }
    else { empty = true; view = { x: 0, y: 0, w: 480, h: 320 } }
  }
  view = { x: view.x, y: view.y, w: Math.max(1, view.w), h: Math.max(1, view.h) }
  return { title, theme: opts.theme, background, view, boards, notes, empty, titles: !!canvas && !opts.board }
}

// ---- escaping and number formatting ----------------------------------------------------------------------------
/** XML 1.0 text: drops characters XML cannot carry (control chars, lone surrogates) and escapes the markup characters. */
export function esc(s: unknown): string {
  return String(s).toWellFormed().replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
const f = (n: number) => String(Math.round((Number.isFinite(n) ? n : 0) * 100) / 100)
const safeId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60)

// ---- svg ---------------------------------------------------------------------------------------------------------
function head(type: string, sw: number, col: string): string {
  switch (type) {
    case 'arrow': return `<polygon points="0,0 -${f(10 + sw * 1.6)},-${f(4 + sw)} -${f(10 + sw * 1.6)},${f(4 + sw)}" fill="${col}"/>`
    case 'triangle': return `<polygon points="0,0 -${f(10 + sw * 1.6)},-${f(4 + sw)} -${f(10 + sw * 1.6)},${f(4 + sw)}" fill="none" stroke="${col}" stroke-width="${f(sw)}" stroke-linejoin="round"/>`
    case 'dot': return `<circle cx="${f(-sw * 1.5)}" cy="0" r="${f(sw * 1.6 + 1)}" fill="${col}"/>`
    case 'bar': return `<line x1="0" y1="${f(-(4 + sw * 1.5))}" x2="0" y2="${f(4 + sw * 1.5)}" stroke="${col}" stroke-width="${f(sw)}" stroke-linecap="round"/>`
    default: return ''
  }
}

/** Text lines as one <text>; `top` is the top of the first line box, `lh` its height. */
function textLines(lines: string[], x: number, top: number, px: number, lh: number, attrs: string, anchor: 'start' | 'middle' = 'start'): string {
  const ascent = 0.905 * px, content = 1.117 * px, baseline = top + (lh - content) / 2 + ascent
  const spans = lines.map((l, i) => `<tspan x="${f(x)}" y="${f(baseline + i * lh)}">${esc(l) || ' '}</tspan>`).join('')
  return `<text font-size="${f(px)}" text-anchor="${anchor}" ${attrs}>${spans}</text>`
}

export function sceneToSvg(scene: Scene, opts: Partial<RenderOptions> = {}): string {
  const theme = THEMES[scene.theme], ink = theme.fg, scale = Math.min(4, Math.max(0.1, opts.scale ?? 1))
  const v = scene.view
  const col = (c: string) => (c === 'var(--fg)' ? ink : HEX.test(c) ? c : ink)
  const out: string[] = []
  const defs: string[] = []
  let uid = 0

  if (scene.background !== 'transparent') out.push(`<rect x="${f(v.x)}" y="${f(v.y)}" width="${f(v.w)}" height="${f(v.h)}" fill="${esc(scene.background)}"/>`)

  const showTitle = scene.titles
  for (const b of scene.boards) {
    const id = `board-${safeId(b.path)}`
    const g: string[] = []
    g.push(`<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" rx="2" fill="#ffffff" stroke="${theme.line}" stroke-width="1"/>`)
    if (b.image) g.push(`<image x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" preserveAspectRatio="none" href="${esc(b.image)}"/>`)
    else {
      const inner = b.outline.map(l => `<text x="24" y="${f(l.y)}" font-size="${f(l.size)}" ${l.bold ? 'font-weight="700" ' : ''}fill="#1e1e1e">${esc(l.text)}</text>`).join('')
      g.push(`<svg x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" overflow="hidden">${inner}<text x="${f(b.w - 12)}" y="${f(b.h - 10)}" font-size="11" text-anchor="end" fill="#9a9a9a">HTML not drawn - text outline only</text></svg>`)
    }
    if (showTitle) g.push(`<text x="${f(b.x)}" y="${f(b.y - 9)}" font-size="13" fill="${theme.muted}">${esc(b.title)}</text>`)
    out.push(`<g id="${id}">${g.join('')}</g>`)
  }

  for (const n of scene.notes) {
    const id = `note-${safeId(n.id)}`
    const stroke = col(n.stroke || n.color || 'var(--fg)'), sw = widthOf({ kind: n.kind, strokeWidth: n.strokeWidth || undefined }), dash = dashOf(n.strokeStyle, sw)
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : ''
    let el = ''
    switch (n.kind) {
      case 'sticky': {
        const c = fillOf(n.fill), lh = n.fontPx * LINE_HEIGHT
        el = `<rect x="${f(n.x)}" y="${f(n.y + 2)}" width="${f(n.w)}" height="${f(n.h)}" rx="3" fill="#000000" opacity="0.07"/>`
          + `<rect x="${f(n.x + 0.5)}" y="${f(n.y + 0.5)}" width="${f(n.w - 1)}" height="${f(n.h - 1)}" rx="3" fill="${c.bg}" stroke="${c.bd}" stroke-width="1"/>`
          + textLines(n.lines, n.x + 13, n.y + 11, n.fontPx, lh, `${n.bold ? 'font-weight="700" ' : ''}fill="#3b2f14"`)
        break
      }
      case 'text': el = textLines(n.lines, n.x, n.y, n.fontPx, n.fontPx * LINE_HEIGHT, `${n.bold ? 'font-weight="700" ' : ''}fill="${col(n.color || 'var(--fg)')}"`); break
      case 'rect': case 'oval': {
        const hatched = (n.fillStyle === 'hatch' || n.fillStyle === 'cross') && n.fill !== 'none'
        let fill = fillOf(n.fill).bg
        if (hatched) {
          const pid = `hatch-${uid++}`, bd = fillOf(n.fill).bd
          defs.push(`<pattern id="${pid}" patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="9" stroke="${bd}" stroke-width="2"/>${n.fillStyle === 'cross' ? `<line x1="0" y1="0" x2="9" y2="0" stroke="${bd}" stroke-width="2"/>` : ''}</pattern>`)
          fill = `url(#${pid})`
        }
        const common = `fill="${fill}" stroke="${stroke}" stroke-width="${f(sw)}"${dashAttr} stroke-linecap="round"`
        el = n.kind === 'rect'
          ? `<rect x="${f(n.x + 1)}" y="${f(n.y + 1)}" width="${f(Math.max(n.w - 2, 1))}" height="${f(Math.max(n.h - 2, 1))}" rx="${f(radiusOf({ roundness: n.roundness, w: n.w, h: n.h }))}" ${common}/>`
          : `<ellipse cx="${f(n.x + n.w / 2)}" cy="${f(n.y + n.h / 2)}" rx="${f(Math.max(n.w / 2 - 1, 1))}" ry="${f(Math.max(n.h / 2 - 1, 1))}" ${common}/>`
        if (n.lines.length) {
          const lh = n.fontPx * LINE_HEIGHT, top = n.y + (n.h - n.lines.length * lh) / 2
          el += textLines(n.lines, n.x + n.w / 2, top, n.fontPx, lh, `${n.bold ? 'font-weight="700" ' : ''}fill="${col(n.color || (n.fill === 'none' ? 'var(--fg)' : '#1c1b19'))}"`, 'middle')
        }
        break
      }
      case 'line': case 'arrow': {
        const x1 = n.x, y1 = n.y, x2 = n.x + n.w, y2 = n.y + n.h, ang = Math.atan2(n.h, n.w)
        el = `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${f(sw)}"${dashAttr} stroke-linecap="round"/>`
        for (const end of ['start', 'end'] as const) {
          const t = headOf({ kind: n.kind, arrowStart: n.arrowStart, arrowEnd: n.arrowEnd }, end)
          if (t === 'none') continue
          const [hx, hy, rot] = end === 'start' ? [x1, y1, ang * 180 / Math.PI + 180] : [x2, y2, ang * 180 / Math.PI]
          el += `<g transform="translate(${f(hx)} ${f(hy)}) rotate(${f(rot)})">${head(t, sw, stroke)}</g>`
        }
        break
      }
      case 'pen': {
        if (n.points.length < 1) break
        const b = noteBox(n)
        el = `<path transform="translate(${f(b.x)} ${f(b.y)})" d="${penPath({ kind: 'pen', x: n.x, y: n.y, w: n.w, h: n.h, points: n.points })}" fill="none" stroke="${stroke}" stroke-width="${f(sw)}"${dashAttr} stroke-linecap="round" stroke-linejoin="round"/>`
        break
      }
      case 'image': {
        if (n.image) el = `<image x="${f(n.x)}" y="${f(n.y)}" width="${f(n.w)}" height="${f(n.h)}" preserveAspectRatio="none" href="${esc(n.image)}"/>`
        else el = `<rect x="${f(n.x)}" y="${f(n.y)}" width="${f(n.w)}" height="${f(n.h)}" fill="${theme.line}" stroke="${theme.muted}" stroke-dasharray="6 4"/><text x="${f(n.x + n.w / 2)}" y="${f(n.y + n.h / 2)}" font-size="12" text-anchor="middle" fill="${theme.muted}">image missing</text>`
        break
      }
    }
    if (el) out.push(`<g id="${id}">${el}</g>`)
  }
  if (scene.empty) out.push(`<text x="${f(v.x + v.w / 2)}" y="${f(v.y + v.h / 2)}" font-size="16" text-anchor="middle" fill="${theme.muted}">Empty canvas</text>`)

  const w = Math.max(1, Math.round(v.w * scale)), h = Math.max(1, Math.round(v.h * scale))
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${f(v.x)} ${f(v.y)} ${f(v.w)} ${f(v.h)}" font-family="${FONT_FAMILY}">`
    + (scene.title ? `<title>${esc(scene.title)}</title>` : '') + (defs.length ? `<defs>${defs.join('')}</defs>` : '') + out.join('\n') + '</svg>\n'
}

// ---- xml ---------------------------------------------------------------------------------------------------------
/**
 * Structured serialization of the same scene, for tools that want to read a canvas rather than look at it.
 *
 *   <scene xmlns="urn:artifact-hub:scene:1" version="1" title theme background x y width height [empty="true"]>
 *     <board path title x y width height interactive render="screenshot|outline">
 *       <outline><line size bold>text</line>…</outline>          only when render="outline"
 *     </board>…                                                   in the viewer's order
 *     <note id kind x y width height [locked] [group] …style attributes>
 *       <text>…</text>                                            sticky, text, and rect/oval labels (the raw text)
 *       <points><p x y/>…</points>                                pen strokes (relative to x,y)
 *       <bind end="start|end" type="board|note" target="…"/>…      arrows attached to a board or note
 *     </note>…                                                    back to front
 *   </scene>
 *
 * Geometry is the drawn geometry (bound arrows already resolved, sticky and text heights measured). Attribute
 * values are plain numbers in canvas px; colours are #rrggbb or one of the named fills (yellow, blue, …).
 */
export function sceneToXml(scene: Scene, meta: { artifact?: string, version?: number } = {}): string {
  const v = scene.view
  const a = (name: string, val: unknown) => (val === undefined || val === null || val === '' || val === false ? '' : ` ${name}="${typeof val === 'number' ? f(val) : esc(val)}"`)
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>']
  out.push(`<scene xmlns="urn:artifact-hub:scene:1" version="1"${a('artifact', meta.artifact)}${a('artifactVersion', meta.version)}${a('title', scene.title)} theme="${scene.theme}" background="${esc(scene.background)}" x="${f(v.x)}" y="${f(v.y)}" width="${f(v.w)}" height="${f(v.h)}"${scene.empty ? ' empty="true"' : ''}>`)
  for (const b of scene.boards) {
    out.push(`  <board path="${esc(b.path)}"${a('title', b.title)} x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" interactive="${b.interactive}" render="${b.render}"${b.outline.length ? '>' : '/>'}`)
    if (b.outline.length) {
      out.push('    <outline>', ...b.outline.map(l => `      <line size="${f(l.size)}"${l.bold ? ' bold="true"' : ''}>${esc(l.text)}</line>`), '    </outline>', '  </board>')
    }
  }
  for (const n of scene.notes) {
    const attrs = `id="${esc(n.id)}" kind="${n.kind}" x="${f(n.x)}" y="${f(n.y)}" width="${f(n.w)}" height="${f(n.h)}"${a('locked', n.locked)}${a('group', n.group)}`
      + (n.kind === 'sticky' || n.kind === 'rect' || n.kind === 'oval' ? a('fill', n.fill) + a('fillStyle', n.fillStyle) : '')
      + (n.kind === 'sticky' || n.kind === 'text' || n.text ? a('size', n.fontPx) + a('bold', n.bold) : '')
      + a('color', n.color) + a('stroke', n.stroke) + a('strokeWidth', n.strokeWidth) + a('strokeStyle', n.strokeStyle) + a('roundness', n.roundness)
      + (isDirected(n.kind) ? a('arrowStart', headOf(n, 'start')) + a('arrowEnd', headOf(n, 'end')) : '') + a('src', n.src)
    const kids: string[] = []
    if (n.text) kids.push(`    <text>${esc(n.text)}</text>`)
    if (n.points.length) kids.push('    <points>', ...n.points.map(p => `      <p x="${f(p[0]!)}" y="${f(p[1]!)}"/>`), '    </points>')
    for (const end of ['start', 'end'] as const) { const t = n.bind?.[end]; if (t) kids.push(`    <bind end="${end}" type="${t.type}" target="${esc(t.id)}"/>`) }
    out.push(kids.length ? `  <note ${attrs}>` : `  <note ${attrs}/>`, ...(kids.length ? [...kids, '  </note>'] : []))
  }
  out.push('</scene>', '')
  return out.join('\n')
}
