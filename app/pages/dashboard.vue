<script setup lang="ts">
definePageMeta({ layout: 'shell' })
import { MessageSquare, Pin } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Recent { thumb: { src: string, w: number, h: number } | null, opened_at: string | null, opens: number, id: string, title: string, current_version: number, updated_at: string, pinned: number, open_comments: number, canvas: number }
interface Waiting { id: string, artifact_id: string, title: string, author_email: string, body: string, last_at: string, replies: number }
interface Dash { recent: Recent[], total: number, waiting: Waiting[], waitingCount: number, openThreads: number, shareLinks: number }
interface Ev { id: number, at: string, actor: string, kind: string, subject: string }
interface Grant { family: string, client: string, last_used: number | null, authorized_at: number | null, member_name: string | null }
interface Overview { artifacts: number, versions: number, fileBytes: number, dataBytes: number, dbBytes: number }
const PHRASE: Record<string, string> = {
  created: 'created', published: 'published', commented: 'commented on', replied: 'replied on', shared: 'shared', unshared: 'removed a share link on',
  authorized: 'approved client', revoked: 'revoked client', invited: 'invited', joined: 'joined', removed: 'removed member',
}

const { me, authed, load: loadOwner } = useOwner()
const dash = ref<Dash | null>(null)
const events = ref<Ev[]>([])
const grants = ref<Grant[]>([])
const overview = ref<Overview | null>(null)
const failed = ref(false)
const isOwner = computed(() => me.value?.role === 'owner')

