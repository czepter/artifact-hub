<script setup lang="ts">
// Promote files of this artifact into its workspace's shared files, so other boards can link them as `_shared/<path>`.
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const props = defineProps<{ artifactId: string, workspaceName: string, files: string[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ shared: [refs: string[]] }>()

// Boards and the canvas file belong to the artifact; styles, scripts, fonts and images are what gets shared.
const candidates = computed(() => props.files.filter(f => f !== 'canvas.json' && !f.startsWith('_shared/') && !/\.html?$/i.test(f)))
const picked = ref<string[]>([])
const busy = ref(false)
const error = ref('')
const done = ref<string[]>([])
watch(open, (o) => { if (o) { picked.value = []; error.value = ''; done.value = [] } })
const toggle = (f: string, on: boolean | 'indeterminate') => { picked.value = on === true ? [...picked.value, f] : picked.value.filter(x => x !== f) }

async function share() {
  busy.value = true; error.value = ''
  try {
    const r = await $fetch<{ shared: { ref: string }[] }>(`/api/artifacts/${props.artifactId}/share-file`, { method: 'POST', body: { files: picked.value.map(path => ({ path })) } })
    done.value = r.shared.map(s => s.ref)
    emit('shared', done.value)
  } catch (e: any) { error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Could not share the files' } finally { busy.value = false }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Share files with “{{ workspaceName }}”</DialogTitle>
        <DialogDescription>Copies the files into the workspace’s shared files. Other boards can then link them as <code class="rounded bg-muted px-1 py-0.5 text-xs">_shared/&lt;path&gt;</code>; this artifact keeps its own copy until its boards are pointed there.</DialogDescription>
      </DialogHeader>
      <template v-if="done.length">
        <Alert role="status"><AlertDescription>Shared: <span class="font-mono text-xs">{{ done.join(', ') }}</span></AlertDescription></Alert>
        <DialogFooter><Button @click="open = false">Done</Button></DialogFooter>
      </template>
      <template v-else>
        <p v-if="!candidates.length" class="text-sm text-muted-foreground">This artifact has no stylesheets, scripts, fonts or images to share yet.</p>
        <ul v-else class="max-h-72 divide-y overflow-y-auto rounded-md border">
          <li v-for="f in candidates" :key="f">
            <label class="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm">
              <Checkbox :model-value="picked.includes(f)" @update:model-value="toggle(f, $event)" />
              <span class="truncate font-mono text-xs">{{ f }}</span>
            </label>
          </li>
        </ul>
        <Alert v-if="error" variant="destructive" role="alert"><AlertDescription>{{ error }}</AlertDescription></Alert>
        <DialogFooter>
          <Button variant="ghost" @click="open = false">Cancel</Button>
          <Button :disabled="busy || !picked.length" @click="share">{{ busy ? 'Sharing…' : `Share ${picked.length || ''} file${picked.length === 1 ? '' : 's'}` }}</Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
