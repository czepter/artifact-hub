<script setup lang="ts">
// Copy or move boards (or the whole canvas) into another artifact. The server does the work (POST /api/artifacts/:id/transfer-boards):
// stylesheets, scripts and images the boards need travel along, nothing in the target is overwritten.
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

interface Result { mode: 'copy' | 'move', target: string, boards: { from: string, to: string }[], files: string[], notes: number, warnings: string[] }
interface Row { id: string, title: string, workspace_id: string }
const props = defineProps<{ artifactId: string, boards: string[], titles: Record<string, string>, mode: 'copy' | 'move' }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ done: [Result] }>()

const { list: workspaces } = useWorkspaces()
const mode = ref<'copy' | 'move'>(props.mode)
const target = ref('')
const rows = ref<Row[]>([])
const busy = ref(false)
const error = ref('')
const result = ref<Result | null>(null)
const whole = computed(() => !props.boards.length)
const count = computed(() => (whole.value ? Object.keys(props.titles).length : props.boards.length))
const what = computed(() => (whole.value ? `the whole canvas (${count.value} board${count.value === 1 ? '' : 's'} and its notes)` : props.boards.length === 1 ? `“${props.titles[props.boards[0]!] ?? props.boards[0]}”` : `${props.boards.length} boards`))
const label = (r: Row) => { const w = workspaces.value.find(x => x.id === r.workspace_id); return w && workspaces.value.length > 1 ? `${r.title} · ${w.name}` : r.title }
const targetTitle = computed(() => rows.value.find(r => r.id === (result.value?.target ?? target.value))?.title ?? 'the other artifact')

onMounted(async () => {
  rows.value = (await $fetch<Row[]>('/api/artifacts').catch(() => [] as Row[])).filter(r => r.id !== props.artifactId)
})

async function run() {
  busy.value = true; error.value = ''
  try {
    result.value = await $fetch<Result>(`/api/artifacts/${props.artifactId}/transfer-boards`, { method: 'POST', body: { target: target.value, mode: mode.value, ...(whole.value ? {} : { boards: props.boards }) } })
    emit('done', result.value)
  } catch (e: any) { error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Could not transfer the boards' } finally { busy.value = false }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ result ? (result.mode === 'move' ? 'Moved' : 'Copied') : 'Copy or move to another artifact' }}</DialogTitle>
        <DialogDescription v-if="!result">
          {{ mode === 'move' ? 'Moves' : 'Copies' }} {{ what }} with the stylesheets, scripts and images it needs. Boards keep their layout and are placed after the target’s own boards; nothing there is overwritten.
        </DialogDescription>
      </DialogHeader>

      <template v-if="result">
        <p class="text-sm">
          {{ result.boards.length }} board{{ result.boards.length === 1 ? '' : 's' }}<template v-if="result.notes"> and {{ result.notes }} note{{ result.notes === 1 ? '' : 's' }}</template>
          {{ result.mode === 'move' ? 'moved to' : 'copied to' }} <NuxtLink :to="`/a/${result.target}`" class="font-medium underline underline-offset-2">{{ targetTitle }}</NuxtLink>.
        </p>
        <Alert v-for="w in result.warnings" :key="w" role="status"><AlertDescription>{{ w }}</AlertDescription></Alert>
        <p v-if="result.mode === 'move'" class="text-xs text-muted-foreground">Comments on the boards stay with this artifact.</p>
        <DialogFooter><Button variant="outline" @click="open = false">Close</Button><Button as-child><NuxtLink :to="`/a/${result.target}`" @click="open = false">Open {{ targetTitle }}</NuxtLink></Button></DialogFooter>
      </template>

      <template v-else>
        <ToggleGroup type="single" variant="outline" class="w-full" aria-label="Copy or move" :model-value="mode" @update:model-value="(v) => v && (mode = v as 'copy' | 'move')">
          <ToggleGroupItem value="copy" class="flex-1" size="sm">Copy</ToggleGroupItem>
          <ToggleGroupItem value="move" class="flex-1" size="sm">Move</ToggleGroupItem>
        </ToggleGroup>
        <Select v-model="target">
          <SelectTrigger class="w-full" aria-label="Target artifact"><SelectValue placeholder="Choose the target artifact" /></SelectTrigger>
          <SelectContent><SelectItem v-for="r in rows" :key="r.id" :value="r.id">{{ label(r) }}</SelectItem></SelectContent>
        </Select>
        <p v-if="!rows.length" class="text-sm text-muted-foreground">There is no other artifact yet.</p>
        <Alert v-if="error" variant="destructive" role="alert"><AlertDescription>{{ error }}</AlertDescription></Alert>
        <DialogFooter>
          <Button variant="ghost" @click="open = false">Cancel</Button>
          <Button :disabled="busy || !target" @click="run">{{ busy ? 'Working…' : mode === 'move' ? 'Move' : 'Copy' }}</Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
