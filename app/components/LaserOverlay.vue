<script setup lang="ts">
// A laser pointer for presenting: a trail that follows the pointer and fades. It lives only in this window (nothing is
// sent anywhere). It covers the page, so while it is on the page itself does not receive the pointer.
const el = ref<HTMLCanvasElement>()
const FADE_MS = 900
let pts: { x: number, y: number, t: number }[] = []
let raf = 0
let color = '#e5484d'

function draw() {
  const c = el.value, ctx = c?.getContext('2d')
  if (!c || !ctx) return
  const now = performance.now()
  pts = pts.filter(p => now - p.t < FADE_MS)
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.fillStyle = color
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, life = 1 - (now - b.t) / FADE_MS
    ctx.globalAlpha = Math.max(0, life); ctx.lineWidth = 2 + 6 * life
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
  }
  const last = pts[pts.length - 1]
  if (last) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(last.x, last.y, 6, 0, Math.PI * 2); ctx.fill() }
  raf = pts.length ? requestAnimationFrame(draw) : 0
}
function move(e: PointerEvent) {
  const r = el.value!.getBoundingClientRect()
  pts.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() })
  if (!raf) raf = requestAnimationFrame(draw)
}
function fit() { const c = el.value!, r = c.getBoundingClientRect(); c.width = r.width; c.height = r.height }
let ro: ResizeObserver | undefined
onMounted(() => {
  fit(); ro = new ResizeObserver(fit); ro.observe(el.value!)
  color = getComputedStyle(el.value!).getPropertyValue('--brand').trim() || color
})
onBeforeUnmount(() => { ro?.disconnect(); cancelAnimationFrame(raf) })
</script>

<template>
  <canvas ref="el" class="laser" aria-hidden="true" data-laser @pointermove="move" @pointerdown="move" />
</template>

<style scoped>
.laser { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 5; cursor: crosshair; touch-action: none; }
</style>
