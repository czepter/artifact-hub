<script setup lang="ts">
// Header actions to start something new: an empty canvas, or an imported .zip. Shown on the dashboard and the artifact list.
import { Plus, Upload } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'

const props = defineProps<{ workspace?: string }>()
const fileInput = ref<{ $el: HTMLInputElement }>()
const busy = ref(false)
const msg = ref('')
const errOf = (e: any, fallback: string) => e?.data?.statusMessage ?? e?.statusMessage ?? fallback

async function newCanvas() {
  busy.value = true
  msg.value = ''
  try {
    const canvas = { v: 1, title: 'Untitled canvas', boards: {}, order: [], notes: {} }
    const r = await $fetch<{ id: string }>('/api/artifacts', {
      method: 'POST', body: { title: 'Untitled canvas', files: [{ path: 'canvas.json', content: JSON.stringify(canvas, null, 2) }], label: 'New canvas', workspaceId: props.workspace },
    })
    await navigateTo(`/a/${r.id}`, { external: true })
  } catch (e) { msg.value = errOf(e, 'Could not create the canvas') } finally { busy.value = false }
}
async function importZip(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  busy.value = true
  msg.value = ''
  try {
    const r = await $fetch<{ url: string }>('/api/artifacts/import', {
      method: 'POST', body: file, headers: { 'content-type': 'application/zip' },
      query: { title: file.name.replace(/\.zip$/i, ''), workspace: props.workspace },
    })
    await navigateTo(r.url, { external: true })
  } catch (err) { msg.value = errOf(err, 'Import failed') } finally { busy.value = false }
}
defineExpose({ msg })
</script>

<template>
  <Button size="sm" :disabled="busy" @click="newCanvas"><Plus />New canvas</Button>
  <Button variant="ghost" size="sm" :disabled="busy" @click="fileInput?.$el.click()"><Upload />{{ busy ? 'Working…' : 'Import .zip' }}</Button>
  <Input ref="fileInput" type="file" accept=".zip,application/zip" class="hidden" :disabled="busy" @change="importZip" />
  <Alert v-if="msg" variant="destructive" class="fixed bottom-4 left-1/2 z-30 w-auto max-w-sm -translate-x-1/2" role="alert"><AlertDescription>{{ msg }}</AlertDescription></Alert>
</template>
