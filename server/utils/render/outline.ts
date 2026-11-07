// A board's readable text, in order: what the renderer draws when no browser is available to draw the HTML itself.
import { parse } from 'parse5'
import type { OutlineLine } from '../../../shared/canvasRender'

const SKIP = new Set(['script', 'style', 'head', 'template', 'noscript', 'svg', 'canvas', 'iframe', 'object', 'select', 'option', 'x-dc'])
const SIZES: Record<string, [number, boolean]> = { h1: [32, true], h2: [26, true], h3: [21, true], h4: [18, true], h5: [16, true], h6: [14, true], button: [15, true], th: [15, true], summary: [16, true], blockquote: [17, false] }
const LEAF = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'button', 'a', 'label', 'td', 'th', 'figcaption', 'blockquote', 'summary', 'dt', 'dd', 'pre', 'legend', 'caption'])

type N = { nodeName: string, childNodes?: N[], value?: string, attrs?: { name: string, value: string }[] }
const textOf = (n: N): string => (n.nodeName === '#text' ? n.value ?? '' : SKIP.has(n.nodeName) ? '' : (n.childNodes ?? []).map(textOf).join(' '))
const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 300)

export function htmlOutline(html: string): OutlineLine[] {
  const out: OutlineLine[] = []
  const walk = (n: N) => {
    if (out.length >= 200) return
    if (n.nodeName === '#text') { const t = clean(n.value ?? ''); if (t) out.push({ text: t, size: 16, bold: false }); return }
    if (SKIP.has(n.nodeName)) return
    if (n.nodeName === 'img') { const alt = clean(n.attrs?.find(a => a.name === 'alt')?.value ?? ''); if (alt) out.push({ text: `[image: ${alt}]`, size: 14, bold: false }); return }
    if (LEAF.has(n.nodeName)) {
      const t = clean(textOf(n))
      if (t) { const [size, bold] = SIZES[n.nodeName] ?? [16, false]; out.push({ text: t, size, bold }) }
      return
    }
    for (const c of n.childNodes ?? []) walk(c)
  }
  try { walk(parse(html) as unknown as N) } catch { /* unparsable: no outline */ }
  return out
}
