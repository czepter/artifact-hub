<script setup lang="ts">
definePageMeta({ layout: 'shell', access: 'member' })
import { Archive, ArchiveRestore, Library, MoreHorizontal, Pencil, Pin, Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
interface Row { id: string, title: string, current_version: number, updated_at: string, pinned: number, opened_at: string | null, opens: number, workspace_id: string }
const { me } = useOwner()
const { list: workspaces, load: loadWorkspaces } = useWorkspaces()
const route = useRoute()
const wsId = computed(() => (typeof route.query.workspace === 'string' ? route.query.workspace : ''))
const showArchived = computed(() => route.query.archived === '1')
const viewQuery = (archived: boolean) => ({ ...route.query, archived: archived ? '1' : undefined })
// One cache entry per workspace filter: switching back renders at once and revalidates quietly.
const { data: rowData, loading, refresh: refreshRows } = useHubData(() => `artifacts:${wsId.value}:${showArchived.value ? 'archived' : 'live'}`, () =>
  $fetch<Row[]>('/api/artifacts', { query: { ...(wsId.value ? { workspace: wsId.value } : {}), ...(showArchived.value ? { archived: 1 } : {}) } }).catch(() => [] as Row[]))
const rows = computed(() => rowData.value ?? [])
const origin = computed(() => (import.meta.client ? location.origin : ''))
const ws = computed(() => workspaces.value.find(w => w.id === wsId.value))
const canEdit = computed(() => me.value?.role !== 'commenter')
const wsOf = (id: string) => workspaces.value.find(w => w.id === id)
const groups = computed(() => {
  const all = rows.value
  const pinned = all.filter(r => r.pinned)
  const rest = all.filter(r => !r.pinned)
  if (showArchived.value) return rest.length || pinned.length ? [{ label: 'Archived', items: all }] : []
  return [pinned.length && { label: 'Pinned', items: pinned }, rest.length && { label: pinned.length ? 'Recent' : 'All', items: rest }].filter(Boolean) as { label: string, items: Row[] }[]
})
onMounted(loadWorkspaces)
useHead({ title: computed(() => `${ws.value?.name ?? 'Artifacts'} · Artifact Hub`) })

async function move(r: Row, workspaceId: string) {
  await $fetch(`/api/artifacts/${r.id}`, { method: 'PATCH', body: { workspaceId } })
  await Promise.all([refreshRows(), loadWorkspaces(), invalidate('dashboard')])
}

async function archive(r: Row, archived: boolean) {
  await $fetch(`/api/artifacts/${r.id}`, { method: 'PATCH', body: { archived } })
  await Promise.all([refreshRows(), invalidate('dashboard')])
}

const editing = ref(false)
const sharedOpen = ref(false)
const deleting = ref(false)
const deleteError = ref('')
async function renamed() { await loadWorkspaces() }
async function removeWs() {
  deleteError.value = ''
  try {
    await $fetch(`/api/workspaces/${wsId.value}`, { method: 'DELETE' })
    deleting.value = false
    await loadWorkspaces()
    await navigateTo('/artifacts')
  } catch (e: any) { deleteError.value = e?.data?.statusMessage ?? 'Could not delete the workspace' }
}
</script>

<template>
  <Teleport defer to="#shell-actions"><NewArtifactActions :workspace="wsId || undefined" /></Teleport>
  <div class="mb-5 flex items-start justify-between gap-3 px-1">
    <div class="min-w-0">
      <h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight"><WorkspaceDot v-if="ws" :color="ws.color" /><span class="truncate">{{ ws?.name ?? 'Artifacts' }}</span></h1>
      <p v-if="ws?.description" class="mt-1 text-sm text-muted-foreground">{{ ws.description }}</p>
    </div>
    <NuxtLink :to="{ query: viewQuery(!showArchived) }" class="ml-auto shrink-0 self-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
      {{ showArchived ? 'Back to artifacts' : 'Archived' }}
    </NuxtLink>
    <DropdownMenu v-if="ws && canEdit">
      <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" class="size-8 shrink-0" aria-label="Workspace actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem @select="editing = true"><Pencil />Edit workspace</DropdownMenuItem>
        <DropdownMenuItem @select="sharedOpen = true"><Library />Shared files…</DropdownMenuItem>
        <template v-if="me?.role === 'owner' && !ws.isDefault">
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" @select="deleteError = ''; deleting = true"><Trash2 />Delete workspace</DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
  <BoardSkeleton v-if="loading" :rows="6" />
  <template v-else>
    <p v-if="showArchived && !rows.length" class="px-1 text-sm text-muted-foreground">Nothing archived. Archive an artifact from its menu to tuck it away; its links and comments keep working.</p>
    <p v-else-if="!rows.length && !ws" class="px-1 text-sm text-muted-foreground">Nothing here yet. Connect an MCP client to <code class="rounded bg-muted px-1 py-0.5">{{ origin }}/mcp</code> and ask it to publish something.</p>
    <p v-else-if="!rows.length" class="px-1 text-sm text-muted-foreground">No artifacts in this workspace yet. Move one here from its menu, or ask a connected client to create one in “{{ ws?.name }}”.</p>
    <div class="grid gap-6">
      <Board v-for="g in groups" :key="g.label" :label="g.label">
        <ul class="divide-y">
          <li v-for="r in g.items" :key="r.id" class="flex items-center">
            <Button as-child variant="ghost" class="h-auto min-w-0 flex-1 justify-between gap-3 rounded-none px-4 py-3 font-normal">
              <NuxtLink :to="`/a/${r.id}`">
                <span class="inline-flex min-w-0 items-center gap-1.5 font-medium"><Pin v-if="r.pinned" class="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" /><span class="truncate">{{ r.title }}</span></span>
                <span class="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                  <span v-if="!ws && wsOf(r.workspace_id)" class="inline-flex items-center gap-1.5 max-md:hidden"><WorkspaceDot :color="wsOf(r.workspace_id)?.color" />{{ wsOf(r.workspace_id)?.name }} ·</span>
                  <span>v{{ r.current_version }} · <time :datetime="r.updated_at" :title="new Date(r.updated_at).toLocaleString()">{{ ago(r.updated_at) }}</time><template v-if="r.opened_at"> · opened {{ ago(r.opened_at) }} · {{ r.opens }} {{ r.opens === 1 ? 'open' : 'opens' }}</template></span>
                </span>
              </NuxtLink>
            </Button>
            <DropdownMenu v-if="canEdit">
              <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" class="mr-2 size-8 shrink-0" :aria-label="`Actions for ${r.title}`"><MoreHorizontal /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem v-if="showArchived" @select="archive(r, false)"><ArchiveRestore />Unarchive</DropdownMenuItem>
                <DropdownMenuItem v-else @select="archive(r, true)"><Archive />Archive</DropdownMenuItem>
                <WorkspaceMoveMenu v-if="workspaces.length > 1" :current="r.workspace_id" @move="move(r, $event)" />
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        </ul>
      </Board>
    </div>
  </template>
  <WorkspaceDialog v-model:open="editing" :workspace="ws" @saved="renamed" />
  <SharedFilesDialog v-if="ws" v-model:open="sharedOpen" :workspace="ws" :can-edit="canEdit" />
  <AlertDialog v-model:open="deleting">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete “{{ ws?.name }}”?</AlertDialogTitle>
        <AlertDialogDescription>A workspace can only be deleted once it is empty. Move its artifacts to another workspace first.</AlertDialogDescription>
      </AlertDialogHeader>
      <Alert v-if="deleteError" variant="destructive" role="alert"><AlertDescription>{{ deleteError }}</AlertDescription></Alert>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction class="bg-destructive text-white hover:bg-destructive/90" @click.prevent="removeWs">Delete workspace</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
