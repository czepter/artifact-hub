<script setup lang="ts">
import type { Box } from '#shared/canvasGeometry'
import { unionBox } from '#shared/canvasGeometry'
import { Button } from '@/components/ui/button'

// A small map of the whole canvas with the window marked on it. It appears when something is outside the window; click to jump there.
const props = defineProps<{ items: { box: Box, board: boolean }[], view: { tx: number, ty: number, k: number }, size: { w: number, h: number } }>()
const emit = defineEmits<{ jump: [x: number, y: number] }>()

const W = 168, H = 112, PAD = 6
const win = computed<Box>(() => ({ x: -props.view.tx / props.view.k, y: -props.view.ty / props.view.k, w: props.size.w / props.view.k, h: props.size.h / props.view.k }))
const bounds = computed(() => unionBox([...props.items.map(i => i.box), win.value]) ?? win.value)
const s = computed(() => Math.min((W - PAD * 2) / (bounds.value.w || 1), (H - PAD * 2) / (bounds.value.h || 1)))
const ox = computed(() => (W - bounds.value.w * s.value) / 2 - bounds.value.x * s.value)
const oy = computed(() => (H - bounds.value.h * s.value) / 2 - bounds.value.y * s.value)
const rect = (b: Box) => ({ x: b.x * s.value + ox.value, y: b.y * s.value + oy.value, width: Math.max(b.w * s.value, 1.5), height: Math.max(b.h * s.value, 1.5) })

function jump(e: MouseEvent) {
  if (e.detail === 0) return // activated from the keyboard: there is no pointer position to jump to
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  emit('jump', ((e.clientX - r.left) * (W / r.width) - ox.value) / s.value, ((e.clientY - r.top) * (H / r.height) - oy.value) / s.value)
}
</script>

<template>
  <Button variant="outline" class="minimap h-auto rounded-lg bg-card p-0 shadow-md" data-ui data-minimap aria-label="Minimap: click to jump to a place on the canvas" title="Minimap" @click.stop="jump" @pointerdown.stop>
    <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" aria-hidden="true">
      <rect v-for="(it, i) in items" :key="i" v-bind="rect(it.box)" :class="it.board ? 'board' : 'note'" rx="1" />
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
