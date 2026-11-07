<script setup lang="ts">
import { Pin } from '@lucide/vue'
import { Button } from '@/components/ui/button'
interface Row { id: string, title: string, current_version: number, updated_at: string, pinned: number, opened_at: string | null, opens: number }
const rows = ref<Row[] | null>(null)
const { me, authed, load: loadOwner } = useOwner()
const origin = computed(() => (import.meta.client ? location.origin : ''))
const groups = computed(() => {
  const all = rows.value ?? []
  const pinned = all.filter(r => r.pinned)
  const rest = all.filter(r => !r.pinned)
  return [pinned.length && { label: 'Pinned', items: pinned }, rest.length && { label: pinned.length ? 'Recent' : 'All', items: rest }].filter(Boolean) as { label: string, items: Row[] }[]
})

async function load() {
  await loadOwner()
  if (!authed.value) return navigateTo('/', { external: true })
  rows.value = await $fetch<Row[]>('/api/artifacts').catch(() => [])
}
onMounted(load)
useHead({ title: 'Artifacts · Artifact Hub' })

</script>

<template>
  <AppShell v-if="rows && me" :me="me">
    <template #actions>
      <NewArtifactActions />
    </template>
    <h1 class="mb-5 px-1 text-xl font-semibold tracking-tight">Artifacts</h1>
    <p v-if="!rows.length" class="px-1 text-sm text-muted-foreground">Nothing here yet. Connect an MCP client to <code class="rounded bg-muted px-1 py-0.5">{{ origin }}/mcp</code> and ask it to publish something.</p>
    <div class="grid gap-6">
      <Board v-for="g in groups" :key="g.label" :label="g.label">
        <ul class="divide-y">
          <li v-for="r in g.items" :key="r.id">
            <Button as-child variant="ghost" class="h-auto w-full justify-between gap-3 rounded-none px-4 py-3 font-normal">
              <NuxtLink :to="`/a/${r.id}`">
                <span class="inline-flex min-w-0 items-center gap-1.5 font-medium"><Pin v-if="r.pinned" class="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" /><span class="truncate">{{ r.title }}</span></span>
                <span class="shrink-0 text-xs text-muted-foreground tabular-nums">v{{ r.current_version }} · <time :datetime="r.updated_at" :title="new Date(r.updated_at).toLocaleString()">{{ ago(r.updated_at) }}</time><template v-if="r.opened_at"> · opened {{ ago(r.opened_at) }} · {{ r.opens }} {{ r.opens === 1 ? 'open' : 'opens' }}</template></span>
              </NuxtLink>
            </Button>
          </li>
        </ul>
      </Board>
    </div>
  </AppShell>
</template>
