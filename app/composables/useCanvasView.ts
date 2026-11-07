import type { Box } from '#shared/canvasGeometry'
import { fitView, toWorldPoint, zoomView } from '#shared/canvasGeometry'

/** Pan/zoom state of the canvas: where the world sits on screen, and the moves that change it. */
export function useCanvasView(viewport: Ref<HTMLElement | undefined>, size: { w: number, h: number }) {
  const tx = ref(0), ty = ref(0), k = ref(1)
  const animate = ref(false)
  const get = () => ({ tx: tx.value, ty: ty.value, k: k.value })
  const set = (v: { tx: number, ty: number, k: number }) => { tx.value = v.tx; ty.value = v.ty; k.value = v.k }

  /** Turns on the short slide for the next view change. */
  function pulse() {
    animate.value = true
    setTimeout(() => (animate.value = false), 320)
  }
  /** Fits the boxes in the window; with nothing to show it centres the origin. */
  function fitTo(boxes: Box[], animated = false) {
    if (animated) pulse()
    set(fitView(boxes, size) ?? { tx: size.w / 2, ty: size.h / 2, k: 1 })
  }
  const reset = () => set({ tx: 0, ty: 0, k: 1 })
  function zoomAt(factor: number, cx = size.w / 2, cy = size.h / 2) { set(zoomView(get(), factor, cx, cy)) }
  function centerOn(x: number, y: number) {
    pulse()
    tx.value = size.w / 2 - x * k.value
    ty.value = size.h / 2 - y * k.value
  }
  /** Screen point (client coordinates) to world coordinates. */
  function toWorld(cx: number, cy: number) {
    const r = viewport.value!.getBoundingClientRect()
    return toWorldPoint(get(), cx - r.left, cy - r.top)
  }
  return { tx, ty, k, animate, get, set, pulse, fitTo, reset, zoomAt, centerOn, toWorld }
}
