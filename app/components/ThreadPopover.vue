<script setup lang="ts">
import type { Attachment, Comment } from '~/types'
import { Paperclip, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{
  refId: string
  mode: 'draft' | 'thread'
  /** draft: what the comment is attached to */
  target?: { tag: string, text: string }
  thread?: Comment
  replies?: Comment[]
  number?: number
  versionNote?: string
  detached?: boolean
  /** The board this is on, named in the composer (empty for a single page). */
  boardName?: string
  canComment: boolean
  needsEmail: boolean
  busy: boolean
  error: string
}>()
const emit = defineEmits<{
  submit: [body: string, attachmentIds: string[]]
  reply: [body: string, attachmentIds: string[]]
  resolve: []
  close: []
  saveEmail: [email: string]
}>()

const body = ref('')
const email = ref('')
const box = ref<{ $el: HTMLElement }>()
const mailBox = ref<{ $el: HTMLElement }>()

onMounted(() => nextTick(() => (props.needsEmail ? mailBox.value : box.value)?.$el?.focus()))
watch(() => props.needsEmail, v => { if (!v) nextTick(() => box.value?.$el?.focus()) })

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}
const who = (c: Comment) => (c.author_kind === 'model' ? 'Claude' : c.author_email)

// Files pasted with Ctrl+V are uploaded right away and posted together with the comment.
const MAX = { bytes: 10 * 1024 * 1024, count: 6 }
const staged = ref<(Attachment & { local?: string })[]>([])
const uploading = ref(0)
const localError = ref('')

async function addFiles(files: File[]) {
  localError.value = ''
  for (const f of files) {
    if (staged.value.length + uploading.value >= MAX.count) { localError.value = `At most ${MAX.count} files per comment`; break }
    if (f.size > MAX.bytes) { localError.value = `${f.name || 'File'} is larger than 10 MB`; continue }
    uploading.value++
    try {
      const name = f.name || (f.type.startsWith('image/') ? `pasted-image.${f.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'}` : 'pasted-file')
      const a = await $fetch<Attachment>(`/api/view/${props.refId}/attachments`, {
        method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(name) },
      })
      staged.value.push(a)
    } catch (e: any) { localError.value = e?.statusMessage ?? e?.data?.statusMessage ?? 'Upload failed' } finally { uploading.value-- }
  }
}

function onPaste(e: ClipboardEvent) {
  const files = [...(e.clipboardData?.files ?? [])]
  if (!files.length) return // plain text pastes as usual
  e.preventDefault()
  void addFiles(files)
}

const canSend = computed(() => !props.busy && !uploading.value && (!!body.value.trim() || staged.value.length > 0))

function send() {
  const text = body.value.trim()
  if (!canSend.value) return
  emit(props.mode === 'draft' ? 'submit' : 'reply', text, staged.value.map(a => a.id))
  body.value = ''
  staged.value = []
}
</script>

