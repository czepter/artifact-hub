<script setup lang="ts">
import type { Attachment } from '~/types'
import { Paperclip } from '@lucide/vue'

defineProps<{ refId: string, items: Attachment[] }>()

const url = (refId: string, a: Attachment) => `/api/view/${refId}/attachments/${a.id}`
const isImage = (a: Attachment) => /^image\/(png|jpe?g|gif|webp|avif)$/.test(a.mime)
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
</script>

<template>
  <div v-if="items.length" class="att">
    <template v-for="a in items" :key="a.id">
      <a v-if="isImage(a)" :href="url(refId, a)" target="_blank" rel="noopener" class="img" :title="a.name">
        <img :src="url(refId, a)" :alt="a.name" loading="lazy">
      </a>
      <a v-else :href="url(refId, a)" download class="file"><Paperclip class="size-3.5 shrink-0" /><span class="n">{{ a.name }}</span><span class="muted">{{ size(a.size) }}</span></a>
    </template>
  </div>
</template>

<style scoped>
.att { display: grid; gap: 6px; }
.img { display: block; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; background: var(--muted); }
.img img { display: block; max-width: 100%; max-height: 220px; margin: 0 auto; object-fit: contain; }
.file { display: flex; align-items: center; gap: 6px; font-size: 13px; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 5px 8px; text-decoration: none; color: inherit; }
.file:hover { background: var(--muted); }
.n { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.muted { color: var(--muted-foreground); font-size: 12px; }
</style>
