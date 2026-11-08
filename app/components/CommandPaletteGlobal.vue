<script setup lang="ts">
// Cmd/Ctrl+K: find an artifact or a waiting thread, jump to a page, or run an action. Independent from the canvas palette
// (CanvasCommandPalette), which lives in the viewer; the viewer route does not use this shell.
import { Activity, Check, Copy, CornerDownLeft, FileText, LayoutDashboard, Link2, MessageSquare, Plus, Search, Settings2, UserPlus, UserRound, Users, Files, Building2, X, type LucideIcon } from '@lucide/vue'
import { ListboxFilter } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'

interface ArtifactHit { id: string, title: string, current_version: number, updated_at: string, pinned: number }
interface ThreadHit { id: string, artifact_id: string, title: string, author_email: string, body: string, last_at: string }
interface Entry { key: string, label: string, icon: LucideIcon, run: () => void | Promise<void>, to?: string }

const props = defineProps<{ role?: string }>()
const emit = defineEmits<{ 'return-focus': [] }>()
const open = defineModel<boolean>('open', { required: true })
const owner = computed(() => props.role === 'owner')
const canCreate = computed(() => !!props.role && props.role !== 'commenter')

const query = ref('')
const q = computed(() => query.value.trim())
const remote = ref<{ artifacts: ArtifactHit[], threads: ThreadHit[] }>({ artifacts: [], threads: [] })
const loaded = ref(false)
const input = ref<{ $el: HTMLInputElement } | null>(null)
const status = ref('')

const lc = (s: string) => s.toLowerCase()
const has = (s: string, needle: string) => lc(s).includes(lc(needle))

// Debounced fetch; only the newest request may write results.
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined
async function fetchNow(text: string) {
  const mine = ++seq
  try {
    const r = await $fetch<{ artifacts: ArtifactHit[], threads: ThreadHit[] }>('/api/search', { query: { q: text } })
    if (mine === seq) { remote.value = r; loaded.value = true; await rehighlight() }
  } catch { if (mine === seq) loaded.value = true }
}
watch(q, (v) => { clearTimeout(timer); timer = setTimeout(() => fetchNow(v), 150); void rehighlight() })
watch(open, (o) => {
  if (o) { query.value = ''; status.value = ''; loaded.value = false; clearTimeout(timer); void fetchNow('') }
  else { seq++; clearTimeout(timer) }
})
onBeforeUnmount(() => clearTimeout(timer))

// Keep the first visible result highlighted: reka highlights on the input event, so replay one after the list changed.
async function rehighlight() {
  await nextTick()
  const el = input.value?.$el
  if (el && document.activeElement === el) el.dispatchEvent(new Event('input', { bubbles: true }))
}

const go = (to: string) => navigateTo(to)
const origin = () => (import.meta.client ? location.origin : '')
const { newCanvas } = useNewCanvas()
async function copyEndpoint() {
  try { await navigator.clipboard.writeText(`${origin()}/mcp`); status.value = 'MCP endpoint copied' }
  catch { status.value = 'Could not copy. Select the address on the dashboard instead.' }
  setTimeout(() => { open.value = false }, 900)
}

const pages = computed<Entry[]>(() => [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { key: 'artifacts', label: 'Artifacts', icon: Files, to: '/artifacts' },
  { key: 'comments', label: 'Comments', icon: MessageSquare, to: '/comments' },
  { key: 'account', label: 'Account', icon: UserRound, to: '/account' },
  ...(owner.value ? [
    { key: 'admin', label: 'Admin: Overview', icon: Settings2, to: '/admin' },
    { key: 'members', label: 'Admin: Members', icon: Users, to: '/admin/members' },
    { key: 'clients', label: 'Admin: Clients', icon: Building2, to: '/admin/clients' },
    { key: 'shares', label: 'Admin: Share links', icon: Link2, to: '/admin/share-links' },
    { key: 'activity', label: 'Admin: Activity', icon: Activity, to: '/admin/activity' },
  ] : []),
].map(p => ({ ...p, run: () => go(p.to) })))
const actions = computed<Entry[]>(() => [
  ...(canCreate.value ? [{ key: 'new', label: 'New canvas', icon: Plus, run: async () => { open.value = false; await newCanvas() } }] : []),
  { key: 'mcp', label: 'Copy MCP endpoint', icon: Copy, run: copyEndpoint },
  ...(owner.value ? [{ key: 'invite', label: 'Invite a member', icon: UserPlus, run: () => go('/admin/members') }] : []),
])

const artifacts = computed(() => remote.value.artifacts.filter(a => !q.value || has(a.title, q.value)).slice(0, q.value ? 8 : 6))
const threads = computed(() => remote.value.threads.filter(t => !q.value || has(t.body, q.value) || has(t.author_email, q.value)).slice(0, q.value ? 5 : 3))
const shownPages = computed(() => pages.value.filter(p => !q.value || has(p.label, q.value)))
const shownActions = computed(() => actions.value.filter(a => !q.value || has(a.label, q.value)))
const total = computed(() => artifacts.value.length + threads.value.length + shownPages.value.length + shownActions.value.length)

