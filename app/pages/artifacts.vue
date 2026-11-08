<script setup lang="ts">
definePageMeta({ layout: 'shell', access: 'member', wide: true })
import { Archive, ArchiveRestore, LayoutGrid, Library, List, MoreHorizontal, Pencil, Pin, Search, Trash2, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
interface Row { id: string, title: string, current_version: number, updated_at: string, pinned: number, opened_at: string | null, opens: number, workspace_id: string, open_comments: number, canvas: boolean, shared: boolean, thumb: { src: string, w: number, h: number } | null }
const { me } = useOwner()
const { list: workspaces, load: loadWorkspaces } = useWorkspaces()
const route = useRoute()
const wsId = computed(() => (typeof route.query.workspace === 'string' ? route.query.workspace : ''))
const showArchived = computed(() => route.query.archived === '1')
const viewQuery = (archived: boolean) => ({ ...route.query, archived: archived ? '1' : undefined })
// One cache entry per workspace filter: switching back renders at once and revalidates quietly.
const { data: rowData, loading, refresh: refreshRows } = useHubData(() => `artifacts:${wsId.value}:${showArchived.value ? 'archived' : 'live'}`, () =>
  $fetch<Row[]>('/api/artifacts', { query: { cards: 1, ...(wsId.value ? { workspace: wsId.value } : {}), ...(showArchived.value ? { archived: 1 } : {}) } }).catch(() => [] as Row[]))
const rows = computed(() => rowData.value ?? [])
// Cards (same card as the Dashboard) are the default; the list stays for long workspaces. The choice is remembered per browser.
const view = ref<'cards' | 'list'>('cards')
onMounted(() => { try { if (localStorage.getItem('hub-artifacts-view') === 'list') view.value = 'list' } catch { /* storage blocked: stay on cards */ } })
function setView(v: unknown) { if (v !== 'cards' && v !== 'list') return; view.value = v; try { localStorage.setItem('hub-artifacts-view', v) } catch { /* ignore */ } }
const origin = computed(() => (import.meta.client ? location.origin : ''))
const ws = computed(() => workspaces.value.find(w => w.id === wsId.value))
const canEdit = computed(() => me.value?.role !== 'commenter')
const wsOf = (id: string) => workspaces.value.find(w => w.id === id)
// Search, filter and sort. The query lives in the URL (?q=); view and sort are remembered per browser.
const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const searchEl = ref<InstanceType<typeof Input> | null>(null)
const qInput = ref(typeof route.query.q === 'string' ? route.query.q : '')
const needle = computed(() => fold(qInput.value.trim()))
let urlTimer: ReturnType<typeof setTimeout> | undefined
watch(qInput, (v) => {
  clearTimeout(urlTimer)
  urlTimer = setTimeout(() => navigateTo({ query: { ...route.query, q: v.trim() || undefined } }, { replace: true }), 250)
})
watch(() => route.query.q, (v) => { const t = typeof v === 'string' ? v : ''; if (t !== qInput.value.trim()) qInput.value = t })
// The server also looks at board titles inside canvases; ids it finds extend the instant client-side title match.
const serverHits = ref<{ q: string, ids: Set<string> }>({ q: '', ids: new Set() })
let hitTimer: ReturnType<typeof setTimeout> | undefined
watch([needle, wsId, showArchived], () => {
  clearTimeout(hitTimer)
  if (!needle.value) { serverHits.value = { q: '', ids: new Set() }; return }
  const q = qInput.value.trim(), key = needle.value
  hitTimer = setTimeout(async () => {
    try {
      const found = await $fetch<{ id: string }[]>('/api/artifacts', { query: { q, ...(wsId.value ? { workspace: wsId.value } : {}), ...(showArchived.value ? { archived: 1 } : {}) } })
      if (key === needle.value) serverHits.value = { q: key, ids: new Set(found.map(r => r.id)) }
    } catch { /* title match still works */ }
  }, 200)
}, { immediate: true })
const searched = computed(() => needle.value ? rows.value.filter(r => fold(r.title).includes(needle.value) || (serverHits.value.q === needle.value && serverHits.value.ids.has(r.id))) : rows.value)
type FilterKey = 'all' | 'comments' | 'shared' | 'canvas'
const filters: { key: FilterKey, label: string, test: (r: Row) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'comments', label: 'Open comments', test: r => r.open_comments > 0 },
  { key: 'shared', label: 'Shared', test: r => !!r.shared },
  { key: 'canvas', label: 'Canvas', test: r => !!r.canvas },
]
const filter = ref<FilterKey>('all')
const counts = computed(() => Object.fromEntries(filters.map(f => [f.key, searched.value.filter(f.test).length])) as Record<FilterKey, number>)
type SortKey = 'updated' | 'name' | 'opens'
const sortLabels: Record<SortKey, string> = { updated: 'Updated', name: 'Name', opens: 'Most opened' }
const sort = ref<SortKey>('updated')
onMounted(() => { try { const v = localStorage.getItem('hub-artifacts-sort'); if (v === 'name' || v === 'opens') sort.value = v } catch { /* default */ } })
function setSort(v: unknown) { if (typeof v !== 'string' || !(v in sortLabels)) return; sort.value = v as SortKey; try { localStorage.setItem('hub-artifacts-sort', v) } catch { /* ignore */ } }
const sorters: Record<SortKey, (a: Row, b: Row) => number> = {
  updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
  name: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }),
  opens: (a, b) => b.opens - a.opens || b.updated_at.localeCompare(a.updated_at),
}
const visible = computed(() => {
  const test = filters.find(f => f.key === filter.value)!.test
  return searched.value.filter(test).sort(sorters[sort.value])
})
const narrowed = computed(() => !!needle.value || filter.value !== 'all')
const groups = computed(() => {
  const all = visible.value
  if (!all.length) return []
  if (showArchived.value) return [{ label: 'Archived', items: all }]
  if (narrowed.value) return [{ label: `${all.length} ${all.length === 1 ? 'result' : 'results'}`, items: all }]
  const pinned = all.filter(r => r.pinned)
  const rest = all.filter(r => !r.pinned)
  return [pinned.length && { label: 'Pinned', items: pinned }, rest.length && { label: pinned.length ? 'Recent' : 'All', items: rest }].filter(Boolean) as { label: string, items: Row[] }[]
})
function clearSearch() { qInput.value = ''; filter.value = 'all'; nextTick(() => (searchEl.value?.$el as HTMLInputElement | undefined)?.focus()) }
function onSlash(e: KeyboardEvent) {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
  const t = e.target as HTMLElement | null
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('[role=dialog],[role=menu],[role=listbox]'))) return
  e.preventDefault()
  ;(searchEl.value?.$el as HTMLInputElement | undefined)?.focus()
}
onMounted(() => window.addEventListener('keydown', onSlash))
onBeforeUnmount(() => { window.removeEventListener('keydown', onSlash); clearTimeout(urlTimer); clearTimeout(hitTimer) })
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
    <NuxtLink :to="{ query: viewQuery(!showArchived) }" class="shrink-0 self-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
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
  <div class="mb-5 grid gap-2.5">
    <div class="relative max-w-2xl">
      <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input ref="searchEl" v-model="qInput" type="search" aria-label="Search artifacts" aria-keyshortcuts="/" autocomplete="off" placeholder="Search artifacts and boards" class="h-11 pl-9 pr-10 text-base [&::-webkit-search-cancel-button]:hidden" @keydown.esc="qInput ? (qInput = '') : ($event.target as HTMLElement).blur()" />
      <Button v-if="qInput" variant="ghost" size="icon" class="absolute right-1 top-1/2 size-8 -translate-y-1/2" aria-label="Clear search" @click="clearSearch"><X /></Button>
      <kbd v-else class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-xs text-muted-foreground max-md:hidden" aria-hidden="true">/</kbd>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2 max-md:grid">
      <ul class="-mx-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden" aria-label="Filter">
        <li v-for="f in filters" :key="f.key" class="shrink-0">
          <Button variant="outline" size="sm" :aria-pressed="filter === f.key" class="h-8 rounded-full px-3 font-medium max-md:h-11 max-md:px-4 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:bg-foreground/90" @click="filter = f.key">
            {{ f.label }}<span class="text-xs tabular-nums opacity-70">{{ counts[f.key] }}</span>
          </Button>
        </li>
      </ul>
      <div class="flex items-center gap-2 max-md:justify-between">
        <Select :model-value="sort" @update:model-value="setSort">
          <SelectTrigger size="sm" class="max-md:h-11 max-md:min-w-40" aria-label="Sort by"><SelectValue>{{ sortLabels[sort] }}</SelectValue></SelectTrigger>
          <SelectContent align="end">
            <SelectItem v-for="(label, key) in sortLabels" :key="key" :value="key">{{ label }}</SelectItem>
          </SelectContent>
        </Select>
        <ToggleGroup type="single" variant="outline" size="sm" :model-value="view" class="shrink-0" aria-label="View" @update:model-value="setView">
          <ToggleGroupItem value="cards" aria-label="Cards" class="max-md:size-11"><LayoutGrid class="size-4" /></ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List" class="max-md:size-11"><List class="size-4" /></ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  </div>
  <BoardSkeleton v-if="loading" :rows="6" />
  <template v-else>
    <p v-if="showArchived && !rows.length" class="px-1 text-sm text-muted-foreground">Nothing archived. Archive an artifact from its menu to tuck it away; its links and comments keep working.</p>
    <p v-else-if="!rows.length && !ws" class="px-1 text-sm text-muted-foreground">Nothing here yet. Connect an MCP client to <code class="rounded bg-muted px-1 py-0.5">{{ origin }}/mcp</code> and ask it to publish something.</p>
    <p v-else-if="!rows.length" class="px-1 text-sm text-muted-foreground">No artifacts in this workspace yet. Move one here from its menu, or ask a connected client to create one in “{{ ws?.name }}”.</p>
    <div v-else-if="rows.length && !visible.length" class="grid justify-items-start gap-3 px-1 text-sm text-muted-foreground" role="status">
      <p v-if="needle">No {{ showArchived ? 'archived ' : '' }}artifacts match “{{ qInput.trim() }}”<template v-if="filter !== 'all'"> with {{ filters.find(f => f.key === filter)?.label.toLowerCase() }}</template>.</p>
      <p v-else>No {{ showArchived ? 'archived ' : '' }}artifacts with {{ filters.find(f => f.key === filter)?.label.toLowerCase() }} here.</p>
      <Button variant="outline" size="sm" @click="clearSearch">{{ needle ? 'Clear search' : 'Show all' }}</Button>
    </div>
    <div class="grid gap-6">
      <Board v-for="g in groups" :key="g.label" :label="g.label">
        <ul v-if="view === 'cards'" class="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 p-3">
          <li v-for="r in g.items" :key="r.id" class="min-w-0">
            <ArtifactCard :artifact="r">
              <template v-if="canEdit" #actions>
              <DropdownMenu v-if="canEdit">
                <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" class="size-7 bg-card/85 backdrop-blur-none hover:bg-accent" :aria-label="`Actions for ${r.title}`"><MoreHorizontal /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem v-if="showArchived" @select="archive(r, false)"><ArchiveRestore />Unarchive</DropdownMenuItem>
                  <DropdownMenuItem v-else @select="archive(r, true)"><Archive />Archive</DropdownMenuItem>
                  <WorkspaceMoveMenu v-if="workspaces.length > 1" :current="r.workspace_id" @move="move(r, $event)" />
                </DropdownMenuContent>
              </DropdownMenu>
              </template>
            </ArtifactCard>
          </li>
        </ul>
        <ul v-else class="divide-y">
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
