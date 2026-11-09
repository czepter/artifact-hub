import { parse, parseFragment } from 'parse5'
import { PALETTE_KINDS, escHtml, paletteHtml, safeUrl, type PaletteKind, type PaletteProps } from '../../shared/palette'

/**
 * Source-level HTML editing for the visual editor.
 *
 * Edits are applied as exact string splices at parse5 source locations, so everything we do not touch stays
 * byte-for-byte as the author (or the model) wrote it. Elements are addressed by `data-hub-id`:
 *  - `annotate()` adds provisional ids (`data-hub-pid="12"`) when a board is served, nothing is stored;
 *  - `ensureIds()` makes them permanent (`data-hub-id="p12"`, same numbering) the first time an edit is committed;
 *  - new elements arrive with client-chosen ids, so the live preview and the saved file agree.
 */

export class EditError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

type PNode = any
interface El {
  name: string
  start: number
  end: number
  startTagEnd: number
  endTagStart: number | null
  attrs: Record<string, { value: string, start: number, end: number }>
  parent: El | null
  inHead: boolean
}

// Not addressable: document furniture and template constructs that never become DOM elements of their own.
const SKIP = new Set(['html', 'head', 'title', 'meta', 'link', 'style', 'script', 'base', 'noscript', 'template', 'helmet', 'x-dc', 'sc-if', 'sc-for', 'dc-import'])
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function walk(source: string): El[] {
  const doc: PNode = parse(source, { sourceCodeLocationInfo: true })
  const out: El[] = []
  const visit = (node: PNode, parent: El | null, inHead: boolean) => {
    for (const child of node.childNodes ?? []) {
      if (!child.tagName) continue
      const loc = child.sourceCodeLocation
      let here = parent
      const headNow = inHead || child.tagName === 'head'
      if (loc?.startTag) {
        const attrs: El['attrs'] = {}
        for (const a of child.attrs) {
          const al = loc.attrs?.[a.name]
          if (al) attrs[a.name] = { value: a.value, start: al.startOffset, end: al.endOffset }
        }
        const el: El = {
          name: child.tagName, start: loc.startOffset, end: loc.endOffset,
          startTagEnd: loc.startTag.endOffset, endTagStart: loc.endTag ? loc.endTag.startOffset : null,
          attrs, parent, inHead: headNow,
        }
        out.push(el)
        here = el
      }
      if (child.tagName !== 'template') visit(child, here, headNow)
    }
  }
  visit(doc, null, false)
  return out
}

const taggable = (e: El) => !e.inHead && !SKIP.has(e.name)

function tagNameLength(source: string, start: number) {
  return /^[^\s/>]+/.exec(source.slice(start + 1, start + 80))?.[0].length ?? 0
}

interface Splice { from: number, to: number, text: string }

function applySplices(source: string, splices: Splice[]): string {
  // Largest offset first so earlier offsets stay valid; ties keep insertion order.
  const sorted = splices.map((s, i) => ({ s, i })).sort((a, b) => b.s.from - a.s.from || b.i - a.i)
  let out = source
  for (const { s } of sorted) out = out.slice(0, s.from) + s.text + out.slice(s.to)
  return out
}

function idSplices(source: string, els: El[], provisional: boolean): Splice[] {
  const splices: Splice[] = []
  let n = 0
  for (const el of els) {
    if (!taggable(el)) continue
    const at = el.start + 1 + tagNameLength(source, el.start)
    let add = ''
    if (!el.attrs['data-hub-id']) {
      const k = n++
      add += provisional ? ` data-hub-pid="${k}"` : ` data-hub-id="p${k}"`
    }
    // Served-only flag: text inside is bound to template holes, so it must not be retyped in place.
    if (provisional && el.endTagStart !== null && source.slice(el.startTagEnd, el.endTagStart).includes('{{')) add += ' data-hub-h'
    if (add) splices.push({ from: at, to: at, text: add })
  }
  return splices
}

/** Served HTML with provisional ids; the stored source is never changed by this. */
export function annotate(source: string): string {
  return applySplices(source, idSplices(source, walk(source), true))
}

/** Makes every addressable element carry a permanent `data-hub-id`. Idempotent. */
export function ensureIds(source: string): string {
  return applySplices(source, idSplices(source, walk(source), false))
}

