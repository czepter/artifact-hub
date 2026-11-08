import type { Bind } from '#shared/canvasOps'
export { dashOf, headOf, radiusOf, strokeOf, widthOf } from '#shared/canvasStyle'

/** A note as the canvas draws it: stored values with the defaults filled in and live drag overrides applied. */
export interface NoteView {
  id: string, kind: string, x: number, y: number, w: number, h: number, text: string, fill: string, color: string, size: string, bold: boolean
  points: number[][], locked: boolean, group?: string
  src?: string, fillStyle?: string, stroke?: string, strokeWidth?: number, strokeStyle?: string, roundness?: string, arrowStart?: string, arrowEnd?: string, bind?: Bind
}

/** Like themeInk, but follows the theme: it updates when the light/dark choice or the system preference changes. */
export function useThemeInk() {
  const ink = ref(themeInk())
  onMounted(() => {
    const update = () => { ink.value = themeInk() }
    update()
    const mo = new MutationObserver(update); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', update)
    onBeforeUnmount(() => { mo.disconnect(); mq.removeEventListener('change', update) })
  })
  return ink
}
/** The theme's ink as a #rrggbb value (for colour inputs that cannot take a CSS variable). */
export function themeInk(): string {
  if (typeof document === 'undefined') return '#1c1b19'
  const el = document.createElement('i'); el.style.color = 'var(--fg)'; document.body.appendChild(el)
  const rgb = getComputedStyle(el).color.match(/\d+/g) ?? ['28', '27', '25']; el.remove()
  return '#' + rgb.slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join('')
}
