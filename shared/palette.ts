// Elements the editor can add. One builder serves both sides: the browser inserts the HTML into the live frame,
// the server writes the identical HTML (same ids) into the source, so preview and saved file cannot drift.

export type PaletteKind = 'heading' | 'text' | 'button' | 'link' | 'image' | 'box' | 'divider' | 'input'
export const PALETTE_KINDS: PaletteKind[] = ['heading', 'text', 'button', 'link', 'image', 'box', 'divider', 'input']

export interface PaletteProps { text?: string, src?: string, href?: string }

/** Tags a new element may be dropped *into* (everything else gets it inserted after). */
export const CONTAINER_TAGS = new Set(['div', 'section', 'main', 'article', 'aside', 'header', 'footer', 'nav', 'form', 'ul', 'ol', 'li', 'body', 'figure', 'fieldset', 'details', 'td', 'th'])

export const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const PLACEHOLDER_IMG = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'320\' height=\'180\'%3E%3Crect width=\'100%25\' height=\'100%25\' fill=\'%23e9e5dc\'/%3E%3C/svg%3E'

/** Only these URL shapes may be written into src/href by the editor. */
export function safeUrl(v: string, attr: 'src' | 'href'): boolean {
  const s = v.trim()
  if (!s || s.length > 2000 || /[\u0000-\u001f]/.test(s)) return false
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|[a-z0-9_.-]+(\/|$))/i.test(s) && !/^[a-z][a-z0-9+.-]*:/i.test(s)) return true // relative
  if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return attr === 'href' || /^https?:\/\//i.test(s)
  if (attr === 'src' && /^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif)[;,]/i.test(s)) return true
  return s.startsWith('#') && attr === 'href'
}

export function paletteHtml(kind: PaletteKind, id: string, props: PaletteProps = {}): string {
  const a = `data-hub-id="${id}"`
  const t = (d: string) => escHtml((props.text ?? d).slice(0, 500))
  switch (kind) {
    case 'heading': return `<h2 ${a} style="margin: 0 0 12px; font-size: 28px; font-weight: 700; line-height: 1.2">${t('Heading')}</h2>`
    case 'text': return `<p ${a} style="margin: 0 0 12px; font-size: 16px; line-height: 1.5">${t('Write something here')}</p>`
    case 'button': return `<button ${a} style="padding: 10px 16px; border: 0; border-radius: 8px; background: #c8553d; color: #ffffff; font: inherit; cursor: pointer">${t('Button')}</button>`
    case 'link': return `<a ${a} href="${escHtml(props.href && safeUrl(props.href, 'href') ? props.href : '#')}" style="color: #2563eb">${t('Link')}</a>`
    case 'image': return `<img ${a} src="${escHtml(props.src && safeUrl(props.src, 'src') ? props.src : PLACEHOLDER_IMG)}" alt="" style="display: block; max-width: 100%; height: auto; min-height: 120px; background: #e9e5dc; border-radius: 6px">`
    case 'divider': return `<hr ${a} style="border: 0; border-top: 1px solid #e4e1da; margin: 16px 0">`
    case 'input': return `<input ${a} placeholder="${t('Text')}" style="padding: 8px 10px; border: 1px solid #d4d0c8; border-radius: 6px; font: inherit; background: #ffffff">`
    case 'box': return `<div ${a} style="display: flex; flex-direction: column; gap: 8px; padding: 16px; border: 1px solid #e4e1da; border-radius: 8px; background: #ffffff">\n<p data-hub-id="${id}-1" style="margin: 0">${t('Box')}</p>\n</div>`
  }
}
