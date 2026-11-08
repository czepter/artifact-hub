<script setup lang="ts">
import { Download, Maximize2, Play, SlidersHorizontal } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { Ref } from 'vue'

// The name row above a board: its title (double-click to rename) and a few actions. It keeps its size on screen at any zoom.
const props = defineProps<{ board: { path: string, title: string, w: number }, k: number, kiNow: () => number, canEdit: boolean, renaming: boolean, drawing: boolean }>()
const emit = defineEmits<{ rename: [], commit: [title: string | null], tweaks: [], export: [], focus: [], play: [] }>()

/** Header buttons keep their press to themselves, unless a drawing tool is active. */
function press(e: PointerEvent) { if (!props.drawing) e.stopPropagation() }
/** Focus and select the rename field once when it appears. */
function focusRename(c: unknown) {
  const el = ((c as { $el?: unknown } | null)?.$el ?? c) as HTMLInputElement | null
  if (el && el.dataset && el.dataset.f !== '1') { el.dataset.f = '1'; nextTick(() => { el.focus(); el.select() }) }
}
/** Open threads on this board, provided by the viewer (absent elsewhere). */
const openThreads = inject<Ref<Record<string, number>> | null>('openThreadsByBoard', null)
const open = computed(() => openThreads?.value[props.board.path] ?? 0)
function done(e: Event, cancel = false) { emit('commit', cancel ? null : (e.target as HTMLInputElement).value.trim()) }
</script>

<template>
  <div class="board-title" data-ki :style="{ '--ki': kiNow(), transform: 'scale(var(--ki))', width: `calc(${board.w}px / var(--ki))` }">
    <Input
      v-if="renaming" :ref="focusRename" class="rename" data-ui :default-value="board.title" aria-label="Board name"
      @keydown.enter="($event.target as HTMLInputElement).blur()" @keydown.esc.stop="done($event, true)" @blur="done($event)" @pointerdown.stop
    />
    <span v-else class="t" :class="{ renamable: canEdit }" @dblclick.stop="emit('rename')">{{ board.title }}</span>
    <Badge v-if="open > 0 && !renaming" variant="secondary" class="count" :title="`${open} open ${open === 1 ? 'thread' : 'threads'}`" :aria-label="`${open} open ${open === 1 ? 'thread' : 'threads'}`">{{ open }}</Badge>
    <span class="acts" data-ui>
      <Button v-if="board.w * k > 150" variant="ghost" size="icon-xs" title="Tweaks" aria-label="Tweaks" @click.stop="emit('tweaks')" @pointerdown="press"><SlidersHorizontal /></Button>
      <Button v-if="board.w * k > 190" variant="ghost" size="icon-xs" title="Download this board" aria-label="Download this board" @click.stop="emit('export')" @pointerdown="press"><Download /></Button>
      <Button class="expand" variant="ghost" size="icon-xs" title="Open full window (F)" aria-label="Open full window" @click.stop="emit('focus')" @pointerdown="press"><Maximize2 /></Button>
      <Button v-if="board.w * k > 130" class="play" variant="secondary" size="xs" title="Play this board" @click.stop="emit('play')" @pointerdown="press"><Play class="size-2.5 fill-current" />PLAY</Button>
    </span>
  </div>
</template>

<style scoped>
.board-title { position: absolute; left: 0; bottom: 100%; padding-bottom: 6px; transform-origin: 0 100%; font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
.rename { flex: 1; min-width: 0; font: inherit; padding: 1px 4px; border: 1px solid var(--brand); border-radius: 3px; background: var(--panel); color: var(--fg); user-select: text; -webkit-user-select: text; }
.count { flex: none; height: 16px; min-width: 16px; padding: 0 4px; justify-content: center; font-size: 11px; line-height: 1; font-variant-numeric: tabular-nums; border-radius: 999px; }
.acts { margin-left: auto; display: flex; gap: 2px; align-items: center; }
</style>
