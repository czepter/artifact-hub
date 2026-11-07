<script setup lang="ts">
import { Frame, Hand, Lock, MousePointer2, MoveUpRight, Circle, Pencil, Square, StickyNote, Type } from '@lucide/vue'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import type { Tool } from '~/utils/canvasTools'
const props = defineProps<{ tool: Tool, toolLock?: boolean }>()
const emit = defineEmits<{ 'update:tool': [tool: Tool], toolLock: [locked: boolean] }>()
/** Double-click (or Q) keeps a drawing tool active after each shape. */
const lockable = (id: string) => id !== 'select' && id !== 'hand'

const tools = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'hand', label: 'Hand (pan)', key: 'H', icon: Hand },
  { id: 'text', label: 'Text', key: 'T', icon: Type },
  { id: 'artboard', label: 'Board', key: 'A', icon: Frame },
  { id: 'sticky', label: 'Sticky note', key: 'S', icon: StickyNote },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: Square },
  { id: 'oval', label: 'Oval', key: 'O', icon: Circle },
  { id: 'arrow', label: 'Arrow', key: 'L', icon: MoveUpRight },
  { id: 'pen', label: 'Pen', key: 'P', icon: Pencil },
] as const
const value = computed(() => (props.tool === 'line' ? 'arrow' : props.tool))
</script>

<template>
  <ToggleGroup
    type="single"
    :model-value="value"
    class="tb gap-0.5 rounded-xl border bg-card p-1 shadow-lg"
    role="toolbar"
    aria-label="Canvas tools"
    data-ui
    data-toolbar
    @pointerdown.stop
    @click.stop
    @update:model-value="(v) => v && emit('update:tool', v as Tool)"
  >
    <Tooltip v-for="t in tools" :key="t.id">
      <TooltipTrigger as-child>
        <ToggleGroupItem :value="t.id" :aria-label="t.label" size="sm" class="relative size-8 min-w-8 px-0" @click="emit('update:tool', t.id)" @dblclick="lockable(t.id) && emit('toolLock', !toolLock)">
          <component :is="t.icon" class="size-4" />
          <Lock v-if="toolLock && value === t.id" class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary p-px text-primary-foreground" aria-label="Tool locked" />
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent side="top">{{ t.label }} ({{ t.key }}){{ lockable(t.id) ? ' · double-click or Q to keep it' : '' }}</TooltipContent>
    </Tooltip>
  </ToggleGroup>
</template>

<style scoped>
.tb { position: absolute; left: 50%; transform: translateX(-50%); bottom: 14px; z-index: 10; width: fit-content; }
</style>
