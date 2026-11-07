<script setup lang="ts">
// A workspace's colour as a small dot; workspaces without one get a neutral ring that works in light and dark.
defineProps<{ color?: string | null }>()
</script>

<template>
  <span class="inline-block size-2.5 shrink-0 rounded-full border border-foreground/20" :style="color ? { backgroundColor: color, borderColor: color } : undefined" aria-hidden="true" />
</template>
