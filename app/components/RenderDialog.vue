<script setup lang="ts">
import { Download, ImageIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

// Export as an image or document: the server draws the artifact (GET /api/artifacts/:id/render), this dialog
// only picks the options, previews the result and downloads it.
const props = defineProps<{ artifactId: string, version: number, boards: { path: string, title: string }[] }>()
const open = defineModel<boolean>('open', { default: false })

const FORMATS = [['png', 'PNG'], ['svg', 'SVG'], ['webp', 'WebP'], ['jpeg', 'JPEG'], ['xml', 'XML']] as const
const format = ref<'png' | 'svg' | 'webp' | 'jpeg' | 'xml'>('png')
const scale = ref('2')
const board = ref('')
const background = ref('canvas')
const theme = ref('light')
const raster = computed(() => ['png', 'webp', 'jpeg'].includes(format.value))

function query(extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ format: format.value, version: String(props.version), theme: theme.value, background: format.value === 'jpeg' && background.value === 'transparent' ? 'white' : background.value, ...extra })
  if (board.value) q.set('board', board.value)
  if (format.value !== 'xml') q.set('scale', scale.value)
  return q.toString()
}
const url = computed(() => `/api/artifacts/${props.artifactId}/render?${query()}`)
const downloadUrl = computed(() => `/api/artifacts/${props.artifactId}/render?${query({ download: '1' })}`)
// The preview is a small raster of the same settings (an svg or xml preview would be as heavy as the real thing).
const previewUrl = computed(() => `/api/artifacts/${props.artifactId}/render?${new URLSearchParams({ format: 'png', version: String(props.version), theme: theme.value, background: background.value === 'transparent' ? 'transparent' : background.value, max: '720', ...(board.value ? { board: board.value } : {}) })}`)

const state = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const note = ref('')
const preview = ref('')
let seq = 0
watch([open, previewUrl, format], async () => {
  if (!open.value) return
  const mine = ++seq
  state.value = 'loading'; note.value = ''
  try {
    const r = await fetch(previewUrl.value)
    if (mine !== seq) return
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.statusMessage || `HTTP ${r.status}`)
    const boards = r.headers.get('x-render-boards')
    note.value = boards === 'outline' ? 'This server has no headless browser, so board HTML is shown as a text outline.' : ''
    preview.value = URL.createObjectURL(await r.blob())
    state.value = 'ready'
  } catch (e: any) {
    if (mine === seq) { state.value = 'error'; note.value = e?.message || 'Could not render' }
  }
}, { immediate: true })
watch(preview, (_, old) => { if (old) URL.revokeObjectURL(old) })
onBeforeUnmount(() => { if (preview.value) URL.revokeObjectURL(preview.value) })
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Export as image</DialogTitle>
        <DialogDescription>Drawn on the server from the live version: shapes, notes and arrows as vectors, boards as pictures.</DialogDescription>
      </DialogHeader>
      <div class="grid gap-4 sm:grid-cols-[1fr_16rem]">
        <div class="grid min-h-48 place-items-center overflow-hidden rounded-lg border bg-muted/40 p-2" aria-live="polite">
          <img v-if="state === 'ready' || (state === 'loading' && preview)" :src="preview" alt="Preview of the export" class="max-h-72 max-w-full rounded-sm object-contain" :class="{ 'opacity-50': state === 'loading' }">
          <p v-else-if="state === 'error'" class="px-3 text-center text-sm text-destructive">{{ note }}</p>
          <ImageIcon v-else class="size-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <div class="grid content-start gap-3 text-sm">
          <div class="grid gap-1.5">
            <Label>Format</Label>
            <ToggleGroup v-model="format" type="single" variant="outline" size="sm" class="flex-wrap justify-start" aria-label="Format" @update:model-value="(v) => { if (!v) format = 'png' }">
              <ToggleGroupItem v-for="f in FORMATS" :key="f[0]" :value="f[0]" class="px-2.5">{{ f[1] }}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div v-if="format !== 'xml'" class="grid gap-1.5">
            <Label>Scale</Label>
            <ToggleGroup v-model="scale" type="single" variant="outline" size="sm" class="justify-start" aria-label="Scale" @update:model-value="(v) => { if (!v) scale = '1' }">
              <ToggleGroupItem v-for="s in ['1', '2', '3', '4']" :key="s" :value="s" class="px-2.5">{{ s }}×</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div v-if="boards.length > 1" class="grid gap-1.5">
            <Label for="render-board">Content</Label>
            <Select :model-value="board || '*'" @update:model-value="(v) => board = v === '*' ? '' : String(v)">
              <SelectTrigger id="render-board" class="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="*">Whole canvas</SelectItem>
                <SelectItem v-for="b in boards" :key="b.path" :value="b.path">{{ b.title || b.path }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="format !== 'xml'" class="grid gap-1.5">
            <Label>Background</Label>
            <ToggleGroup v-model="background" type="single" variant="outline" size="sm" class="flex-wrap justify-start" aria-label="Background" @update:model-value="(v) => { if (!v) background = 'canvas' }">
              <ToggleGroupItem value="canvas" class="px-2.5">Canvas</ToggleGroupItem>
              <ToggleGroupItem value="white" class="px-2.5">White</ToggleGroupItem>
              <ToggleGroupItem v-if="format !== 'jpeg'" value="transparent" class="px-2.5">None</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div class="grid gap-1.5">
            <Label>Theme</Label>
            <ToggleGroup v-model="theme" type="single" variant="outline" size="sm" class="justify-start" aria-label="Theme" @update:model-value="(v) => { if (!v) theme = 'light' }">
              <ToggleGroupItem value="light" class="px-2.5">Light</ToggleGroupItem>
              <ToggleGroupItem value="dark" class="px-2.5">Dark</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </div>
      <p v-if="note && state !== 'error'" class="text-xs text-muted-foreground">{{ note }}</p>
      <DialogFooter>
        <Button variant="outline" @click="open = false">Close</Button>
        <Button as-child><a :href="downloadUrl" download><Download />Download {{ FORMATS.find(f => f[0] === format)![1] }}<span v-if="raster" class="sr-only"> at {{ scale }}×</span></a></Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
