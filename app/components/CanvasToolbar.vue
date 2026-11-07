<script setup lang="ts">
import { Frame, Hand, MousePointer2, MoveUpRight, Circle, Pencil, Square, StickyNote, Type } from '@lucide/vue'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Tool = 'select' | 'hand' | 'text' | 'artboard' | 'sticky' | 'rect' | 'oval' | 'arrow' | 'line' | 'pen'
const props = defineProps<{ tool: Tool }>()
const emit = defineEmits<{ 'update:tool': [tool: Tool] }>()

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
    @pointerdown.stop
    @click.stop
    @update:model-value="(v) => v && emit('update:tool', v as Tool)"
  >
    <Tooltip v-for="t in tools" :key="t.id">
      <TooltipTrigger as-child>
        <ToggleGroupItem :value="t.id" :aria-label="t.label" size="sm" class="size-8 min-w-8 px-0" @click="emit('update:tool', t.id)">
          <component :is="t.icon" class="size-4" />
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent side="top">{{ t.label }} ({{ t.key }})</TooltipContent>
    </Tooltip>
  </ToggleGroup>
</template>

<style scoped>
.tb { position: absolute; left: 50%; transform: translateX(-50%); bottom: 14px; z-index: 10; width: fit-content; }
</style>
