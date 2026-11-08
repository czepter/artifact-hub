<script setup lang="ts">
definePageMeta({ layout: 'shell', access: 'member' })
import { Check, MessageSquare } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface Thread { id: string, artifact_id: string, title: string, board: string | null, resolved: number, first_author: string, first_body: string, author_email: string, author_kind: string, body: string, last_at: string, replies: number }
const route = useRoute()
const router = useRouter()
const { data: threadData, loading } = useHubData('comments', () => $fetch<Thread[]>('/api/comments').catch(() => [] as Thread[]))
const threads = computed(() => threadData.value ?? [])
const filter = ref<'open' | 'resolved' | 'all'>('open')
const shown = computed(() => threads.value.filter(t => filter.value === 'all' || (filter.value === 'open' ? !t.resolved : !!t.resolved)))
const openCount = computed(() => threads.value.filter(t => !t.resolved).length)
const who = (t: Thread) => (t.author_kind === 'model' ? 'Claude' : t.author_email)
useHead({ title: 'Comments · Artifact Hub' })

const wanted = computed(() => (typeof route.query.thread === 'string' ? route.query.thread : ''))
const selectedId = computed(() => (shown.value.find(t => t.id === wanted.value) ?? shown.value[0])?.id ?? '')
function select(id: string, opts: { replace?: boolean } = { replace: true }) {
  void router[opts.replace === false ? 'push' : 'replace']({ query: { ...route.query, thread: id } })
}

// A deep link to a thread that is not in the current tab opens the tab it belongs to (once, when the data arrives).
let linked = false
watch(threads, (all) => {
  if (linked || !all.length) return
  linked = true
  const t = all.find(x => x.id === wanted.value)
  if (t && !shown.value.includes(t)) filter.value = t.resolved ? 'resolved' : 'open'
}, { immediate: true })
watch(filter, () => { if (route.query.thread) void router.replace({ query: { ...route.query, thread: undefined } }) })

const detail = ref<{ focusReply: () => void, toggleResolve: () => Promise<void> } | null>(null)
const detailEl = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

function scrollRow(id: string) {
  void nextTick(() => listEl.value?.querySelector(`[data-thread="${id}"]`)?.scrollIntoView({ block: 'nearest' }))
}
function pick(id: string, fromList = false) {
  select(id)
  scrollRow(id)
  if (fromList && import.meta.client && window.matchMedia('(max-width: 799px)').matches) void nextTick(() => detailEl.value?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
}
function step(d: 1 | -1) {
  const i = shown.value.findIndex(t => t.id === selectedId.value)
  const next = shown.value[Math.min(shown.value.length - 1, Math.max(0, i + d))]
  if (next) pick(next.id)
}

async function onDone({ kind, threadId }: { kind: string, threadId: string }) {
  // In the Open tab a resolved thread leaves the list: move on to its neighbour first.
  if (filter.value === 'open' && (kind === 'resolve' || kind === 'reply-resolve')) {
    const i = shown.value.findIndex(t => t.id === threadId)
    const next = shown.value[i + 1] ?? shown.value[i - 1]
    if (next) pick(next.id)
    else void router.replace({ query: { ...route.query, thread: undefined } })
  }
  await Promise.all([invalidate('comments'), invalidate('comment-count')])
}

function onKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
  const t = e.target as HTMLElement | null
  if (t && (t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || t.isContentEditable)) return
  if (e.key === 'j') { e.preventDefault(); step(1) }
  else if (e.key === 'k') { e.preventDefault(); step(-1) }
  else if (e.key === 'r' && selectedId.value) { e.preventDefault(); detail.value?.focusReply() }
  else if (e.key === 'e' && selectedId.value) { e.preventDefault(); void detail.value?.toggleResolve() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const emptyText = computed(() => filter.value === 'open'
  ? 'No open threads. Comments on any artifact appear here until they are resolved. To start one, open a board and click an element.'
  : filter.value === 'resolved' ? 'No resolved threads yet. Resolve a thread from the Open tab and it moves here.' : 'No comments yet. Open a board and click an element to leave the first one.')
</script>

<template>
  <div class="mb-5 flex flex-wrap items-end justify-between gap-3 px-1">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Comments</h1>
      <p class="text-sm text-muted-foreground">{{ loading ? 'Loading…' : `${openCount} open · ${threads.length - openCount} resolved` }}</p>
    </div>
    <Tabs v-model="filter">
      <TabsList>
        <TabsTrigger value="open">Open</TabsTrigger>
        <TabsTrigger value="resolved">Resolved</TabsTrigger>
        <TabsTrigger value="all">All</TabsTrigger>
      </TabsList>
    </Tabs>
  </div>
  <BoardSkeleton v-if="loading" />
  <div v-else class="grid items-start gap-4 min-[800px]:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
    <Board :label="`${filter === 'open' ? 'Open threads' : filter === 'resolved' ? 'Resolved threads' : 'All threads'} (${shown.length})`">
      <p v-if="!shown.length" class="px-4 py-6 text-sm text-muted-foreground">{{ emptyText }}</p>
      <ul v-else ref="listEl" aria-label="Threads" class="divide-y min-[800px]:max-h-[calc(100vh-14rem)] min-[800px]:overflow-y-auto">
        <li v-for="t in shown" :key="t.id">
          <Button
            variant="ghost" :data-thread="t.id" :aria-current="t.id === selectedId ? 'true' : undefined"
            class="h-auto w-full flex-col items-stretch gap-1 rounded-none px-4 py-3 text-left font-normal whitespace-normal aria-[current=true]:bg-muted"
            @click="pick(t.id, true)"
          >
            <span class="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
              <span class="min-w-0 truncate"><span class="font-medium text-foreground">{{ who(t) }}</span> · {{ t.title }}<template v-if="t.board"> · {{ t.board.split('/').pop() }}</template></span>
              <span class="flex shrink-0 items-center gap-2">
                <Badge v-if="t.resolved" variant="secondary" class="gap-1"><Check class="size-3" />Resolved</Badge>
                <Badge v-if="t.replies" variant="outline" class="gap-1"><MessageSquare class="size-3" />{{ t.replies }}</Badge>
                <time class="tabular-nums" :datetime="t.last_at">{{ ago(t.last_at) }}</time>
              </span>
            </span>
            <span class="line-clamp-2 text-sm" :class="[t.id === selectedId ? 'font-medium' : '', t.resolved && t.id !== selectedId && 'text-muted-foreground']">{{ t.body }}</span>
          </Button>
        </li>
      </ul>
    </Board>
    <div ref="detailEl" class="scroll-mt-4">
      <Board label="Thread">
        <ThreadDetail v-if="selectedId" ref="detail" :thread-id="selectedId" @done="onDone" />
        <p v-else class="px-4 py-6 text-sm text-muted-foreground">{{ shown.length ? 'Select a thread to read it and reply.' : 'Nothing to answer here. Pick another tab, or wait for new comments.' }}</p>
      </Board>
    </div>
  </div>
</template>