// ---- operations --------------------------------------------------------------------------------

export type Op =
  | { type: 'style', id: string, set: Record<string, string | null> }
  | { type: 'attr', id: string, name: string, value: string }
  | { type: 'text', id: string, html: string }
  | { type: 'insert', kind: PaletteKind, id: string, props?: PaletteProps, target?: { id: string, position: 'before' | 'after' | 'inside' } }
  | { type: 'delete', id: string }
  | { type: 'duplicate', id: string, idMap: Record<string, string> }
  | { type: 'move', id: string, otherId: string }
  | { type: 'replace', id: string, html: string }
  | { type: 'moveTo', id: string, target: { id: string, position: 'before' | 'after' | 'inside' } }
  /** Wraps sibling elements (and whatever lies between them) in a new <div data-hub-id=id>. `style` is the wrapper's inline style. */
  | { type: 'group', ids: string[], id: string, style?: string }
  /** Replaces a wrapper element by its content. */
  | { type: 'ungroup', id: string }
  /** Any attribute of an element, including ones bound to template data ({{hole}}); null removes it. */
  | { type: 'tattr', id: string, name: string, value: string | null }
  /** Edits the list/as (sc-for) or value (sc-if) of the `level`-th nearest ancestor directive of that kind. */
  | { type: 'directive', id: string, kind: DirectiveKind, level?: number, set: Record<string, string> }
  /** Wraps one element in a new <sc-for> or <sc-if>. */
  | { type: 'wrapDirective', id: string, kind: DirectiveKind, attrs?: Record<string, string> }
  /** Removes an ancestor <sc-for>/<sc-if> but keeps what is inside it. */
  | { type: 'unwrapDirective', id: string, kind: DirectiveKind, level?: number }

export type DirectiveKind = 'sc-for' | 'sc-if'

