<script setup lang="ts">
import type { CanvasOp } from '#shared/canvasOps'
import { Play, Plus, Trash2, Pencil } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

const props = defineProps<{ sel: { type: 'board' | 'note', id: string } | null, canvas: any, isCanvas: boolean, boardCount: number }>()
const emit = defineEmits<{ op: [op: CanvasOp], editContent: [path: string], play: [path: string] }>()

const board = computed(() => (props.sel?.type === 'board' ? props.canvas?.boards?.[props.sel.id] : null))
const note = computed(() => (props.sel?.type === 'note' ? props.canvas?.notes?.[props.sel.id] : null))
const kind = computed(() => note.value?.kind ?? 'sticky')
const FILLS = ['yellow', 'gray', 'red', 'orange', 'green', 'teal', 'blue', 'purple', 'pink', 'none']
const FILL_HEX: Record<string, string> = { yellow: '#fef3c7', gray: '#f1f1f1', red: '#fecaca', orange: '#fed7aa', green: '#bbf7d0', teal: '#99f6e4', blue: '#bfdbfe', purple: '#e9d5ff', pink: '#fbcfe8', none: 'transparent' }

const num = (e: Event) => Number((e.target as HTMLInputElement).value)
function patchBoard(patch: Record<string, unknown>) { if (props.sel) emit('op', { type: 'updateBoard', path: props.sel.id, patch } as CanvasOp) }
function patchNote(patch: Record<string, unknown>) { if (props.sel) emit('op', { type: 'updateNote', id: props.sel.id, patch } as CanvasOp) }
const confirmDelete = ref(false)
function removeBoard() {
  if (!props.sel) return
  emit('op', { type: 'removeBoard', path: props.sel.id })
}
function addBoard() {
  const xs = Object.values(props.canvas?.boards ?? {}).map((b: any) => (+b.x || 0) + (+b.w || 0))
  emit('op', { type: 'addBoard', title: 'Board', x: (xs.length ? Math.max(...xs) : 1280) + 120, y: 0, w: 1280, h: 800 })
}
</script>

