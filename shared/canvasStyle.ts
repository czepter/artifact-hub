// Colours and stroke/shape helpers for canvas notes. Pure, so the viewer (app/utils re-exports these) and the
// server-side renderer (shared/canvasRender.ts) draw a note with the same numbers.

export const FILL: Record<string, { bg: string, bd: string }> = {
  yellow: { bg: '#fef3c7', bd: '#fcd34d' }, gray: { bg: '#f1f1f1', bd: '#d4d4d8' }, red: { bg: '#fecaca', bd: '#f87171' }, orange: { bg: '#fed7aa', bd: '#fb923c' },
  green: { bg: '#bbf7d0', bd: '#4ade80' }, teal: { bg: '#99f6e4', bd: '#2dd4bf' }, blue: { bg: '#bfdbfe', bd: '#60a5fa' }, purple: { bg: '#e9d5ff', bd: '#c084fc' },
  pink: { bg: '#fbcfe8', bd: '#f472b6' }, none: { bg: 'transparent', bd: 'transparent' },
}
export const fillOf = (f: string) => FILL[f] ?? (/^#[0-9a-f]{6}$/i.test(f) ? { bg: f, bd: f } : FILL.yellow!)
export const TEXT_PX: Record<string, number> = { s: 14, m: 18, l: 24, xl: 32, xxl: 48 }

/** Stroke colour: the `stroke` field, else the older `color`; without either it follows the theme's ink (`var(--fg)`). */
export const strokeOf = (n: { stroke?: string, color?: string }) => n.stroke ?? (n.color || 'var(--fg)')
export const widthOf = (n: { kind: string, strokeWidth?: number }) => n.strokeWidth ?? (n.kind === 'rect' || n.kind === 'oval' ? 2 : 2.5)
/** svg dash pattern for a stroke style (dots rely on a round linecap). */
export const dashOf = (style: string | undefined, w: number) => (style === 'dashed' ? `${w * 3.5} ${w * 2.5}` : style === 'dotted' ? `0.01 ${w * 2.2}` : undefined)
/** Corner radius of a rectangle: the older default is a small rounding. */
export const radiusOf = (n: { roundness?: string, w: number, h: number }) => (n.roundness === 'sharp' ? 0 : n.roundness === 'round' ? Math.min(24, Math.min(n.w, n.h) * 0.2) : 3)
export const headOf = (n: { kind: string, arrowStart?: string, arrowEnd?: string }, end: 'start' | 'end') => (end === 'start' ? n.arrowStart ?? 'none' : n.arrowEnd ?? (n.kind === 'arrow' ? 'arrow' : 'none'))
