<script setup lang="ts">
// Header pill: which workspace the artifact list shows. "All" is the unfiltered list.
import { ChevronsUpDown, Plus, Layers } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

defineProps<{ canCreate: boolean }>()
const route = useRoute()
const { list, load } = useWorkspaces()
onMounted(load)
const selectedId = computed(() => (route.path === '/artifacts' && typeof route.query.workspace === 'string' ? route.query.workspace : ''))
const current = computed(() => list.value.find(w => w.id === selectedId.value))
const creating = ref(false)
const go = (id: string) => navigateTo(id ? { path: '/artifacts', query: { workspace: id } } : { path: '/artifacts' })
const total = computed(() => list.value.reduce((n, w) => n + w.artifactCount, 0))
async function created(w: WorkspaceInfo) { await load(); await go(w.id) }
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" class="max-w-44 gap-1.5" aria-label="Switch workspace">
        <WorkspaceDot v-if="current" :color="current.color" /><Layers v-else class="size-3.5" />
        <span class="truncate max-sm:hidden">{{ current?.name ?? 'All workspaces' }}</span>
        <ChevronsUpDown class="size-3.5 opacity-60" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-60">
      <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">Workspaces</DropdownMenuLabel>
      <DropdownMenuItem :class="!selectedId && 'bg-accent'" @select="go('')"><Layers />All workspaces<span class="ml-auto text-xs text-muted-foreground tabular-nums">{{ total }}</span></DropdownMenuItem>
      <DropdownMenuItem v-for="w in list" :key="w.id" :class="w.id === selectedId && 'bg-accent'" @select="go(w.id)">
        <WorkspaceDot :color="w.color" /><span class="truncate">{{ w.name }}</span><span class="ml-auto text-xs text-muted-foreground tabular-nums">{{ w.artifactCount }}</span>
      </DropdownMenuItem>
      <template v-if="canCreate">
        <DropdownMenuSeparator />
        <DropdownMenuItem @select="creating = true"><Plus />New workspace…</DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
  <WorkspaceDialog v-model:open="creating" @saved="created" />
</template>