<template>
  <div class="grid grid-cols-[minmax(0,1fr)] gap-4 text-[13px]">
    <template v-if="board && sel">
      <section class="grid gap-2">
        <h3 class="sec">Board</h3>
        <div class="grid gap-1.5"><Label>Name</Label><Input class="h-8" :model-value="board.title" @change="patchBoard({ title: ($event.target as HTMLInputElement).value })" /></div>
        <div class="flex flex-wrap gap-1.5">
          <Button size="xs" @click="emit('editContent', sel.id)"><Pencil />Edit content</Button>
          <Button size="xs" variant="outline" @click="emit('play', sel.id)"><Play />Play</Button>
          <Button size="xs" variant="outline" class="text-destructive" @click="confirmDelete = true"><Trash2 />Delete</Button>
        </div>
        <p class="hint">Drag the board to move it. Double-click it to edit what is inside.</p>
      </section>
      <section class="grid gap-2">
        <h3 class="sec">Frame</h3>
        <div class="grid grid-cols-2 gap-2">
          <div class="grid gap-1.5"><Label>X</Label><Input class="h-8" type="number" :model-value="board.x" @change="patchBoard({ x: num($event) })" /></div>
          <div class="grid gap-1.5"><Label>Y</Label><Input class="h-8" type="number" :model-value="board.y" @change="patchBoard({ y: num($event) })" /></div>
          <div class="grid gap-1.5"><Label>Width</Label><Input class="h-8" type="number" min="40" :model-value="board.w" @change="patchBoard({ w: num($event) })" /></div>
          <div class="grid gap-1.5"><Label>Height</Label><Input class="h-8" type="number" min="40" :model-value="board.h" @change="patchBoard({ h: num($event) })" /></div>
        </div>
        <Label class="font-normal"><Checkbox :model-value="!!board.is_interactive" @update:model-value="patchBoard({ is_interactive: !!$event })" />Working controls (can be used on the canvas)</Label>
        <Label class="font-normal"><Checkbox :model-value="board.expand === 'fill'" @update:model-value="patchBoard({ expand: $event ? 'fill' : null })" />Page: fills the window when opened</Label>
      </section>
      <AlertDialog v-model:open="confirmDelete">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the board “{{ board.title ?? sel.id }}”?</AlertDialogTitle>
            <AlertDialogDescription>Its file is removed from the current version. Older versions keep it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction @click="removeBoard">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </template>

    <template v-else-if="note && sel">
      <section class="grid gap-2">
        <h3 class="sec">{{ ({ sticky: 'Sticky note', text: 'Text', rect: 'Rectangle', oval: 'Oval', line: 'Line', arrow: 'Arrow', pen: 'Drawing', title1: 'Title' } as Record<string, string>)[kind] ?? 'Note' }}</h3>
        <div v-if="kind === 'sticky' || kind === 'text' || kind === 'title1'" class="grid gap-1.5"><Label>Text</Label><Textarea rows="3" :model-value="note.text" @change="patchNote({ text: ($event.target as HTMLTextAreaElement).value })" /></div>
        <ToggleGroup v-if="kind === 'sticky' || kind === 'rect' || kind === 'oval'" type="single" class="flex-wrap justify-start gap-1.5" aria-label="Fill" :model-value="note.fill ?? (kind === 'sticky' ? 'yellow' : 'none')" @update:model-value="(v) => v && patchNote({ fill: String(v) })">
          <ToggleGroupItem v-for="f in FILLS" :key="f" :value="f" size="sm" class="size-6 min-w-6 rounded-full border p-0 data-[state=on]:ring-2 data-[state=on]:ring-primary" :style="{ background: FILL_HEX[f] }" :title="f" :aria-label="`Fill ${f}`" />
        </ToggleGroup>
        <div v-if="kind !== 'sticky'" class="grid gap-1.5">
          <Label>{{ kind === 'text' ? 'Text colour' : 'Stroke colour' }}</Label>
          <div class="flex gap-1.5">
            <Input type="color" class="size-8 shrink-0 cursor-pointer p-0.5" :model-value="note.color ?? '#1c1b19'" @change="patchNote({ color: ($event.target as HTMLInputElement).value })" />
            <Input class="h-8" :model-value="note.color ?? '#1c1b19'" @change="patchNote({ color: ($event.target as HTMLInputElement).value })" />
          </div>
        </div>
        <div v-if="kind === 'text'" class="grid grid-cols-2 items-end gap-2">
          <div class="grid gap-1.5">
            <Label>Size</Label>
            <Select :model-value="note.size ?? 'm'" @update:model-value="(v) => patchNote({ size: String(v) })">
              <SelectTrigger size="sm" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="s">Small</SelectItem><SelectItem value="m">Medium</SelectItem><SelectItem value="l">Large</SelectItem><SelectItem value="xl">XL</SelectItem><SelectItem value="xxl">XXL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Label class="h-8 font-normal"><Checkbox :model-value="!!note.bold" @update:model-value="patchNote({ bold: !!$event })" />Bold</Label>
        </div>
        <div><Button size="xs" variant="outline" class="text-destructive" @click="emit('op', { type: 'deleteNote', id: sel.id })"><Trash2 />Delete</Button></div>
      </section>
      <section v-if="kind !== 'pen'" class="grid gap-2">
        <h3 class="sec">Frame</h3>
        <div class="grid grid-cols-2 gap-2">
          <div class="grid gap-1.5"><Label>X</Label><Input class="h-8" type="number" :model-value="note.x" @change="patchNote({ x: num($event) })" /></div>
          <div class="grid gap-1.5"><Label>Y</Label><Input class="h-8" type="number" :model-value="note.y" @change="patchNote({ y: num($event) })" /></div>
          <div class="grid gap-1.5"><Label>{{ kind === 'line' || kind === 'arrow' ? 'ΔX' : 'Width' }}</Label><Input class="h-8" type="number" :model-value="note.w" @change="patchNote({ w: num($event) })" /></div>
          <div v-if="kind !== 'text'" class="grid gap-1.5"><Label>{{ kind === 'line' || kind === 'arrow' ? 'ΔY' : 'Height' }}</Label><Input class="h-8" type="number" :model-value="note.h" @change="patchNote({ h: num($event) })" /></div>
        </div>
      </section>
    </template>

    <template v-else>
      <section class="grid gap-2">
        <h3 class="sec">Canvas</h3>
        <p v-if="isCanvas" class="hint">{{ boardCount }} board{{ boardCount === 1 ? '' : 's' }}. Pick a tool in the toolbar to add boards, notes and shapes, or select something to change it. <b>Double-click a board</b> to edit what is inside it.</p>
        <p v-else class="hint">This is a single page. Add a board to turn it into a canvas with several screens side by side.</p>
        <div><Button size="xs" @click="addBoard"><Plus />Add board</Button></div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.sec { margin: 0 0 2px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted-foreground); font-weight: 600; }
.hint { margin: 0; color: var(--muted-foreground); font-size: 12px; }
</style>