/** Split text around the query so matches can be marked (weight + underline, no colour). */
function parts(text: string): { t: string, m: boolean }[] {
  const n = q.value
  if (!n) return [{ t: text, m: false }]
  const out: { t: string, m: boolean }[] = []
  const l = lc(text), ln = lc(n)
  let i = 0
  for (let at = l.indexOf(ln); at !== -1; at = l.indexOf(ln, i)) {
    if (at > i) out.push({ t: text.slice(i, at), m: false })
    out.push({ t: text.slice(at, at + n.length), m: true })
    i = at + n.length
  }
  if (i < text.length) out.push({ t: text.slice(i), m: false })
  return out
}
/** A one-line snippet; when the match sits late in a long body the window moves to it. */
function snippet(body: string) {
  const flat = body.replace(/\s+/g, ' ').trim()
  const at = q.value ? lc(flat).indexOf(lc(q.value)) : -1
  if (at < 60) return flat.length > 140 ? flat.slice(0, 140) + '…' : flat
  const s = flat.slice(Math.max(0, at - 40), at + 100)
  return '…' + s + (at + 100 < flat.length ? '…' : '')
}
const select = (e: Entry) => { void e.run() }
const selectArtifact = (id: string) => { open.value = false; void navigateTo(`/a/${id}`, { external: true }) }
const itemCls = 'min-h-9 gap-2.5 max-[800px]:min-h-11'
const mark = 'font-semibold underline decoration-1 underline-offset-4'
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :show-close-button="false"
      aria-label="Search and commands"
      class="top-[max(0.75rem,env(safe-area-inset-top))] flex max-h-[min(34rem,calc(100dvh-1.5rem))] w-[calc(100%-1.5rem)] max-w-xl translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-[12vh] max-[800px]:max-w-none"
      @close-auto-focus="(e: Event) => { e.preventDefault(); emit('return-focus') }"
    >
      <DialogTitle class="sr-only">Search and commands</DialogTitle>
      <DialogDescription class="sr-only">Search artifacts and waiting threads, go to a page, or run an action. Use the arrow keys and Enter.</DialogDescription>
      <Command class="min-h-0 flex-1 rounded-lg" :reset-search-term-on-blur="false">
        <div class="flex items-center gap-2 border-b pl-3 pr-2">
          <Search class="size-4 shrink-0 opacity-60" aria-hidden="true" />
          <ListboxFilter
            ref="input" v-model="query" auto-focus type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"
            aria-label="Search artifacts, threads, pages and actions" placeholder="Search artifacts, threads and commands…"
            class="h-12 w-full min-w-0 bg-transparent text-base outline-hidden placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden md:text-sm"
          />
          <DialogClose as-child>
            <Button variant="ghost" size="icon-lg" class="size-11 shrink-0 min-[801px]:hidden" aria-label="Close"><X /></Button>
          </DialogClose>
          <kbd class="hidden shrink-0 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground min-[801px]:block" aria-hidden="true">esc</kbd>
        </div>
        <CommandList class="max-h-none min-h-0 flex-1 overscroll-contain p-1" aria-label="Results">
          <CommandGroup v-if="artifacts.length" :heading="q ? 'Artifacts' : 'Recent artifacts'">
            <CommandItem v-for="a in artifacts" :key="a.id" :value="`artifact:${a.id}`" :class="itemCls" @select="selectArtifact(a.id)">
              <FileText aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate"><template v-for="(p, i) in parts(a.title)" :key="i"><span v-if="p.m" :class="mark">{{ p.t }}</span><template v-else>{{ p.t }}</template></template></span>
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">v{{ a.current_version }} · {{ ago(a.updated_at) }}</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup v-if="threads.length" heading="Needs a reply">
            <CommandItem v-for="t in threads" :key="t.id" :value="`thread:${t.id}`" :class="`${itemCls} items-start py-2`" @select="selectArtifact(t.artifact_id)">
              <MessageSquare class="mt-0.5" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block truncate"><template v-for="(p, i) in parts(t.author_email)" :key="i"><span v-if="p.m" :class="mark">{{ p.t }}</span><template v-else>{{ p.t }}</template></template><span class="text-muted-foreground"> on {{ t.title }}</span></span>
                <span class="line-clamp-2 text-xs text-muted-foreground"><template v-for="(p, i) in parts(snippet(t.body))" :key="i"><span v-if="p.m" :class="mark">{{ p.t }}</span><template v-else>{{ p.t }}</template></template></span>
              </span>
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ ago(t.last_at) }}</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup v-if="shownPages.length" heading="Go to">
            <CommandItem v-for="p in shownPages" :key="p.key" :value="`page:${p.key}`" :class="itemCls" @select="select(p)">
              <component :is="p.icon" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate"><template v-for="(s, i) in parts(p.label)" :key="i"><span v-if="s.m" :class="mark">{{ s.t }}</span><template v-else>{{ s.t }}</template></template></span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup v-if="shownActions.length" heading="Actions">
            <CommandItem v-for="a in shownActions" :key="a.key" :value="`action:${a.key}`" :class="itemCls" @select="select(a)">
              <component :is="a.icon" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate"><template v-for="(s, i) in parts(a.label)" :key="i"><span v-if="s.m" :class="mark">{{ s.t }}</span><template v-else>{{ s.t }}</template></template></span>
            </CommandItem>
          </CommandGroup>
          <p v-if="q && !total && loaded" class="px-3 py-8 text-center text-sm text-muted-foreground">No results for “{{ q }}”</p>
        </CommandList>
        <p v-if="status" role="status" class="flex items-center gap-2 border-t px-3 py-2.5 text-sm"><Check class="size-4" aria-hidden="true" />{{ status }}</p>
        <div v-else class="hidden items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground [@media(min-width:801px)_and_(pointer:fine)]:flex" aria-hidden="true">
          <span><kbd class="rounded border px-1">↑</kbd> <kbd class="rounded border px-1">↓</kbd> to move</span>
          <span><CornerDownLeft class="inline size-3" /> to open</span>
        </div>
      </Command>
    </DialogContent>
  </Dialog>
</template>