<template>
  <div class="pop" role="dialog" :aria-label="mode === 'draft' ? 'New comment' : 'Comment thread'" @keydown.esc.stop="emit('close')">
    <header class="top">
      <template v-if="mode === 'thread' && thread">
        <span class="num">{{ number }}</span>
        <strong class="who">{{ who(thread) }}</strong>
        <span class="muted">{{ ago(thread.created_at) }}</span>
        <Badge v-if="versionNote" variant="outline">{{ versionNote }}</Badge>
        <Badge v-if="detached" variant="destructive" title="The element this comment points to was not found in this version">detached</Badge>
      </template>
      <span v-else class="muted ctx">New comment on <strong>{{ target?.tag }}</strong><template v-if="target?.text"> “{{ target.text.slice(0, 48) }}”</template></span>
      <Button class="ml-auto" variant="ghost" size="icon-xs" aria-label="Close" @click="emit('close')"><X /></Button>
    </header>

    <template v-if="mode === 'thread' && thread">
      <p v-if="thread.body" class="msg">{{ thread.body }}</p>
      <CommentAttachments :ref-id="refId" :items="thread.attachments ?? []" />
    </template>
    <div v-for="r in replies" :key="r.id" class="reply">
      <div class="meta"><strong>{{ who(r) }}</strong><span class="muted">{{ ago(r.created_at) }}</span></div>
      <p v-if="r.body" class="msg">{{ r.body }}</p>
      <CommentAttachments :ref-id="refId" :items="r.attachments ?? []" />
    </div>

    <form v-if="needsEmail" class="gate" @submit.prevent="emit('saveEmail', email)">
      <span class="muted">Add your e-mail to comment. It's shown next to your comments and isn't verified.</span>
      <Input ref="mailBox" v-model="email" type="email" required placeholder="you@example.com" autocomplete="email" />
      <Button type="submit">Continue</Button>
    </form>

    <template v-else-if="canComment">
      <Textarea
        ref="box"
        v-model="body"
        class="min-h-16 resize-y"
        rows="3"
        :placeholder="mode === 'draft' ? (boardName ? `Comment on ${boardName}, or paste an image…` : 'Write a comment, or paste an image…') : (boardName ? `Reply on ${boardName}, or paste an image…` : 'Reply, or paste an image…')"
        @paste="onPaste"
        @keydown.meta.enter.prevent="send"
        @keydown.ctrl.enter.prevent="send"
      />
      <div v-if="staged.length || uploading" class="staged">
        <div v-for="a in staged" :key="a.id" class="chip">
          <img v-if="/^image\/(png|jpe?g|gif|webp|avif)$/.test(a.mime)" :src="`/api/view/${refId}/attachments/${a.id}`" :alt="a.name">
          <Paperclip v-else class="size-3.5 shrink-0" />
          <span class="n">{{ a.name }}</span>
          <button type="button" class="x" :aria-label="`Remove ${a.name}`" @click="staged = staged.filter(x => x.id !== a.id)"><X class="size-3" /></button>
        </div>
        <span v-if="uploading" class="muted">Uploading…</span>
      </div>
      <div class="row">
        <Button size="sm" :disabled="!canSend" @click="send">{{ mode === 'draft' ? 'Comment' : 'Reply' }}</Button>
        <Button v-if="mode === 'thread' && thread" size="sm" variant="outline" @click="emit('resolve')">{{ thread.resolved ? 'Reopen' : 'Resolve' }}</Button>
        <Button v-if="mode === 'draft'" size="sm" variant="outline" @click="emit('close')">Cancel</Button>
      </div>
    </template>
    <p v-else class="muted">This link is view-only.</p>

    <p v-if="error || localError" class="err" role="alert">{{ error || localError }}</p>
  </div>
</template>

<style scoped>
.pop { width: 320px; max-height: 100%; overflow: auto; background: var(--popover); color: var(--popover-foreground); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: 0 12px 36px rgb(0 0 0 / .22); padding: 12px; display: grid; gap: 10px; }
.top { display: flex; align-items: center; gap: 8px; font-size: 13px; flex-wrap: wrap; }
.ctx { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.who { overflow-wrap: anywhere; }
.num { background: var(--primary); color: var(--primary-foreground); border-radius: 999px; min-width: 22px; height: 22px; display: inline-grid; place-items: center; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.msg { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.reply { border-top: 1px solid var(--border); padding-top: 10px; display: grid; gap: 2px; }
.meta { display: flex; gap: 8px; font-size: 13px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.gate { display: grid; gap: 8px; }
.staged { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.chip { display: flex; align-items: center; gap: 6px; max-width: 100%; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 3px 4px 3px 4px; font-size: 12px; }
.chip img { width: 28px; height: 28px; object-fit: cover; border-radius: 4px; }
.chip .n { min-width: 0; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip .x { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 4px; color: var(--muted-foreground); }
.chip .x:hover { background: var(--muted); color: var(--foreground); }
</style>