onMounted(async () => {
  await loadOwner()
  if (!authed.value) return navigateTo('/', { external: true })
  try {
    dash.value = await $fetch<Dash>('/api/dashboard')
  } catch { failed.value = true; return }
  grants.value = await $fetch<Grant[]>('/api/grants').catch(() => [])
  if (isOwner.value) {
    events.value = (await $fetch<Ev[]>('/api/admin/activity').catch(() => [])).slice(0, 5)
    overview.value = await $fetch<Overview>('/api/admin/overview').catch(() => null)
  }
})
const facts = computed(() => {
  if (!dash.value) return ''
  const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`
  return [n(dash.value.total, 'artifact', 'artifacts'), n(dash.value.openThreads, 'open thread', 'open threads'), n(dash.value.shareLinks, 'active share link', 'active share links')].join(' · ')
})
const lastUsed = (s: number | null) => (s ? ago(new Date(s * 1000).toISOString()) : 'never used')
useHead({ title: 'Dashboard · Artifact Hub' })
</script>

<template>
  <p v-if="!me || (!dash && !failed)" class="px-1 text-sm text-muted-foreground" role="status">Loading…</p>
  <template v-else>
    <Teleport defer to="#shell-actions"><NewArtifactActions /></Teleport>
    <div class="mb-5 px-1">
      <h1 class="text-xl font-semibold tracking-tight">Dashboard</h1>
      <p v-if="dash" class="text-sm text-muted-foreground">{{ facts }}</p>
    </div>
    <p v-if="failed" class="err px-1" role="alert">Could not load the dashboard. Reload to try again.</p>
    <div v-else-if="dash" class="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
        <Board label="Recent artifacts">
          <p v-if="!dash.recent.length" class="px-4 py-6 text-sm text-muted-foreground">No artifacts yet. Connect an MCP client and ask it to publish something.</p>
          <ul v-else class="grid gap-3 p-3 sm:grid-cols-2">
            <li v-for="r in dash.recent" :key="r.id" class="min-w-0">
              <Button as-child variant="outline" class="h-full w-full flex-col items-stretch justify-between gap-0 overflow-hidden rounded-lg p-0 text-left font-normal whitespace-normal">
                <NuxtLink :to="`/a/${r.id}`">
                  <Thumb v-if="r.thumb" :src="r.thumb.src" :w="r.thumb.w" :h="r.thumb.h" />
                  <span class="grid w-full gap-1.5 px-3.5 py-3">
                    <span class="flex min-w-0 items-center gap-1.5 font-semibold"><Pin v-if="r.pinned" class="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" /><span class="truncate">{{ r.title }}</span></span>
                    <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>v{{ r.current_version }}</span><span aria-hidden="true">·</span>
                      <time :datetime="r.updated_at">{{ ago(r.updated_at) }}</time>
                      <Badge v-if="r.canvas" variant="secondary">canvas</Badge>
                      <Badge v-if="r.open_comments" class="ml-auto gap-1"><MessageSquare class="size-3" />{{ r.open_comments }}</Badge>
                    </span>
                    <span class="text-xs text-muted-foreground">{{ r.opened_at ? `Opened ${ago(r.opened_at)} · ${r.opens} ${r.opens === 1 ? 'open' : 'opens'}` : 'Not opened yet' }}</span>
                  </span>
                </NuxtLink>
              </Button>
            </li>
          </ul>
          <div v-if="dash.total > dash.recent.length" class="border-t px-4 py-2 text-xs"><NuxtLink to="/artifacts" class="text-muted-foreground hover:text-foreground">All {{ dash.total }} artifacts</NuxtLink></div>
        </Board>
        <Board v-if="isOwner" label="Activity">
          <p v-if="!events.length" class="px-4 py-6 text-sm text-muted-foreground">Nothing has happened yet.</p>
          <ul v-else class="divide-y">
            <li v-for="e in events" :key="e.id" class="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
              <span class="min-w-0 truncate"><span class="font-medium">{{ e.actor }}</span> {{ PHRASE[e.kind] ?? e.kind }} <span class="font-medium">{{ e.subject }}</span></span>
              <time class="shrink-0 text-xs tabular-nums text-muted-foreground" :datetime="e.at">{{ ago(e.at) }}</time>
            </li>
          </ul>
          <div class="border-t px-4 py-2 text-xs"><NuxtLink to="/admin/activity" class="text-muted-foreground hover:text-foreground">Full log</NuxtLink></div>
        </Board>
      </div>
      <div class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
        <Board :label="dash.waitingCount ? `Waiting for a reply (${dash.waitingCount})` : 'Waiting for a reply'">
          <p v-if="!dash.waiting.length" class="px-4 py-6 text-sm text-muted-foreground">Nothing is waiting. New comments from reviewers show up here until someone answers or resolves them.</p>
          <ul v-else class="divide-y">
            <li v-for="t in dash.waiting" :key="t.id">
              <Button as-child variant="ghost" class="h-auto w-full flex-col items-stretch gap-1 rounded-none px-4 py-3 text-left font-normal whitespace-normal">
                <NuxtLink :to="`/a/${t.artifact_id}`" class="flex w-full min-w-0 flex-col items-stretch gap-1">
                  <span class="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                    <span class="min-w-0 truncate"><span class="font-medium text-foreground">{{ t.author_email }}</span> on {{ t.title }}</span>
                    <time class="shrink-0 tabular-nums" :datetime="t.last_at">{{ ago(t.last_at) }}</time>
                  </span>
                  <span class="line-clamp-2 text-sm">{{ t.body }}</span>
                </NuxtLink>
              </Button>
            </li>
          </ul>
        </Board>
        <Board label="Connected clients">
          <p v-if="!grants.length" class="px-4 py-6 text-sm text-muted-foreground">No client is connected yet.</p>
          <ul v-else class="divide-y">
            <li v-for="g in grants.slice(0, 4)" :key="g.family" class="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm">
              <span class="min-w-0 truncate font-medium">{{ g.client }}</span>
              <span class="shrink-0 text-xs text-muted-foreground">{{ lastUsed(g.last_used) }}</span>
            </li>
          </ul>
          <div class="border-t px-4 py-2 text-xs"><NuxtLink :to="isOwner ? '/admin/clients' : '/account'" class="text-muted-foreground hover:text-foreground">Manage</NuxtLink></div>
        </Board>
        <Board v-if="overview" label="Storage">
          <dl class="divide-y text-sm">
            <div class="flex justify-between px-4 py-2.5"><dt class="text-muted-foreground">Files, all versions</dt><dd class="tabular-nums">{{ bytes(overview.fileBytes) }}</dd></div>
            <div class="flex justify-between px-4 py-2.5"><dt class="text-muted-foreground">Shared data</dt><dd class="tabular-nums">{{ bytes(overview.dataBytes) }}</dd></div>
            <div class="flex justify-between px-4 py-2.5"><dt class="text-muted-foreground">Database file</dt><dd class="tabular-nums">{{ bytes(overview.dbBytes) }}</dd></div>
          </dl>
        </Board>
      </div>
    </div>
  </template>
</template>
