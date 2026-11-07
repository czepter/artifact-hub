<script setup lang="ts">
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'

// Ctrl+K: every canvas action in one searchable list. The Viewer decides which commands exist right now.
export interface PaletteCommand { id: string, label: string, group: string, shortcut?: string, run: () => void }
const props = defineProps<{ commands: PaletteCommand[] }>()
const open = defineModel<boolean>('open', { required: true })
const groups = computed(() => [...new Set(props.commands.map(c => c.group))].map(g => ({ name: g, items: props.commands.filter(c => c.group === g) })))
function run(c: PaletteCommand) { open.value = false; nextTick(c.run) }
</script>

<template>
  <CommandDialog v-model:open="open" title="Command palette" description="Search tools, view and canvas actions">
    <CommandInput placeholder="Type a command…" aria-label="Search commands" />
    <CommandList>
      <CommandEmpty>No matching command.</CommandEmpty>
      <CommandGroup v-for="g in groups" :key="g.name" :heading="g.name">
        <CommandItem v-for="c in g.items" :key="c.id" :value="`${g.name} ${c.label}`" @select="run(c)">
          {{ c.label }}<CommandShortcut v-if="c.shortcut">{{ c.shortcut }}</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
