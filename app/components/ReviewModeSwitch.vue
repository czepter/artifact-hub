<script setup lang="ts">
import { MessageSquare, MousePointer2, Pencil } from '@lucide/vue'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type ViewerMode = 'view' | 'edit' | 'review'

// One segmented switch for the viewer's three modes. Each item keeps its accessible name; the text label shows from
// 520px up, and the active item is always labeled.
const props = defineProps<{ mode: ViewerMode, canEdit: boolean, editDisabled: boolean, editTitle: string, canReview: boolean }>()
const emit = defineEmits<{ 'update:mode': [mode: ViewerMode] }>()

const items = computed(() => [
  { value: 'view' as const, label: 'View', hint: 'Look and click through', icon: MousePointer2, show: true, disabled: false },
  { value: 'edit' as const, label: 'Edit', hint: props.editTitle, icon: Pencil, show: props.canEdit, disabled: props.editDisabled },
  { value: 'review' as const, label: 'Review', hint: 'Comment on boards and see all threads', icon: MessageSquare, show: props.canReview, disabled: false },
].filter(i => i.show))
</script>

<template>
  <ToggleGroup
    v-if="items.length > 1"
    type="single"
    aria-label="Mode"
    class="modes"
    :model-value="mode"
    @update:model-value="(v) => v && v !== mode && emit('update:mode', v as ViewerMode)"
  >
    <Tooltip v-for="i in items" :key="i.value">
      <TooltipTrigger as-child>
        <ToggleGroupItem :value="i.value" :aria-label="i.label" :disabled="i.disabled" size="sm" class="mode">
          <component :is="i.icon" aria-hidden="true" />
          <span class="mode-l">{{ i.label }}</span>
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent side="bottom">{{ i.hint }}</TooltipContent>
    </Tooltip>
  </ToggleGroup>
</template>

<style scoped>
.modes { padding: 2px; gap: 2px; border-radius: 10px; background: var(--hover); }
.mode { height: 28px; padding: 0 10px; gap: 6px; border-radius: 8px !important; color: var(--muted-foreground); }
.mode:hover:not([data-state='on']) { background: transparent; color: var(--foreground); }
.mode[data-state='on'] { background: var(--panel); color: var(--foreground); box-shadow: 0 0 0 1px var(--line), 0 1px 2px rgb(0 0 0 / .12); }
@media (max-width: 800px) { .mode { height: 40px; min-width: 40px; justify-content: center; } }
@media (max-width: 519px) { .mode-l { display: none; } .mode[data-state='on'] .mode-l { display: inline; } }
</style>
