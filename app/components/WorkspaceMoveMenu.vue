<script setup lang="ts">
// "Move to workspace" submenu for an artifact; goes inside a DropdownMenuContent.
import { FolderInput } from '@lucide/vue'
import { DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'

defineProps<{ current: string }>()
const emit = defineEmits<{ move: [id: string] }>()
const { list } = useWorkspaces()
</script>

<template>
  <DropdownMenuSub>
    <DropdownMenuSubTrigger><FolderInput />Move to workspace</DropdownMenuSubTrigger>
    <DropdownMenuSubContent class="max-h-72 w-52 overflow-y-auto">
      <DropdownMenuCheckboxItem v-for="w in list" :key="w.id" :model-value="w.id === current" @select="w.id !== current && emit('move', w.id)">
        <WorkspaceDot :color="w.color" /><span class="truncate">{{ w.name }}</span>
      </DropdownMenuCheckboxItem>
    </DropdownMenuSubContent>
  </DropdownMenuSub>
</template>
