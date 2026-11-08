<script setup lang="ts">
import { PanelRightClose } from '@lucide/vue'
import type { Comment } from '~/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

// The comments panel. In Review it is the review surface: threads scoped to one board or all of them, and a composer
// that replies to the selected thread or starts a new one on the active board. In View it is the plain thread list.
const props = defineProps<{
  roots: Comment[]
  repliesOf: (id: string) => Comment[]
  selectedId: string | null
  located: Record<string, boolean>
  version: number
  reviewing: boolean
  /** Board paths to titles; empty for a single page (no board names shown). */
  boardTitles: Record<string, string>
  /** The board "This board" and new comments refer to. */
  activeBoard: string | null
  /** Offer the This board / All boards switch (a canvas with more than one board). */
  scoped: boolean
  composer: boolean
  canComment: boolean
  needsEmail: boolean
  busy: boolean
  error: string
}>()
const showResolved = defineModel<boolean>('showResolved', { required: true })
const scope = defineModel<'all' | 'board'>('scope', { required: true })
const emit = defineEmits<{ select: [id: string], hide: [], comment: [body: string], reply: [body: string], resolve: [], saveEmail: [email: string] }>()

const nameOf = (path: string | null | undefined) => (path ? props.boardTitles[path] ?? '' : '')
const activeName = computed(() => nameOf(props.activeBoard))
const shown = computed(() => props.roots.filter(c => showResolved.value || !c.resolved))
const onBoard = computed(() => shown.value.filter(c => c.board === props.activeBoard))
const list = computed(() => (props.scoped && scope.value === 'board' ? onBoard.value : shown.value))
const openCount = computed(() => props.roots.filter(r => !r.resolved).length)
const numberOf = (c: Comment) => props.roots.indexOf(c) + 1
const who = (c: Comment) => (c.author_kind === 'model' ? 'Claude' : c.author_email)

const selected = computed(() => props.roots.find(c => c.id === props.selectedId) ?? null)
/** The composer replies to the selected thread, else starts a thread on the active board. */
const target = computed(() => {
  const t = selected.value
  if (t) { const b = nameOf(t.board); return { reply: true, label: `Replying to #${numberOf(t)}${b ? ` on ${b}` : ''}`, placeholder: `Reply${b ? ` on ${b}` : ''}…` } }
  const b = activeName.value
  return { reply: false, label: b ? `New comment on ${b}` : 'New comment on this page', placeholder: b ? `Comment on ${b}…` : 'Comment on this page…' }
})

const body = ref('')
const email = ref('')
function send() {
  const text = body.value.trim()
  if (!text || props.busy) return
  emit(target.value.reply ? 'reply' : 'comment', text)
  body.value = ''
}
const emptyText = computed(() => {
  if (props.scoped && scope.value === 'board' && shown.value.length) return activeName.value ? `No ${showResolved.value ? '' : 'open '}threads on ${activeName.value}.` : 'Select a board to see its threads.'
  if (!props.canComment && !props.needsEmail) return 'No comments yet.'
  return props.reviewing ? 'No comments yet. Click anything on a board to comment on it, or write below.' : 'No comments yet. Switch to Review, then click anything on the page.'
})
</script>

