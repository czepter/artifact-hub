<script setup lang="ts">
// A live miniature of a page or board: the real file in a sandboxed, non-interactive iframe scaled to the card width.
const props = defineProps<{ src: string, w: number, h: number }>()
const box = ref<HTMLElement>()
const scale = ref(0.2)
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([e]) => { if (e) scale.value = e.contentRect.width / props.w })
  if (box.value) ro.observe(box.value)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <div ref="box" class="relative w-full overflow-hidden border-b bg-muted" :style="{ aspectRatio: `${w} / ${Math.min(h, w * 0.5)}` }" aria-hidden="true">
    <iframe :src="src" :style="{ width: `${w}px`, height: `${h}px`, transform: `scale(${scale})` }" class="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white" sandbox="allow-scripts" loading="lazy" tabindex="-1" title="" />
  </div>
</template>