const STYLE_PROP = /^(--[a-z0-9-]{1,40}|[a-z][a-z0-9-]{0,48})$/
const STYLE_VALUE_BAD = /[;{}<>\\\r\n]/
/** Click-dummy attributes (see shared/protoFlow.ts); values are short action strings or state names, never markup. */
const PROTO_ATTRS = ['data-hub-click', 'data-hub-hover', 'data-hub-press', 'data-hub-focus', 'data-hub-blur', 'data-hub-change', 'data-hub-input', 'data-hub-after', 'data-hub-component', 'data-hub-state', 'data-hub-show', 'data-hub-hide', 'data-hub-modal', 'data-hub-dismiss']
const ATTRS = new Set(['src', 'alt', 'href', 'placeholder', 'title', 'id', 'class', 'aria-label', ...PROTO_ATTRS])
const ATTR_VALUE: Record<string, RegExp> = { id: /^[A-Za-z][\w:.-]{0,63}$/, class: /^[\w\s:./\-\[\]%#]{0,300}$/, 'aria-label': /^[^<>"]{0,200}$/, ...Object.fromEntries(PROTO_ATTRS.map(a => [a, /^[^<>"\r\n]{0,300}$/])) }

function splitDecls(css: string): string[] {
  const out: string[] = []
  let depth = 0, quote = '', cur = ''
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!
    if (quote) { cur += c; if (c === quote && css[i - 1] !== '\\') quote = ''; continue }
    if (c === '"' || c === '\'') { quote = c; cur += c; continue }
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ';' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur)
  return out.map(d => d.trim()).filter(Boolean)
}

// ---- template (code-driven) helpers --------------------------------------------------------------------
// Holes are evaluated by the runtime as dotted paths or literals only, never as code, so they are safe to author here.
const HOLE = /\{\{\s*([^{}<>]{1,120}?)\s*\}\}/g
const holesOk = (s: string) => !s.replace(HOLE, '').match(/\{\{|\}\}/)
const PATH_REF = /^\{\{\s*[A-Za-z_$][\w$]*(\.[\w$]+)*\s*\}\}$/
const IDENT = /^[A-Za-z_$][\w$]{0,40}$/
const DIRECTIVE_ATTRS: Record<DirectiveKind, string[]> = { 'sc-for': ['list', 'as'], 'sc-if': ['value'] }
const GROUPABLE = new Set(['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'span', 'figure'])
const LIST_PARENTS = new Set(['ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'select', 'optgroup', 'datalist', 'menu'])
const hasHole = (s: string) => /\{\{/.test(s)

function checkDirectiveAttr(kind: DirectiveKind, name: string, value: string) {
  if (!DIRECTIVE_ATTRS[kind].includes(name)) throw new EditError(400, `<${kind}> has no attribute ${name}`)
  if (typeof value !== 'string' || value.length > 200) throw new EditError(400, 'Invalid value')
  if (name === 'as') { if (!IDENT.test(value)) throw new EditError(400, 'A loop variable is a plain name, e.g. item'); return }
  if (!PATH_REF.test(value) && !(kind === 'sc-if' && /^(true|false)$/.test(value))) throw new EditError(400, 'Use a data path in braces, e.g. {{items}} or {{user.name}}')
}

function ancestorsOf(el: El, kind: string): El[] {
  const out: El[] = []
  for (let p = el.parent; p; p = p.parent) if (p.name === kind) out.push(p)
  return out
}

/** Inline style text for a new element, checked like the style operation. */
function cleanStyle(style: string): string {
  const decls = splitDecls(style)
  if (decls.length > 40) throw new EditError(400, 'Invalid style')
  for (const d of decls) {
    const i = d.indexOf(':')
    const prop = d.slice(0, i).trim().toLowerCase(), val = d.slice(i + 1).trim()
    if (i < 0 || !STYLE_PROP.test(prop)) throw new EditError(400, `Invalid style property: ${prop}`)
    if (!val || val.length > 300 || STYLE_VALUE_BAD.test(val)) throw new EditError(400, `Invalid value for ${prop}`)
  }
  return decls.join('; ')
}

const escAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** Splice that sets (or with null removes) one attribute on an element. */
function attrSplice(source: string, el: El, name: string, value: string | null): Splice {
  const cur = el.attrs[name]
  if (cur) {
    if (value === null) {
      let from = cur.start
      while (from > 0 && /\s/.test(source[from - 1]!)) from--
      return { from, to: cur.end, text: '' }
    }
    return { from: cur.start, to: cur.end, text: `${name}="${escAttr(value)}"` }
  }
  const at = el.start + 1 + tagNameLength(source, el.start)
  return { from: at, to: at, text: value === null ? '' : ` ${name}="${escAttr(value)}"` }
}

const INLINE_OK = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'a'])

/** Contenteditable output reduced to inline formatting only: no scripts, handlers, ids or layout tags survive. */
export function sanitizeInline(html: string): string {
  if (html.length > 20000) throw new EditError(413, 'Text is too long')
  const frag: PNode = parseFragment(html)
  const render = (nodes: PNode[]): string => nodes.map((n) => {
    if (n.nodeName === '#text') return escHtml(n.value)
    if (!n.tagName) return ''
    if (n.tagName === 'script' || n.tagName === 'style') return ''
    const inner = render(n.childNodes ?? [])
    if (!INLINE_OK.has(n.tagName)) return inner
    if (n.tagName === 'br') return '<br>'
    if (n.tagName === 'a') {
      const href = n.attrs.find((a: PNode) => a.name === 'href')?.value ?? ''
      return safeUrl(href, 'href') ? `<a href="${escAttr(href)}">${inner}</a>` : inner
    }
    return `<${n.tagName}>${inner}</${n.tagName}>`
  }).join('')
  return render(frag.childNodes ?? []).replace(/(<br>)+$/, '')
}

function need(op: { id?: string }, byId: Map<string, El>, field = 'id'): El | null {
  const id = (op as any)[field]
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new EditError(400, `Invalid ${field}`)
  return byId.get(id) ?? null
}

/**
 * Applies operations to one file's source. Returns the new source; unknown ids are skipped and reported
 * (an earlier operation in the batch may have removed the element).
 */
export function applyEdits(source: string, ops: Op[]): { source: string, applied: number, warnings: string[] } {
  if (!Array.isArray(ops) || !ops.length) throw new EditError(400, 'No operations')
  if (ops.length > 200) throw new EditError(413, 'Too many operations in one batch')
  let src = ensureIds(source)
  let applied = 0
  const warnings: string[] = []

  for (const [i, op] of ops.entries()) {
    const els = walk(src)
    const byId = new Map<string, El>()
    for (const e of els) { const id = e.attrs['data-hub-id']?.value; if (id) byId.set(id, e) }
    const skip = (why: string) => { warnings.push(`op ${i + 1} (${op.type}): ${why}`) }
    let splices: Splice[] = []

    switch (op.type) {
      case 'style': {
        const el = need(op, byId)
        if (!el) { skip('element not found'); continue }
        const set = op.set
        if (!set || typeof set !== 'object' || Object.keys(set).length > 40) throw new EditError(400, 'Invalid style set')
        const decls = splitDecls(el.attrs.style?.value ?? '')
        for (const [prop, val] of Object.entries(set)) {
          if (!STYLE_PROP.test(prop)) throw new EditError(400, `Invalid style property: ${prop}`)
          if (val !== null && (typeof val !== 'string' || val.length > 300 || STYLE_VALUE_BAD.test(val))) throw new EditError(400, `Invalid value for ${prop}`)
          const idx = decls.findIndex(d => d.includes(':') && d.slice(0, d.indexOf(':')).trim().toLowerCase() === prop)
          if (val === null || val.trim() === '') { if (idx >= 0) decls.splice(idx, 1) } else if (idx >= 0) decls[idx] = `${prop}: ${val.trim()}`
          else decls.push(`${prop}: ${val.trim()}`)
        }
        splices = [attrSplice(src, el, 'style', decls.length ? decls.join('; ') : null)]
        break
      }
      case 'attr': {
        const el = need(op, byId)
        if (!el) { skip('element not found'); continue }
        if (!ATTRS.has(op.name)) throw new EditError(400, `Attribute not editable: ${op.name}`)
        if (typeof op.value !== 'string' || op.value.length > 2000) throw new EditError(400, 'Invalid attribute value')
        if ((op.name === 'src' || op.name === 'href') && !safeUrl(op.value, op.name)) throw new EditError(400, `Not an allowed ${op.name}`)
        if (ATTR_VALUE[op.name] && op.value !== '' && !ATTR_VALUE[op.name]!.test(op.value)) throw new EditError(400, `Not an allowed ${op.name}`)
        splices = [attrSplice(src, el, op.name, op.value === '' && ATTR_VALUE[op.name] ? null : op.value)]
        break
      }
      case 'text': {
        const el = need(op, byId)
        if (!el) { skip('element not found'); continue }
        if (el.endTagStart === null || VOID.has(el.name)) throw new EditError(422, `<${el.name}> has no editable text`)
        if (typeof op.html !== 'string') throw new EditError(400, 'Invalid text')
        const inner = src.slice(el.startTagEnd, el.endTagStart)
        // Text bound to template data ({{holes}}) is edited as template text: the holes stay, but only when nothing but inline markup is inside.
        if (hasHole(inner) && /<\/?(?!(?:b|strong|i|em|u|br|a)\b)[a-z]/i.test(inner)) throw new EditError(422, 'This element mixes data with other elements; edit its code instead')
        if (hasHole(op.html) && !holesOk(op.html)) throw new EditError(400, 'A data hole is not closed: write {{name}}')
        splices = [{ from: el.startTagEnd, to: el.endTagStart, text: sanitizeInline(op.html) }]
        break
      }
      case 'insert': {
        if (!PALETTE_KINDS.includes(op.kind)) throw new EditError(400, `Unknown element kind: ${op.kind}`)
        if (typeof op.id !== 'string' || !ID_RE.test(op.id) || byId.has(op.id) || byId.has(`${op.id}-1`)) throw new EditError(400, 'Invalid or duplicate id for a new element')
        const props = op.props ?? {}
        if (props.src && !safeUrl(props.src, 'src')) throw new EditError(400, 'Not an allowed src')
        const html = paletteHtml(op.kind, op.id, props)
        let at: number, text: string
        if (op.target) {
          const t = byId.get(op.target.id)
          if (!t) { skip('target not found'); continue }
          const position = VOID.has(t.name) && op.target.position === 'inside' ? 'after' : op.target.position
          if (position === 'before') { at = t.start; text = `${html}\n` }
          else if (position === 'inside' && t.endTagStart !== null) { at = t.endTagStart; text = `${html}\n` }
          else { at = t.end; text = `\n${html}` }
        } else {
          // No selection: append inside the template root (.dc.html boards), else at the end of <body>.
          const root = els.find(e => e.name === 'x-dc' && e.endTagStart !== null)
          const body = els.find(e => e.name === 'body' && e.endTagStart !== null)
          if (root) at = root.endTagStart!
          else if (body) at = body.endTagStart!
          else at = src.length
          text = `${html}\n`
        }
        splices = [{ from: at, to: at, text }]
        break
      }
      case 'delete': {
        const el = need(op, byId)
        if (!el) { skip('element not found'); continue }
        splices = [{ from: el.start, to: el.end, text: '' }]
        break
      }
      case 'duplicate': {
        const el = need(op, byId)
        if (!el) { skip('element not found'); continue }
        const map = op.idMap ?? {}
        const used = new Set(byId.keys())
        let slice = src.slice(el.start, el.end)
        slice = slice.replace(/data-hub-id="([^"]+)"/g, (_m, old: string) => {
          const next = map[old]
          if (typeof next !== 'string' || !ID_RE.test(next) || used.has(next)) throw new EditError(400, `Invalid new id for ${old}`)
          used.add(next)
          return `data-hub-id="${next}"`
        })
        splices = [{ from: el.end, to: el.end, text: `\n${slice}` }]
        break
      }
      case 'move': {
        const a = need(op, byId), b = need(op, byId, 'otherId')
        if (!a || !b) { skip('element not found'); continue }
        if (a.parent !== b.parent || a === b) throw new EditError(422, 'Elements are not siblings')
        const [first, second] = a.start < b.start ? [a, b] : [b, a]
        if (first.end > second.start) throw new EditError(422, 'Elements overlap')
        const between = src.slice(first.end, second.start)
        splices = [{ from: first.start, to: second.end, text: src.slice(second.start, second.end) + between + src.slice(first.start, first.end) }]
        break
      }
      case 'replace': {
        // Code tab: swap one element's whole source for edited markup. Owner-only; size-capped.
        const el = need(op, byId)
        if (!el) { skip('element not found'); continue }
        if (typeof op.html !== 'string' || op.html.length > 200_000) throw new EditError(413, 'Replacement is too large')
        splices = [{ from: el.start, to: el.end, text: op.html }]
        break
      }
      case 'moveTo': {
        const el = need(op, byId)
        if (!el) { skip('element not found'); continue }
        const tid = op.target?.id
        if (typeof tid !== 'string' || !ID_RE.test(tid)) throw new EditError(400, 'Invalid target')
        if (!['before', 'after', 'inside'].includes(op.target.position)) throw new EditError(400, 'Invalid position')
        const t = byId.get(tid)
        if (!t) { skip('target not found'); continue }
        if (t === el || (t.start >= el.start && t.end <= el.end)) throw new EditError(422, 'An element cannot be moved into itself')
        const pos = VOID.has(t.name) && op.target.position === 'inside' ? 'after' : op.target.position
        let at: number
        if (pos === 'before') at = t.start
        else if (pos === 'inside' && t.endTagStart !== null) at = t.endTagStart
        else at = t.end
        if (at >= el.start && at <= el.end) { skip('already in that place'); continue }
        const slice = src.slice(el.start, el.end)
        splices = [{ from: el.start, to: el.end, text: '' }, { from: at, to: at, text: pos === 'after' ? `\n${slice}` : `${slice}\n` }]
        break
      }
      case 'group': {
        if (!Array.isArray(op.ids) || !op.ids.length || op.ids.length > 64) throw new EditError(400, 'Choose between 1 and 64 elements to group')
        if (typeof op.id !== 'string' || !ID_RE.test(op.id) || byId.has(op.id)) throw new EditError(400, 'Invalid or duplicate id for the group')
        const found = op.ids.map(i => (typeof i === 'string' ? byId.get(i) : undefined))
        if (found.some(e => !e)) { skip('an element was not found'); continue }
        let members = found as El[]
        members = members.filter(m => !members.some(o => o !== m && o.start <= m.start && o.end >= m.end))
        const parent = members[0]!.parent
        if (members.some(m => m.parent !== parent)) throw new EditError(422, 'Only elements with the same parent can be grouped')
        if (parent && LIST_PARENTS.has(parent.name)) throw new EditError(422, `Items of a <${parent.name}> cannot be grouped`)
        if (members.some(m => m.inHead || /^(li|tr|td|th|option|dt|dd|thead|tbody|tfoot|caption|col|colgroup)$/.test(m.name))) throw new EditError(422, 'These elements cannot be wrapped in a group')
        members.sort((a, b) => a.start - b.start)
        const first = members[0]!, last = members[members.length - 1]!
        const style = op.style ? cleanStyle(op.style) : ''
        splices = [
          { from: first.start, to: first.start, text: `<div data-hub-id="${op.id}"${style ? ` style="${escAttr(style)}"` : ''}>\n` },
          { from: last.end, to: last.end, text: '\n</div>' },
        ]
        break
      }
      case 'ungroup': {
        const el = need(op, byId)
        if (!el) { skip('element not found'); continue }
        if (el.endTagStart === null || !GROUPABLE.has(el.name)) throw new EditError(422, `<${el.name}> cannot be ungrouped`)
        splices = [{ from: el.start, to: el.startTagEnd, text: '' }, { from: el.endTagStart, to: el.end, text: '' }]
        break
      }
      case 'tattr': {
        const el = need(op, byId)
        if (!el) { skip('element not found'); continue }
        const name = String(op.name ?? '').toLowerCase()
        if (!/^[a-z][\w:.-]{0,60}$/.test(name) || name === 'srcdoc' || name === 'data-hub-id' || name === 'data-hub-pid') throw new EditError(400, `Attribute not editable: ${name}`)
        if (op.value !== null && (typeof op.value !== 'string' || op.value.length > 2000)) throw new EditError(400, 'Invalid attribute value')
        const v = op.value
        if (v !== null) {
          if (hasHole(v) && !holesOk(v)) throw new EditError(400, 'A data hole is not closed: write {{name}}')
          // Event handlers are template functions: only a single reference such as onclick="{{open}}" is allowed, never code.
          if (name.startsWith('on') && !PATH_REF.test(v)) throw new EditError(400, `${name} takes one reference, e.g. {{handler}}`)
          if ((name === 'src' || name === 'href' || name === 'action' || name === 'formaction') && !hasHole(v) && v !== '' && !safeUrl(v, name === 'src' ? 'src' : 'href')) throw new EditError(400, `Not an allowed ${name}`)
          if (name === 'style' && !hasHole(v)) cleanStyle(v)
        }
        splices = [attrSplice(src, el, name, v === '' && name !== 'value' && name !== 'alt' ? null : v)]
        break
      }
      case 'directive': {
        const el = need(op, byId)
        if (!el) { skip('element not found'); continue }
        if (op.kind !== 'sc-for' && op.kind !== 'sc-if') throw new EditError(400, 'Unknown directive')
        const d = ancestorsOf(el, op.kind)[op.level ?? 0]
        if (!d) { skip(`no <${op.kind}> around the element`); continue }
        const entries = Object.entries(op.set ?? {})
        if (!entries.length) throw new EditError(400, 'Nothing to set')
        for (const [k, v] of entries) checkDirectiveAttr(op.kind, k, v)
        splices = entries.map(([k, v]) => attrSplice(src, d, k, v))
        break
      }
      case 'wrapDirective': {
        const el = need(op, byId)
        if (!el) { skip('element not found'); continue }
        if (op.kind !== 'sc-for' && op.kind !== 'sc-if') throw new EditError(400, 'Unknown directive')
        if (el.parent && LIST_PARENTS.has(el.parent.name) && /^(tr|td|th|li|option)$/.test(el.name)) throw new EditError(422, `A <${el.name}> cannot be wrapped here; edit its code instead`)
        const a = op.kind === 'sc-for' ? { list: '{{items}}', as: 'item', ...(op.attrs ?? {}) } : { value: '{{show}}', ...(op.attrs ?? {}) }
        for (const [k, v] of Object.entries(a)) checkDirectiveAttr(op.kind, k, v)
        const open = `<${op.kind} ${Object.entries(a).map(([k, v]) => `${k}="${escAttr(v)}"`).join(' ')}>`
        splices = [{ from: el.start, to: el.start, text: `${open}\n` }, { from: el.end, to: el.end, text: `\n</${op.kind}>` }]
        break
      }
      case 'unwrapDirective': {
        const el = need(op, byId)
        if (!el) { skip('element not found'); continue }
        if (op.kind !== 'sc-for' && op.kind !== 'sc-if') throw new EditError(400, 'Unknown directive')
        const d = ancestorsOf(el, op.kind)[op.level ?? 0]
        if (!d || d.endTagStart === null) { skip(`no <${op.kind}> around the element`); continue }
        splices = [{ from: d.start, to: d.startTagEnd, text: '' }, { from: d.endTagStart, to: d.end, text: '' }]
        break
      }
      default:
        throw new EditError(400, `Unknown operation: ${(op as { type: string }).type}`)
    }
    src = applySplices(src, splices)
    applied++
  }
  if (!applied) throw new EditError(409, `Nothing could be applied: ${warnings.join('; ')}`)
  return { source: src, applied, warnings }
}

/** Source of one element (ids made permanent first, so provisional ids resolve). For the Code tab. */
export function getElementSource(source: string, id: string): { html: string, source: string } | null {
  if (!ID_RE.test(id)) return null
  const withIds = ensureIds(source)
  const el = walk(withIds).find(e => e.attrs['data-hub-id']?.value === id)
  return el ? { html: withIds.slice(el.start, el.end), source: withIds } : null
}

export interface TemplateInfo {
  /** The board is a Design Component (<x-dc>), so holes and directives are live. */
  dc: boolean
  tag: string
  /** Directives around the element, nearest first. `level` counts per kind (0 = the nearest of that kind). */
  directives: { kind: DirectiveKind, level: number, attrs: Record<string, string> }[]
  /** The element's own content when it holds no other elements (text, holes, inline marks), else null. */
  text: { source: string, hasHoles: boolean } | null
  attrs: { name: string, value: string, hole: boolean }[]
  /** Names usable inside {{ }} here: data-props, loop variables. */
  scope: { props: string[], vars: string[] }
}

/** What makes an element "code-driven": loops and conditions around it, holes in its text and attributes. For the Template panel. */
export function getTemplateInfo(source: string, id: string): TemplateInfo | null {
  if (!ID_RE.test(id)) return null
  const withIds = ensureIds(source)
  const els = walk(withIds)
  const el = els.find(e => e.attrs['data-hub-id']?.value === id)
  if (!el) return null
  const counts: Record<string, number> = {}
  const directives: TemplateInfo['directives'] = []
  const vars: string[] = []
  for (let p = el.parent; p; p = p.parent) {
    if (p.name !== 'sc-for' && p.name !== 'sc-if') continue
    const kind = p.name as DirectiveKind
    const attrs: Record<string, string> = {}
    for (const k of DIRECTIVE_ATTRS[kind]) attrs[k] = p.attrs[k]?.value ?? ''
    directives.push({ kind, level: counts[kind] ?? 0, attrs })
    counts[kind] = (counts[kind] ?? 0) + 1
    if (kind === 'sc-for') vars.push(attrs.as || 'item')
  }
  if (vars.length) vars.push('$index', '$first', '$last')
  let props: string[] = []
  const sc = els.find(e => e.name === 'script' && e.attrs['data-props'])
  if (sc) { try { props = Object.keys(JSON.parse(sc.attrs['data-props']!.value)) } catch { /* ignore broken data-props */ } }
  let text: TemplateInfo['text'] = null
  if (el.endTagStart !== null && !VOID.has(el.name)) {
    const inner = withIds.slice(el.startTagEnd, el.endTagStart)
    if (!/<\/?(?!(?:b|strong|i|em|u|br|a)\b)[a-z]/i.test(inner)) text = { source: inner, hasHoles: hasHole(inner) }
  }
  const attrs = Object.entries(el.attrs)
    .filter(([n]) => n !== 'data-hub-id' && n !== 'data-hub-pid')
    .map(([name, a]) => ({ name, value: a.value, hole: hasHole(a.value) }))
  return { dc: els.some(e => e.name === 'x-dc'), tag: el.name, directives, text, attrs, scope: { props, vars } }
}
