<script setup lang="ts">
import { Check, RotateCcw } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Anchor, Attachment } from '~/types'

interface Message { id: string, author_email: string, author_kind: 'person' | 'model', body: string, created_at: string, attachments: Attachment[] }
interface ThreadFull { id: string, artifact: { id: string, title: string }, board: string | null, anchor: Anchor | null, version: number, resolved: number, messages: Message[] }
type Kind = 'reply' | 'resolve' | 'reopen' | 'reply-resolve'

const props = defineProps<{ threadId: string }>()
const emit = defineEmits<{ done: [payload: { kind: Kind, threadId: string }] }>()

const thread = ref<ThreadFull | null>(null)
const loadError = ref('')
const drafts = reactive<Record<string, string>>({})
const draft = computed({ get: () => drafts[props.threadId] ?? '', set: (v: string) => { drafts[props.threadId] = v } })
const busy = ref(false)
const error = ref('')
const field = ref<{ $el: HTMLTextAreaElement } | null>(null)
let token = 0

async function load(id: string) {
  const mine = ++token
  loadError.value = ''
  try {
    const t = await $fetch<ThreadFull>(`/api/comments/${id}`)
    if (mine === token) thread.value = t
  } catch (e) {
    if (mine === token) { thread.value = null; loadError.value = (e as { statusCode?: number })?.statusCode === 404 ? 'This thread no longer exists.' : 'Could not load this thread. Check your connection and try again.' }
  }
}
watch(() => props.threadId, (id) => { error.value = ''; void load(id) }, { immediate: true })

const current = computed(() => (thread.value && thread.value.id === props.threadId ? thread.value : null))
const who = (m: Message) => (m.author_kind === 'model' ? 'Claude' : m.author_email)
const isResolved = computed(() => !!current.value?.resolved)
const boardName = computed(() => current.value?.board?.split('/').pop() ?? null)
const anchorLabel = computed(() => {
  const a = current.value?.anchor
  if (!a) return null
  const t = (a.text || '').trim().replace(/\s+/g, ' ')
  return t ? `${a.tag || a.selector} · “${t.length > 32 ? `${t.slice(0, 31)}…` : t}”` : (a.selector || a.tag)
})

async function run(kind: Kind) {
  const t = current.value
  if (!t || busy.value) return
  const text = draft.value.trim()
  if ((kind === 'reply' || kind === 'reply-resolve') && !text) return
  busy.value = true
  error.value = ''
  try {
    if (kind === 'reply' || kind === 'reply-resolve') await $fetch(`/api/view/${t.artifact.id}/comments`, { method: 'POST', body: { body: text, parentId: t.id } })
    if (kind === 'resolve' || kind === 'reply-resolve' || kind === 'reopen') await $fetch(`/api/view/${t.artifact.id}/comments/${t.id}/resolve`, { method: 'POST', body: { resolved: kind !== 'reopen' } })
    delete drafts[t.id]
    await load(t.id)
    emit('done', { kind, threadId: t.id })
  } catch (e) {
    const msg = (e as { statusMessage?: string, data?: { statusMessage?: string } })
    error.value = `${kind === 'reply' ? 'Your reply was not sent' : 'The thread was not updated'}: ${msg.data?.statusMessage || msg.statusMessage || 'the server could not be reached'}. Your text is still here, try again.`
  } finally {
    busy.value = false
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run('reply') }
}

defineExpose({
  focusReply: () => (field.value?.$el ?? (field.value as unknown as HTMLTextAreaElement | null))?.focus(),
  toggleResolve: () => run(isResolved.value ? 'reopen' : 'resolve'),
})
</script>

<template>
  <div v-if="loadError" role="alert" class="px-4 py-6 text-sm text-destructive">{{ loadError }}</div>
  <div v-else-if="!current" class="px-4 py-6 text-sm text-muted-foreground" aria-live="polite">Loading thread…</div>
  <div v-else>
    <header class="flex items-start justify-between gap-3 border-b px-4 py-3.5">
      <div class="min-w-0">
        <h3 class="truncate text-base font-semibold">{{ current.artifact.title }}</h3>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <Badge v-if="boardName" variant="outline">{{ boardName }}</Badge>
          <Badge v-if="anchorLabel" variant="outline" class="max-w-full"><span class="truncate">{{ anchorLabel }}</span></Badge>
          <Badge variant="secondary">v{{ current.version }}</Badge>
          <Badge v-if="isResolved" variant="secondary" class="gap-1"><Check class="size-3" />Resolved</Badge>
        </div>
      </div>
      <Button as-child variant="ghost" size="sm" class="shrink-0"><NuxtLink :to="`/a/${current.artifact.id}`">Open board</NuxtLink></Button>
    </header>

    <div class="divide-y">
      <article v-for="m in current.messages" :key="m.id" class="grid gap-1 px-4 py-3.5">
        <div class="flex items-baseline justify-between gap-3">
          <strong class="min-w-0 truncate text-sm font-medium">{{ who(m) }}</strong>
          <time class="shrink-0 text-xs tabular-nums text-muted-foreground" :datetime="m.created_at">{{ ago(m.created_at) }}</time>
        </div>
        <p class="max-w-[68ch] whitespace-pre-wrap break-words text-sm">{{ m.body }}</p>
        <CommentAttachments v-if="m.attachments.length" :ref-id="current.artifact.id" :items="m.attachments" class="mt-1" />
      </article>
    </div>

    <form class="grid gap-2.5 border-t bg-muted/40 px-4 py-3.5" @submit.prevent="run('reply')">
      <label class="sr-only" :for="`reply-${current.id}`">Reply</label>
      <Textarea :id="`reply-${current.id}`" ref="field" v-model="draft" rows="2" placeholder="Write a reply" class="bg-background" :disabled="busy" @keydown="onKey" />
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="hidden gap-3 text-xs text-muted-foreground md:flex">
          <span><kbd class="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">J</kbd> <kbd class="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">K</kbd> next, previous</span>
          <span><kbd class="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">R</kbd> reply</span>
          <span><kbd class="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">E</kbd> {{ isResolved ? 'reopen' : 'resolve' }}</span>
        </div>
        <div class="flex flex-wrap gap-2 max-md:w-full max-md:[&>button]:min-h-11 max-md:[&>button]:flex-1">
          <Button type="button" variant="outline" size="sm" :disabled="busy" @click="run(isResolved ? 'reopen' : 'resolve')">
            <component :is="isResolved ? RotateCcw : Check" />{{ isResolved ? 'Reopen' : 'Resolve' }}
          </Button>
          <Button v-if="!isResolved" type="button" variant="outline" size="sm" :disabled="busy || !draft.trim()" @click="run('reply-resolve')">Reply and resolve</Button>
          <Button type="submit" size="sm" :disabled="busy || !draft.trim()">Reply</Button>
        </div>
      </div>
    </form>
  </div>
</template>
