/**
 * Click-dummy ("prototype") attributes, read from board HTML. The runtime that executes them is server/utils/proto.ts;
 * this module only reads them, to draw the flow between boards and to validate values in the editor.
 *
 * Triggers (value = actions separated by `;`):
 *   data-hub-click   on click          data-hub-after   "<ms> <actions>", once, that long after the board starts playing
 *   data-hub-hover / -press / -focus   held: state changes apply while hovered / pressed / focused and revert afterwards
 *   data-hub-change / -input / -blur   when a control's value changed / on every keystroke / when focus leaves; `{value}` is its value
 *     (checkbox: on|off, radio: its value when selected, select and text: the value)
 * Conditions: an action may end in ` if <tests>` or ` unless <tests>`; tests are joined by `&` and read `<target>:<test>`.
 *   target: `#id`, `@name` (a radio group or named control), a component name, or empty / self (the control that triggered).
 *   tests: filled, empty, checked, unchecked, valid, invalid, `=value`, `!=value` (a component's `=value` asks for that state).
 *   Example: `go:Cart.html if #email:valid & #terms:checked; state:Form=error unless #email:valid`
 * Actions:
 *   go:<board.html>[|transition]     show another board        back                       the board shown before
 *   open:<board.html>                board as an overlay       open:#id                   element with data-hub-modal as an overlay
 *   close                            close the topmost overlay
 *   state:<target>=<state>           set a component state     toggle:<target>=<state>    switch between <state> and the initial state
 *     <target> = a data-hub-component name, #id, or empty / self for the nearest component. `Menu.tab` addresses the facet `tab`:
 *     a component's state is a list of tokens (`data-hub-state="closed tab:profile"`), a plain token is the main state and `facet:value`
 *     tokens are independent ones, so a tab and a dropdown can live in one component.
 * Overlays: data-hub-modal = dialog (default), drawer-right, drawer-left, sheet, popover (under the element that opened it) or free (you style it).
 *   data-hub-dismiss = `outside`, `escape` (both when empty, `none` for neither): closes an overlay or resets a component to its starting state.
 * Transitions: none, fade, slide-left, slide-right, slide-up, slide-down.
 */

export const TRANSITIONS = ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down'] as const
export type Transition = (typeof TRANSITIONS)[number]

export type ProtoAction = (
  | { verb: 'go', target: string, transition: Transition }
  | { verb: 'open', target: string }
  | { verb: 'back' | 'close' }
  | { verb: 'state' | 'toggle', target: string, value: string }
) & { when?: { negate: boolean, tests: string } }

export const TRIGGERS = ['click', 'hover', 'press', 'focus', 'change', 'input', 'blur', 'after'] as const
export type Trigger = (typeof TRIGGERS)[number]
export interface FlowEdge { from: string, to: string, kind: 'go' | 'open' | 'link', trigger: Trigger | 'link' }

const asTransition = (v: string | undefined): Transition => (TRANSITIONS as readonly string[]).includes(v ?? '') ? (v as Transition) : 'fade'

/** Splits an attribute value into actions; unknown or malformed ones are dropped. */
export function parseActions(value: string): ProtoAction[] {
  const out: ProtoAction[] = []
  for (const part of value.split(';')) {
    let s = part.trim()
    if (!s) continue
    const c = /^(.*?)\s+(if|unless)\s+(\S.*)$/s.exec(s)
    const when = c ? { negate: c[2] === 'unless', tests: c[3]!.trim() } : undefined
    if (c) s = c[1]!.trim()
    const n = out.length
    const i = s.indexOf(':')
    const verb = (i < 0 ? s : s.slice(0, i)).trim()
    const rest = i < 0 ? '' : s.slice(i + 1).trim()
    if (verb === 'back' || verb === 'close') out.push({ verb })
    else if (verb === 'go' && rest) { const [t, tr] = rest.split('|'); out.push({ verb, target: t!.trim(), transition: asTransition(tr?.trim()) }) }
    else if (verb === 'open' && rest) out.push({ verb, target: rest })
    else if ((verb === 'state' || verb === 'toggle') && rest.includes('=')) {
      const eq = rest.indexOf('=')
      out.push({ verb, target: rest.slice(0, eq).trim(), value: rest.slice(eq + 1).trim() })
    }
    if (when && out.length > n) out[out.length - 1]!.when = when
  }
  return out
}

/** `data-hub-after` is "<ms> <actions>". */
export function parseAfter(value: string): { ms: number, actions: ProtoAction[] } | null {
  const m = /^\s*(\d{1,6})\s+(.+)$/.exec(value)
  return m ? { ms: Number(m[1]), actions: parseActions(m[2]!) } : null
}

/** Resolves `target` against the folder of the board it was written in; null when it leaves the artifact or is not a local page. */
export function resolveBoardPath(from: string, target: string): string | null {
  const t = target.split('#')[0]!.split('?')[0]!.trim()
  if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//') || t.startsWith('#')) return null
  const stack = t.startsWith('/') ? [] : from.split('/').slice(0, -1)
  for (const seg of t.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { if (!stack.length) return null; stack.pop() } else { try { stack.push(decodeURIComponent(seg)) } catch { return null } }
  }
  return stack.join('/') || null
}

const ATTR = /\b(data-hub-(?:click|hover|press|focus|change|input|blur|after)|data-nav|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const unescapeAttr = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&amp;/g, '&')

