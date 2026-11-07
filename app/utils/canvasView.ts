import type { Bind } from '#shared/canvasOps'

/** A note as the canvas draws it: stored values with the defaults filled in and live drag overrides applied. */
export interface NoteView {
  id: string, kind: string, x: number, y: number, w: number, h: number, text: string, fill: string, color: string, size: string, bold: boolean
  points: number[][], locked: boolean, group?: string
  src?: string, fillStyle?: string, stroke?: string, strokeWidth?: number, strokeStyle?: string, roundness?: string, arrowStart?: string, arrowEnd?: string, bind?: Bind
}

/** Stroke colour: the new `stroke` field, else the older `color`. */
export const strokeOf = (n: Pick<NoteView, 'stroke' | 'color'>) => n.stroke ?? n.color
export const widthOf = (n: Pick<NoteView, 'kind' | 'strokeWidth'>) => n.strokeWidth ?? (n.kind === 'rect' || n.kind === 'oval' ? 2 : 2.5)
/** svg dash pattern for a stroke style (dots rely on a round linecap). */
export const dashOf = (style: string | undefined, w: number) => (style === 'dashed' ? `${w * 3.5} ${w * 2.5}` : style === 'dotted' ? `0.01 ${w * 2.2}` : undefined)
/** Corner radius of a rectangle: the older default is a small rounding. */
export const radiusOf = (n: Pick<NoteView, 'roundness' | 'w' | 'h'>) => (n.roundness === 'sharp' ? 0 : n.roundness === 'round' ? Math.min(24, Math.min(n.w, n.h) * 0.2) : 3)
export const headOf = (n: Pick<NoteView, 'kind' | 'arrowStart' | 'arrowEnd'>, end: 'start' | 'end') => (end === 'start' ? n.arrowStart ?? 'none' : n.arrowEnd ?? (n.kind === 'arrow' ? 'arrow' : 'none'))
