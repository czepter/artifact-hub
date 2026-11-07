<script setup lang="ts">
// A framed region on the canvas ground with its title above, like a board in the viewer. Flat: only floating layers cast shadows.
defineProps<{ label: string }>()
</script>

<template>
  <section>
    <h2 class="mb-1.5 px-1 text-xs font-medium text-muted-foreground">{{ label }}</h2>
    <div class="overflow-hidden rounded-xl border border-foreground/15 bg-card"><slot /></div>
  </section>
</template>