/**
 * The links one board makes to other boards of the same canvas. Reads attributes only (nothing is executed); `href`
 * counts only on <a> tags. Edges are unique per from/to/kind/trigger; targets that are not boards are dropped.
 */
export function flowOf(from: string, html: string, boards: ReadonlySet<string>): FlowEdge[] {
  const seen = new Map<string, FlowEdge>()
  const add = (target: string, kind: FlowEdge['kind'], trigger: FlowEdge['trigger']) => {
    const to = resolveBoardPath(from, unescapeAttr(target))
    if (!to || to === from || !boards.has(to)) return
    const key = `${to}|${kind}|${trigger}`
    if (!seen.has(key)) seen.set(key, { from, to, kind, trigger })
  }
  for (const tag of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const name = tag[1]!.toLowerCase(), attrs = tag[2]!
    for (const m of attrs.matchAll(ATTR)) {
      const attr = m[1]!.toLowerCase(), value = unescapeAttr(m[2] ?? m[3] ?? '')
      if (attr === 'href') { if (name === 'a') add(value, 'link', 'link') }
      else if (attr === 'data-nav') add(value, 'link', 'click')
      else {
        const trigger = attr.slice('data-hub-'.length) as Trigger
        const actions = trigger === 'after' ? (parseAfter(value)?.actions ?? []) : parseActions(value)
        for (const a of actions) if (a.verb === 'go' || a.verb === 'open') add(a.target, a.verb, trigger)
      }
    }
  }
  return [...seen.values()]
}

// ---- drawing the flow on the canvas -----------------------------------------------------------------------------------

export interface FlowBox { x: number, y: number, w: number, h: number }
export interface FlowLine {
  from: string
  to: string
  kind: FlowEdge['kind']
  /** Path from the first box's edge to the arrow's base. */
  d: string
  /** Arrowhead triangle, "x,y x,y x,y". */
  head: string
  /** Where a label can sit. */
  mid: { x: number, y: number }
  count: number
}

const RANK: Record<FlowEdge['kind'], number> = { go: 0, open: 1, link: 2 }

/**
 * One curve per pair of boards (the strongest kind wins: go, then open, then link). Two boards that link to each
 * other get two curves side by side. `head` is the arrowhead length in canvas units, so it can stay the same size on screen.
 */
export function flowLines(edges: readonly FlowEdge[], boxes: ReadonlyMap<string, FlowBox>, head = 12): FlowLine[] {
  const pairs = new Map<string, { from: string, to: string, kind: FlowEdge['kind'], count: number }>()
  for (const e of edges) {
    if (!boxes.has(e.from) || !boxes.has(e.to)) continue
    const key = `${e.from}\n${e.to}`, cur = pairs.get(key)
    if (!cur) pairs.set(key, { from: e.from, to: e.to, kind: e.kind, count: 1 })
    else { cur.count++; if (RANK[e.kind] < RANK[cur.kind]) cur.kind = e.kind }
  }
  const out: FlowLine[] = []
  for (const p of pairs.values()) {
    const a = boxes.get(p.from)!, b = boxes.get(p.to)!
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    const dx = bc.x - ac.x, dy = bc.y - ac.y
    const horizontal = Math.abs(dx) / Math.max(1, (a.w + b.w) / 2) >= Math.abs(dy) / Math.max(1, (a.h + b.h) / 2)
    const both = pairs.has(`${p.to}\n${p.from}`)
    const shift = both ? (p.from < p.to ? -10 : 10) : 0
    let s: { x: number, y: number }, t: { x: number, y: number }, c1: { x: number, y: number }, c2: { x: number, y: number }, dir: { x: number, y: number }
    if (horizontal) {
      const sign = dx >= 0 ? 1 : -1
      s = { x: sign > 0 ? a.x + a.w : a.x, y: ac.y + shift }
      t = { x: sign > 0 ? b.x : b.x + b.w, y: bc.y + shift }
      const k = Math.max(40, Math.abs(t.x - s.x) / 2)
      c1 = { x: s.x + sign * k, y: s.y }; c2 = { x: t.x - sign * k, y: t.y }; dir = { x: sign, y: 0 }
    } else {
      const sign = dy >= 0 ? 1 : -1
      s = { x: ac.x + shift, y: sign > 0 ? a.y + a.h : a.y }
      t = { x: bc.x + shift, y: sign > 0 ? b.y : b.y + b.h }
      const k = Math.max(40, Math.abs(t.y - s.y) / 2)
      c1 = { x: s.x, y: s.y + sign * k }; c2 = { x: t.x, y: t.y - sign * k }; dir = { x: 0, y: sign }
    }
    const base = { x: t.x - dir.x * head, y: t.y - dir.y * head }
    const n = { x: -dir.y, y: dir.x }, w = head * 0.45
    const f = (v: number) => Math.round(v * 10) / 10
    out.push({
      from: p.from, to: p.to, kind: p.kind, count: p.count,
      d: `M${f(s.x)},${f(s.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x - dir.x * head)},${f(c2.y - dir.y * head)} ${f(base.x)},${f(base.y)}`,
      head: `${f(t.x)},${f(t.y)} ${f(base.x + n.x * w)},${f(base.y + n.y * w)} ${f(base.x - n.x * w)},${f(base.y - n.y * w)}`,
      mid: { x: f((s.x + t.x) / 2), y: f((s.y + t.y) / 2) },
    })
  }
  return out
}
