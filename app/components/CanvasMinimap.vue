<script setup lang="ts">
import type { Box } from '#shared/canvasGeometry'
import { unionBox } from '#shared/canvasGeometry'
import { Button } from '@/components/ui/button'

// A small map of the whole canvas with the window marked on it. It appears when something is outside the window; click to jump there.
const props = defineProps<{ items: { box: Box, board: boolean }[], getView: () => { tx: number, ty: number, k: number }, size: { w: number, h: number } }>()
const emit = defineEmits<{ jump: [x: number, y: number] }>()

const W = 168, H = 112, PAD = 6
const win = computed<Box>(() => { const v = props.getView(); return { x: -v.tx / v.k, y: -v.ty / v.k, w: props.size.w / v.k, h: props.size.h / v.k } })
const bounds = computed(() => unionBox([...props.items.map(i => i.box), win.value]) ?? win.value)
const s = computed(() => Math.min((W - PAD * 2) / (bounds.value.w || 1), (H - PAD * 2) / (bounds.value.h || 1)))
const ox = computed(() => (W - bounds.value.w * s.value) / 2 - bounds.value.x * s.value)
const oy = computed(() => (H - bounds.value.h * s.value) / 2 - bounds.value.y * s.value)
const rect = (b: Box) => ({ x: b.x * s.value + ox.value, y: b.y * s.value + oy.value, width: Math.max(b.w * s.value, 1.5), height: Math.max(b.h * s.value, 1.5) }) // the window only
// Items are two world-space paths under one transformed <g>, so panning touches a single attribute. The min size uses a power-of-two scale step so the strings rebuild only when the zoom doubles.
const sStep = computed(() => 2 ** Math.round(Math.log2(s.value)))
const path = (board: boolean) => props.items.filter(i => i.board === board).map(({ box: b }) => `M${b.x} ${b.y}h${Math.max(b.w, 1.5 / sStep.value)}v${Math.max(b.h, 1.5 / sStep.value)}h${-Math.max(b.w, 1.5 / sStep.value)}z`).join('')
const boardD = computed(() => path(true))
const noteD = computed(() => path(false))

function jump(e: MouseEvent) {
  if (e.detail === 0) { emit('jump', bounds.value.x + bounds.value.w / 2, bounds.value.y + bounds.value.h / 2); return } // from the keyboard: go to the middle of everything
  const r = (e.currentTarget as HTMLElement).querySelector('svg')!.getBoundingClientRect()
  emit('jump', ((e.clientX - r.left) * (W / r.width) - ox.value) / s.value, ((e.clientY - r.top) * (H / r.height) - oy.value) / s.value)
}
</script>

<template>
  <Button variant="outline" class="minimap h-auto rounded-lg bg-card p-0 shadow-md" data-ui data-minimap aria-label="Minimap: click to jump to a place on the canvas" title="Minimap" @click.stop="jump" @pointerdown.stop>
    <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" :style="{ width: W + 'px', height: H + 'px' }" aria-hidden="true">
      <g :transform="`translate(${ox} ${oy}) scale(${s})`">
        <path class="note" :d="noteD" />
        <path class="board" :d="boardD" />
      </g>
      <rect v-bind="rect(win)" class="win" rx="1" />
    </svg>
  </Button>
</template>

<style scoped>
.minimap { position: absolute; right: 12px; bottom: 56px; width: fit-content; }
svg { display: block; }
.board { fill: var(--muted-foreground); opacity: .45; }
.note { fill: var(--muted-foreground); opacity: .3; }
.win { fill: var(--brand); fill-opacity: .12; stroke: var(--brand); stroke-width: 1.5; }
</style>
