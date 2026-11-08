<script setup lang="ts">
definePageMeta({ layout: 'shell', access: 'member' })
import { Check, Copy } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Recent { thumb: { src: string, w: number, h: number } | null, opened_at: string | null, opens: number, id: string, title: string, current_version: number, updated_at: string, pinned: number, open_comments: number, canvas: number, shared: number }
interface Waiting { board: string | null, id: string, artifact_id: string, title: string, author_email: string, body: string, last_at: string, replies: number }
interface Dash { recent: Recent[], total: number, waiting: Waiting[], waitingCount: number, openThreads: number, shareLinks: number }
interface Grant { family: string, client: string, last_used: number | null }
const { me } = useOwner()
const isOwner = computed(() => me.value?.role === 'owner')
// Two independent, cached requests in parallel. The grants only feed the one-line status under the title (owner only).
const { data: dash, loading, error } = useHubData('dashboard', () => $fetch<Dash>('/api/dashboard'))
const { data: grantsData, refresh: refreshGrants } = useHubData('grants', () => $fetch<Grant[]>('/api/grants').catch(() => []), { immediate: isOwner.value })
const failed = computed(() => !!error.value && !dash.value)
const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`
const facts = computed(() => (dash.value ? `${n(dash.value.total, 'artifact', 'artifacts')} · ${dash.value.waitingCount ? `${n(dash.value.waitingCount, 'thread needs', 'threads need')} a reply` : 'nothing waiting for a reply'}` : ''))
// The admin signals the dashboard used to list as boards, reduced to one line that leads to Admin.
const status = computed(() => {
  if (!isOwner.value || !dash.value) return ''
  const last = Math.max(0, ...(grantsData.value ?? []).map(g => g.last_used ?? 0))
  return [dash.value.shareLinks ? `${n(dash.value.shareLinks, 'share link', 'share links')} active` : '', last ? `last client activity ${ago(new Date(last * 1000).toISOString())}` : ''].filter(Boolean).join(', ')
})

// Inbox: threads answered or resolved here leave the list at once; the shared data refreshes behind them.
const gone = ref(new Set<string>())
const shown = computed(() => (dash.value?.waiting ?? []).filter(t => !gone.value.has(t.id)))
const waitingCount = computed(() => Math.max(0, (dash.value?.waitingCount ?? 0) - (dash.value?.waiting ?? []).filter(t => gone.value.has(t.id)).length))
const openId = ref<string | undefined>(undefined) // undefined = the newest thread is expanded; '' = none
const expandedId = computed(() => (openId.value === undefined ? shown.value[0]?.id : openId.value))
const note = ref('')
const noteEl = ref<HTMLElement>()
async function onDone(t: Waiting, kind: 'reply' | 'resolve') {
  gone.value = new Set(gone.value).add(t.id)
  openId.value = undefined
  note.value = kind === 'reply' ? `Reply sent to ${t.author_email}. The thread no longer needs a reply.` : `Thread from ${t.author_email} resolved.`
  await nextTick()
  noteEl.value?.focus()
  try { await invalidate('dashboard', 'comments', 'comment-count') } finally { gone.value = new Set() }
}

// First run: nothing published yet.
const firstRun = computed(() => !!dash.value && dash.value.total === 0)
const endpoint = `${useRequestURL().origin}/mcp`
const prompt = 'Create an artifact on my Artifact Hub: a one-page overview of my project with a title, three sections and a short summary at the top.'
const copied = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | undefined
async function copy(what: 'endpoint' | 'prompt', value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copied.value = what
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = '' }, 2000)
  } catch { copied.value = `${what}-failed` }
}
const connected = computed(() => [...(grantsData.value ?? [])].sort((a, b) => (b.last_used ?? 0) - (a.last_used ?? 0))[0])
const connection = computed(() => {
  const g = connected.value
  if (!g) return 'Waiting for a client to connect…'
  return `Connected: ${g.client}, ${g.last_used ? `used ${ago(new Date(g.last_used * 1000).toISOString())}` : 'not used yet'}`
})
let poll: ReturnType<typeof setInterval> | undefined
const stopPoll = () => { clearInterval(poll); poll = undefined }
watchEffect(() => {
  if (!import.meta.client) return
  stopPoll()
  if (firstRun.value && isOwner.value && !connected.value) poll = setInterval(() => { void refreshGrants() }, 5000)
})
onBeforeUnmount(() => { stopPoll(); clearTimeout(copiedTimer) })
useHead({ title: 'Dashboard · Artifact Hub' })
</script>

<template>
  <Teleport defer to="#shell-actions"><NewArtifactActions /></Teleport>
  <div class="mb-5 px-1">
    <h1 class="text-xl font-semibold tracking-tight">Dashboard</h1>
    <p v-if="dash" class="text-sm text-muted-foreground">
      {{ facts }}<template v-if="status"> · <NuxtLink to="/admin" class="underline underline-offset-2 hover:text-foreground">{{ status }}</NuxtLink></template>
    </p>
  </div>
  <p v-if="failed" class="err px-1" role="alert">Could not load the dashboard. Reload to try again.</p>
  <div v-else-if="dash" class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
    <Board v-if="firstRun" label="Publish your first artifact">
      <div class="grid md:grid-cols-2">
        <section class="grid min-w-0 content-start gap-2.5 p-4">
          <h3 class="text-base font-semibold"><span class="mr-2 inline-grid size-[22px] place-items-center rounded-full border text-xs font-medium text-muted-foreground">1</span>Connect your chat model</h3>
          <p class="max-w-[56ch] text-sm text-muted-foreground">Add this address as an MCP server in Claude Desktop, Claude Code or another MCP client, then approve it when the consent screen opens.</p>
          <div class="flex gap-2">
            <Input :model-value="endpoint" readonly aria-label="MCP endpoint" class="flex-1 font-mono" @focus="($event.target as HTMLInputElement).select()" />
            <Button variant="outline" @click="copy('endpoint', endpoint)"><component :is="copied === 'endpoint' ? Check : Copy" />{{ copied === 'endpoint' ? 'Copied' : 'Copy' }}</Button>
          </div>
          <p v-if="isOwner" class="text-xs text-muted-foreground" role="status" aria-live="polite"><span class="tabular-nums">{{ connection }}</span></p>
        </section>
        <section class="grid min-w-0 content-start gap-2.5 border-t p-4 md:border-t-0 md:border-l">
          <h3 class="text-base font-semibold"><span class="mr-2 inline-grid size-[22px] place-items-center rounded-full border text-xs font-medium text-muted-foreground">2</span>Ask it to publish</h3>
          <p class="max-w-[56ch] text-sm text-muted-foreground">Send this to the connected client. Change the topic to whatever you need.</p>
          <div class="relative rounded-lg border bg-muted/50 py-3 pr-12 pl-3 text-sm leading-relaxed">
            {{ prompt }}
            <Button variant="ghost" size="icon-sm" class="absolute top-1.5 right-1.5" :aria-label="copied === 'prompt' ? 'Prompt copied' : 'Copy prompt'" @click="copy('prompt', prompt)"><component :is="copied === 'prompt' ? Check : Copy" /></Button>
          </div>
          <p v-if="copied.endsWith('-failed')" class="err" role="alert">Copying is blocked in this browser. Select the text and copy it by hand.</p>
        </section>
      </div>
      <p class="border-t px-4 py-2.5 text-xs text-muted-foreground">Prefer to start by hand? Use New canvas or Import .zip in the header.</p>
    </Board>
    <Board :label="waitingCount ? `Needs a reply (${waitingCount})` : 'Needs a reply'">
      <p ref="noteEl" tabindex="-1" role="status" aria-live="polite" class="outline-none" :class="note && 'border-b px-4 py-2 text-xs text-muted-foreground'">{{ note }}</p>
      <p v-if="!shown.length" class="px-4 py-6 text-sm text-muted-foreground">Nothing is waiting. New comments from reviewers show up here until someone answers or resolves them.</p>
      <ul v-else class="divide-y">
        <li v-for="t in shown" :key="t.id">
          <InboxItem :thread="t" :open="expandedId === t.id" @update:open="v => (openId = v ? t.id : '')" @done="k => onDone(t, k)" />
        </li>
      </ul>
      <div v-if="waitingCount > shown.length" class="border-t px-4 py-2 text-xs"><NuxtLink to="/comments" class="text-muted-foreground hover:text-foreground">All {{ waitingCount }} threads</NuxtLink></div>
    </Board>
    <Board v-if="!firstRun" label="Recent artifacts">
      <p v-if="!dash.recent.length" class="px-4 py-6 text-sm text-muted-foreground">No artifacts yet. Connect an MCP client and ask it to publish something.</p>
      <ul v-else class="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="r in dash.recent" :key="r.id" class="min-w-0">
          <ArtifactCard :artifact="r" />
        </li>
      </ul>
      <div v-if="dash.total > dash.recent.length" class="border-t px-4 py-2 text-xs"><NuxtLink to="/artifacts" class="text-muted-foreground hover:text-foreground">All {{ dash.total }} artifacts</NuxtLink></div>
    </Board>
  </div>
  <div v-else-if="loading" class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6"><BoardSkeleton :rows="3" /><BoardSkeleton :rows="4" /></div>
</template>