<template>
  <div class="panel">
    <header class="head">
      <h2 class="text-sm font-semibold">{{ reviewing ? 'Review' : 'Comments' }}</h2>
      <Badge variant="secondary" class="tabular-nums">{{ openCount }} open</Badge>
      <IconBtn class="ml-auto" label="Hide comments" size="icon-xs" @click="emit('hide')"><PanelRightClose /></IconBtn>
    </header>

    <ToggleGroup
      v-if="scoped" type="single" variant="outline" class="w-full" aria-label="Which threads"
      :model-value="scope" @update:model-value="(v) => v && (scope = v as 'all' | 'board')"
    >
      <ToggleGroupItem value="board" size="sm" class="flex-auto whitespace-nowrap px-2" :disabled="!activeBoard" :title="activeName ? `Threads on ${activeName}` : 'Select a board first'">
        <span>This board</span><span class="tabular-nums">({{ onBoard.length }})</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="all" size="sm" class="flex-auto whitespace-nowrap px-2">
        All boards <span class="tabular-nums">({{ shown.length }})</span>
      </ToggleGroupItem>
    </ToggleGroup>

    <label class="flex items-center gap-2 px-1 pb-1 text-sm text-muted-foreground"><Checkbox v-model="showResolved" /> Show resolved</label>
    <p v-if="!list.length" class="muted empty">{{ emptyText }}</p>
    <Button
      v-for="c in list"
      :key="c.id"
      variant="ghost"
      class="item h-auto whitespace-normal"
      :class="{ selected: selectedId === c.id, resolved: c.resolved, detached: !!c.anchor && located[c.id] === false }"
      :aria-pressed="selectedId === c.id"
      @click="emit('select', c.id)"
    >
      <span class="num">{{ numberOf(c) }}</span>
      <span class="txt">
        <span class="line1"><strong>{{ who(c) }}</strong> <span class="muted">{{ ago(c.created_at) }}</span></span>
        <span v-if="nameOf(c.board)" class="ctx">{{ nameOf(c.board) }}</span>
        <span class="snip">{{ c.body || (c.attachments?.length ? '📎 ' + c.attachments.map(a => a.name).join(', ') : '') }}</span>
        <span v-if="repliesOf(c.id).length || c.resolved || (c.anchor && located[c.id] === false) || c.version !== version" class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span v-if="repliesOf(c.id).length">{{ repliesOf(c.id).length }} {{ repliesOf(c.id).length === 1 ? 'reply' : 'replies' }}</span>
          <Badge v-if="c.resolved" variant="secondary">resolved</Badge>
          <Badge v-if="c.anchor && located[c.id] === false" variant="destructive">detached</Badge>
          <Badge v-if="c.version !== version" variant="outline">v{{ c.version }}</Badge>
        </span>
      </span>
    </Button>

    <div v-if="composer" class="composer">
      <form v-if="needsEmail" class="grid gap-2" @submit.prevent="emit('saveEmail', email)">
        <span class="text-xs text-muted-foreground">Add your e-mail to comment. It's shown next to your comments and isn't verified.</span>
        <Input v-model="email" type="email" required placeholder="you@example.com" autocomplete="email" aria-label="Your e-mail" />
        <Button type="submit" size="sm">Continue</Button>
      </form>
      <template v-else-if="canComment">
        <span class="ctx" aria-live="polite">{{ target.label }}</span>
        <Textarea
          v-model="body" class="min-h-16 resize-y" rows="2" :placeholder="target.placeholder" :aria-label="target.label"
          @keydown.meta.enter.prevent="send" @keydown.ctrl.enter.prevent="send"
        />
        <div class="flex flex-wrap justify-end gap-2">
          <Button v-if="selected" size="sm" variant="ghost" @click="emit('resolve')">{{ selected.resolved ? 'Reopen' : 'Resolve' }}</Button>
          <Button size="sm" :disabled="!body.trim() || busy" @click="send">{{ target.reply ? 'Reply' : 'Comment' }}</Button>
        </div>
      </template>
      <p v-if="error" class="text-xs text-destructive" role="alert">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.panel { flex: 1 0 auto; display: flex; flex-direction: column; gap: 6px; }
.head { display: flex; align-items: center; gap: 8px; padding: 0 2px 4px; }
.empty { margin: 8px 4px; }
.item { display: flex; justify-content: flex-start; gap: 10px; align-items: flex-start; text-align: left; border: 1px solid transparent; background: transparent; border-radius: 10px; padding: 8px; cursor: pointer; width: 100%; }
.item:hover { background: var(--hover); }
.item.selected { border-color: var(--brand); background: var(--bg); }
.item.resolved .snip { color: var(--muted-foreground); }
.item.resolved .num { background: var(--muted); color: var(--muted-foreground); }
.item.detached .num { background: var(--destructive); color: #fff; }
.item.detached { border-style: dashed; border-color: var(--border); }
.num { background: var(--primary); color: var(--primary-foreground); border-radius: 999px; min-width: 22px; height: 22px; display: inline-grid; place-items: center; font-size: 12px; font-weight: 600; flex: none; font-variant-numeric: tabular-nums; }
.txt { display: grid; gap: 2px; min-width: 0; font-size: 13px; }
.line1 { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.ctx { font-size: 12px; color: var(--muted-foreground); overflow-wrap: anywhere; }
.snip { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.composer { position: sticky; bottom: -10px; margin: auto -10px -10px; padding: 10px; display: grid; gap: 6px; background: var(--panel); border-top: 1px solid var(--line); }
</style>
