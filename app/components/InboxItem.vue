<script setup lang="ts">
// One thread that waits for an answer: who wrote what and where, the reply field in place, and Open board / Resolve.
// Posts as the signed-in member; the parent removes the row (and refreshes the shared data) on `done`.
import { Check } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface InboxThread { id: string, artifact_id: string, title: string, board?: string | null, author_email: string, body: string, last_at: string, replies: number }
const props = defineProps<{ thread: InboxThread, open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void, (e: 'done', kind: 'reply' | 'resolve'): void }>()

const text = ref('')
const busy = ref<'' | 'reply' | 'resolve'>('')
const err = ref('')
const input = ref<{ $el: HTMLInputElement }>()
const root = ref<HTMLElement>()
const errId = `inbox-err-${props.thread.id}`
const errOf = (e: any, fallback: string) => e?.data?.statusMessage ?? e?.statusMessage ?? fallback

async function expand() {
  emit('update:open', true)
  await nextTick()
  input.value?.$el.focus()
}
async function collapse() {
  if (busy.value) return
  emit('update:open', false)
  await nextTick()
  root.value?.querySelector<HTMLElement>('[data-reply]')?.focus()
}

async function send() {
  const body = text.value.trim()
  if (busy.value) return
  if (!body) { err.value = 'Write a reply first, or resolve the thread if nothing more is needed.'; return }
  busy.value = 'reply'
  err.value = ''
  try {
    await $fetch(`/api/view/${props.thread.artifact_id}/comments`, { method: 'POST', body: { body, parentId: props.thread.id } })
    text.value = ''
    emit('done', 'reply')
  } catch (e) { err.value = `${errOf(e, 'The reply could not be sent')}. Your text is still here, try again.` } finally { busy.value = '' }
}
async function resolve() {
  if (busy.value) return
  busy.value = 'resolve'
  err.value = ''
  try {
    await $fetch(`/api/view/${props.thread.artifact_id}/comments/${props.thread.id}/resolve`, { method: 'POST', body: { resolved: true } })
    emit('done', 'resolve')
  } catch (e) { err.value = `${errOf(e, 'The thread could not be resolved')}. Try again.` } finally { busy.value = '' }
}
</script>

<template>
  <div ref="root" class="grid gap-2 px-4 py-3.5" :class="open && 'bg-muted/45'" @keydown.esc="open && collapse()">
    <div class="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
      <span class="min-w-0">
        <span class="font-medium text-foreground">{{ thread.author_email }}</span>
        on <NuxtLink :to="`/a/${thread.artifact_id}`" class="underline underline-offset-2 hover:text-foreground">{{ thread.title }}</NuxtLink><template v-if="thread.board"> · {{ thread.board }}</template>
      </span>
      <time class="shrink-0 tabular-nums" :datetime="thread.last_at">{{ ago(thread.last_at) }}</time>
    </div>
    <p class="max-w-[72ch] whitespace-pre-wrap break-words text-sm" :class="open && 'font-medium'">{{ thread.body }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <form v-if="open" class="flex min-w-0 flex-[1_1_280px] gap-2" @submit.prevent="send">
        <Input ref="input" v-model="text" :aria-label="`Reply to ${thread.author_email}`" placeholder="Write a reply…" autocomplete="off" :disabled="busy === 'reply'" :aria-invalid="!!err || undefined" :aria-describedby="err ? errId : undefined" class="flex-1" />
        <Button type="submit" :disabled="!!busy" :aria-busy="busy === 'reply'">{{ busy === 'reply' ? 'Sending…' : 'Reply' }}</Button>
      </form>
      <Button v-else data-reply variant="outline" @click="expand">Reply</Button>
      <Button as-child variant="ghost"><NuxtLink :to="`/a/${thread.artifact_id}`">Open board</NuxtLink></Button>
      <Button variant="ghost" :disabled="!!busy" :aria-busy="busy === 'resolve'" @click="resolve"><Check />{{ busy === 'resolve' ? 'Resolving…' : 'Resolve' }}</Button>
    </div>
    <p v-if="err" :id="errId" class="err" role="alert">{{ err }}</p>
  </div>
</template>
