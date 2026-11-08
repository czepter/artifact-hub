<script setup lang="ts">
// One artifact as a card: live preview, title, version and age, and the review state (open threads, canvas, shared link).
// The Dashboard and the Artifacts page use the same card; the Artifacts page adds its actions menu through the slot.
import { MessageSquare, Pin } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

defineProps<{ artifact: { id: string, title: string, current_version: number, updated_at: string, pinned: number | boolean, opened_at: string | null, opens: number, open_comments?: number, canvas?: number | boolean, shared?: number | boolean, thumb?: { src: string, w: number, h: number } | null } }>()
</script>

<template>
  <div class="relative h-full">
    <Button as-child variant="outline" class="h-full w-full flex-col items-stretch justify-between gap-0 overflow-hidden rounded-lg p-0 text-left font-normal whitespace-normal">
      <NuxtLink :to="`/a/${artifact.id}`">
        <Thumb v-if="artifact.thumb" :src="artifact.thumb.src" :w="artifact.thumb.w" :h="artifact.thumb.h" />
        <span class="grid w-full content-start gap-1.5 px-3.5 py-3">
          <span class="flex min-w-0 items-center gap-1.5 pr-8 font-semibold"><Pin v-if="artifact.pinned" class="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" /><span class="truncate">{{ artifact.title }}</span></span>
          <span class="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>v{{ artifact.current_version }}</span><span aria-hidden="true">·</span>
            <time :datetime="artifact.updated_at">{{ ago(artifact.updated_at) }}</time>
            <Badge v-if="artifact.canvas" variant="secondary">canvas</Badge>
            <Badge v-if="artifact.shared" variant="outline">Shared</Badge>
            <Badge v-if="artifact.open_comments" class="ml-auto gap-1"><MessageSquare class="size-3" />{{ artifact.open_comments }}</Badge>
          </span>
          <span class="text-xs text-muted-foreground">{{ artifact.opened_at ? `Opened ${ago(artifact.opened_at)} · ${artifact.opens} ${artifact.opens === 1 ? 'open' : 'opens'}` : 'Not opened yet' }}</span>
        </span>
      </NuxtLink>
    </Button>
    <div v-if="$slots.actions" class="absolute right-1.5 top-1.5"><slot name="actions" /></div>
  </div>
</template>
