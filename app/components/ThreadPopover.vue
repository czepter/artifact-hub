<script setup lang="ts">
import type { Comment } from '~/types'
import { X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{
  mode: 'draft' | 'thread'
  /** draft: what the comment is attached to */
  target?: { tag: string, text: string }
  thread?: Comment
  replies?: Comment[]
  number?: number
  versionNote?: string
  detached?: boolean
  canComment: boolean
  needsEmail: boolean
  busy: boolean
  error: string
}>()
const emit = defineEmits<{
  submit: [body: string]
  reply: [body: string]
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

function send() {
  const text = body.value.trim()
  if (!text || props.busy) return
  emit(props.mode === 'draft' ? 'submit' : 'reply', text)
  body.value = ''
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

    <p v-if="mode === 'thread' && thread" class="msg">{{ thread.body }}</p>
    <div v-for="r in replies" :key="r.id" class="reply">
      <div class="meta"><strong>{{ who(r) }}</strong><span class="muted">{{ ago(r.created_at) }}</span></div>
      <p class="msg">{{ r.body }}</p>
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
        :placeholder="mode === 'draft' ? 'Write a comment…' : 'Reply…'"
        @keydown.meta.enter.prevent="send"
        @keydown.ctrl.enter.prevent="send"
      />
      <div class="row">
        <Button size="sm" :disabled="busy || !body.trim()" @click="send">{{ mode === 'draft' ? 'Comment' : 'Reply' }}</Button>
        <Button v-if="mode === 'thread' && thread" size="sm" variant="outline" @click="emit('resolve')">{{ thread.resolved ? 'Reopen' : 'Resolve' }}</Button>
        <Button v-if="mode === 'draft'" size="sm" variant="outline" @click="emit('close')">Cancel</Button>
      </div>
    </template>
    <p v-else class="muted">This link is view-only.</p>

    <p v-if="error" class="err" role="alert">{{ error }}</p>
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
</style>
