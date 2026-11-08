<script setup lang="ts">
// A workspace's shared files: tokens, component styles, scripts, images that boards of any of its artifacts link
// as `_shared/<path>`. Live links, so saving a file here updates every board that uses it.
import { ArrowLeft, Copy, FilePlus2, Trash2, Upload } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface SharedFile { path: string, contentType: string, size: number, rev: number, updatedAt: string, updatedBy: string, ref: string }
const props = defineProps<{ workspace: WorkspaceInfo, canEdit: boolean }>()
const open = defineModel<boolean>('open', { required: true })

const files = ref<SharedFile[]>([])
const loading = ref(false)
const error = ref('')
const busy = ref(false)
const editing = ref<{ path: string, isNew: boolean } | null>(null)
const text = ref('')
const original = ref('')
const upload = ref<HTMLInputElement>()
const url = (p: string) => `/api/workspaces/${props.workspace.id}/files/${p.split('/').map(encodeURIComponent).join('/')}`
const isText = (f: SharedFile) => /^(text\/|application\/json|image\/svg)/.test(f.contentType)
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const msg = (e: any, fallback: string) => e?.data?.statusMessage ?? e?.statusMessage ?? fallback

async function load() {
  loading.value = true
  try { files.value = (await $fetch<{ files: SharedFile[] }>(`/api/workspaces/${props.workspace.id}/files`)).files } catch (e) { error.value = msg(e, 'Could not load the shared files') } finally { loading.value = false }
}
watch(open, (o) => { if (o) { editing.value = null; error.value = ''; void load() } }, { immediate: true })

async function edit(f: SharedFile) {
  error.value = ''
  try {
    const r = await $fetch<{ source: string }>(url(f.path))
    text.value = original.value = r.source
    editing.value = { path: f.path, isNew: false }
  } catch (e) { error.value = msg(e, 'Could not open the file') }
}
function startNew() { text.value = original.value = ''; error.value = ''; editing.value = { path: 'tokens.css', isNew: true } }

async function save() {
  if (!editing.value) return
  busy.value = true; error.value = ''
  try {
    await $fetch(url(editing.value.path), { method: 'PUT', body: { content: text.value } })
    editing.value = null
    await load()
  } catch (e) { error.value = msg(e, 'Could not save the file') } finally { busy.value = false }
}
async function remove(f: SharedFile) {
  if (!confirm(`Remove ${f.ref}? Boards that still link it will lose it.`)) return
  error.value = ''
  try { await $fetch(url(f.path), { method: 'DELETE' }); await load() } catch (e) { error.value = msg(e, 'Could not remove the file') }
}
async function picked(ev: Event) {
  const input = ev.target as HTMLInputElement
  error.value = ''
  for (const file of Array.from(input.files ?? [])) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    try { await $fetch(url(file.name), { method: 'PUT', body: { content: btoa(bin), encoding: 'base64' } }) } catch (e) { error.value = `${file.name}: ${msg(e, 'could not upload')}` }
  }
  input.value = ''
  await load()
}
async function copyRef(f: SharedFile) {
  const snippet = f.path.endsWith('.css') ? `<link rel="stylesheet" href="${f.ref}">` : f.path.endsWith('.js') || f.path.endsWith('.mjs') ? `<script src="${f.ref}"><\/script>` : f.ref
  try { await navigator.clipboard.writeText(snippet) } catch { /* clipboard may be blocked; the path is visible anyway */ }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Shared files · {{ workspace.name }}</DialogTitle>
        <DialogDescription>
          Link a file from any board in this workspace as <code class="rounded bg-muted px-1 py-0.5 text-xs">_shared/&lt;path&gt;</code>.
          It is a live link: saving a file here updates every board that uses it.
        </DialogDescription>
      </DialogHeader>

      <div v-if="editing" class="grid gap-2.5">
        <div class="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" class="size-8 shrink-0" aria-label="Back to the list" @click="editing = null"><ArrowLeft /></Button>
          <Input v-if="editing.isNew" v-model="editing.path" aria-label="File path" class="font-mono text-xs" placeholder="css/tokens.css" autocomplete="off" />
          <span v-else class="truncate font-mono text-xs">_shared/{{ editing.path }}</span>
        </div>
        <Textarea v-model="text" class="min-h-64 resize-y whitespace-pre font-mono text-xs [tab-size:2]" rows="14" spellcheck="false" aria-label="File source" />
        <div class="flex items-center gap-2">
          <Button size="sm" :disabled="busy || !editing.path.trim() || (!editing.isNew && text === original)" @click="save">{{ busy ? 'Saving…' : 'Save' }}</Button>
          <Button size="sm" variant="ghost" @click="editing = null">Cancel</Button>
        </div>
      </div>

      <template v-else>
        <p v-if="loading && !files.length" class="text-sm text-muted-foreground">Loading…</p>
        <p v-else-if="!files.length" class="text-sm text-muted-foreground">
          Nothing shared yet.{{ canEdit ? ' Add a tokens file here, or use “Share files with workspace…” in an artifact’s menu to promote files it already has.' : '' }}
        </p>
        <ul v-else class="max-h-80 divide-y overflow-y-auto rounded-md border">
          <li v-for="f in files" :key="f.path" class="flex items-center gap-1 px-3 py-2">
            <div class="min-w-0 flex-1">
              <div class="truncate font-mono text-xs font-medium">{{ f.ref }}</div>
              <div class="text-xs text-muted-foreground">{{ size(f.size) }} · v{{ f.rev }} · {{ f.updatedBy }}</div>
            </div>
            <Button variant="ghost" size="icon" class="size-8" :aria-label="`Copy the link for ${f.ref}`" title="Copy the tag to use it" @click="copyRef(f)"><Copy /></Button>
            <Button v-if="canEdit && isText(f)" variant="outline" size="xs" @click="edit(f)">Edit</Button>
            <Button v-if="canEdit" variant="ghost" size="icon" class="size-8" :aria-label="`Remove ${f.ref}`" @click="remove(f)"><Trash2 /></Button>
          </li>
        </ul>
        <div v-if="canEdit" class="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" @click="startNew"><FilePlus2 />New file</Button>
          <Button size="sm" variant="outline" @click="upload?.click()"><Upload />Upload…</Button>
          <input ref="upload" type="file" multiple class="hidden" @change="picked">
        </div>
      </template>
      <Alert v-if="error" variant="destructive" role="alert"><AlertDescription>{{ error }}</AlertDescription></Alert>
    </DialogContent>
  </Dialog>
</template>
