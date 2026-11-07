<script setup lang="ts">
// First-load placeholder in the shape of a Board. Only ever shown when there is nothing cached to display.
withDefaults(defineProps<{ rows?: number }>(), { rows: 4 })
</script>

<template>
  <div role="status" aria-live="polite">
    <span class="sr-only">Loading…</span>
    <div class="mb-1.5 h-3 w-24 animate-pulse rounded bg-muted" aria-hidden="true" />
    <div class="divide-y overflow-hidden rounded-xl border border-foreground/15 bg-card" aria-hidden="true">
      <div v-for="i in rows" :key="i" class="flex items-center justify-between gap-6 px-4 py-3.5">
        <div class="h-3.5 animate-pulse rounded bg-muted" :style="{ width: `${38 + ((i * 17) % 30)}%` }" />
        <div class="h-3 w-16 animate-pulse rounded bg-muted" />
      </div>
    </div>
  </div>
</template>
