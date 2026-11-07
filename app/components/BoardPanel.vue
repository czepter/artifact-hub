<script setup lang="ts">
import type { CanvasOp } from '#shared/canvasOps'
import { boardKey, deleteOps, itemsFromCanvas, lockOps, noteKey } from '#shared/canvasItemOps'
import { Lock, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceBetween, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceBetween, Play, Plus, Trash2, Pencil } from '@lucide/vue'
import { ButtonGroup } from '@/components/ui/button-group'
import type { AlignMode } from '#shared/canvasGeometry'
import { themeInk } from '~/utils/canvasView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

const props = defineProps<{ sel: { type: 'board' | 'note', id: string }[], canvas: any, isCanvas: boolean, boardCount: number }>()
const emit = defineEmits<{ align: [mode: AlignMode], distribute: [axis: 'x' | 'y'], ops: [ops: CanvasOp[]], editContent: [path: string], play: [path: string] }>()

// One selected item gets its own controls; several get a summary with the actions that apply to all.
const one = computed(() => (props.sel.length === 1 ? props.sel[0]! : null))
const board = computed(() => (one.value?.type === 'board' ? props.canvas?.boards?.[one.value.id] : null))
const note = computed(() => (one.value?.type === 'note' ? props.canvas?.notes?.[one.value.id] : null))
const many = computed(() => props.sel.length > 1)
const manyLabel = computed(() => { const b = props.sel.filter(s => s.type === 'board').length, n = props.sel.length - b; return [b && `${b} board${b === 1 ? '' : 's'}`, n && `${n} note${n === 1 ? '' : 's'}`].filter(Boolean).join(' and ') })
const emitOp = (op: CanvasOp) => emit('ops', [op])
const unlock = () => { if (one.value) emit('ops', lockOps([{ key: one.value.type === 'board' ? boardKey(one.value.id) : noteKey(one.value.id) }], false)) }
/** Selected notes for the style panel (locked ones are left out: they are not restyled). */
const selNotes = computed(() => props.sel.filter(s => s.type === 'note' && props.canvas?.notes?.[s.id] && !props.canvas.notes[s.id].locked).map(s => ({ id: s.id, kind: props.canvas.notes[s.id].kind ?? 'sticky', note: props.canvas.notes[s.id] })))
const ALIGN: { mode: AlignMode, label: string, icon: any }[] = [
  { mode: 'left', label: 'Align left', icon: AlignStartVertical }, { mode: 'hcenter', label: 'Align horizontal centres', icon: AlignCenterVertical }, { mode: 'right', label: 'Align right', icon: AlignEndVertical },
  { mode: 'top', label: 'Align top', icon: AlignStartHorizontal }, { mode: 'vcenter', label: 'Align vertical centres', icon: AlignCenterHorizontal }, { mode: 'bottom', label: 'Align bottom', icon: AlignEndHorizontal },
]
const selItems = computed(() => itemsFromCanvas(props.canvas, props.sel))
const movable = computed(() => selItems.value.filter(i => !i.locked).length)
function removeSelection() {
  const locked = (s: { type: string, id: string }) => !!(s.type === 'board' ? props.canvas?.boards?.[s.id] : props.canvas?.notes?.[s.id])?.locked
  emit('ops', deleteOps(props.sel.map(s => ({ key: s.type === 'board' ? boardKey(s.id) : noteKey(s.id), locked: locked(s) }))))
}
const kind = computed(() => note.value?.kind ?? 'sticky')
const FILLS = ['yellow', 'gray', 'red', 'orange', 'green', 'teal', 'blue', 'purple', 'pink', 'none']

const num = (e: Event) => Number((e.target as HTMLInputElement).value)
function patchBoard(patch: Record<string, unknown>) { if (one.value) emitOp({ type: 'updateBoard', path: one.value.id, patch } as CanvasOp) }
function patchNote(patch: Record<string, unknown>) { if (one.value) emitOp({ type: 'updateNote', id: one.value.id, patch } as CanvasOp) }
const ink = themeInk()
const confirmDelete = ref(false)
const confirmDeleteMany = ref(false)
function removeBoard() {
  if (one.value) emitOp({ type: 'removeBoard', path: one.value.id })
}
function addBoard() {
  const xs = Object.values(props.canvas?.boards ?? {}).map((b: any) => (+b.x || 0) + (+b.w || 0))
  emitOp({ type: 'addBoard', title: 'Board', x: (xs.length ? Math.max(...xs) : 1280) + 120, y: 0, w: 1280, h: 800 })
}
</script>

<template>
  <div class="grid grid-cols-[minmax(0,1fr)] gap-4 text-[13px]">
    <template v-if="board && one">
      <div v-if="board.locked" class="lockbar" role="status"><Lock class="size-3.5" aria-hidden="true" /><span>Locked</span><Button size="xs" variant="outline" @click="unlock">Unlock</Button></div>
      <fieldset :disabled="!!board.locked" class="fs">
      <section class="grid gap-2">
        <h3 class="sec">Board</h3>
        <div class="grid gap-1.5"><Label>Name</Label><Input class="h-8" :model-value="board.title" @change="patchBoard({ title: ($event.target as HTMLInputElement).value })" /></div>
        <div class="flex flex-wrap gap-1.5">
          <Button size="xs" @click="emit('editContent', one.id)"><Pencil />Edit content</Button>
          <Button size="xs" variant="outline" @click="emit('play', one.id)"><Play />Play</Button>
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
            <AlertDialogTitle>Delete the board “{{ board.title ?? one.id }}”?</AlertDialogTitle>
            <AlertDialogDescription>Its file is removed from the current version. Older versions keep it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction @click="removeBoard">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </fieldset>
    </template>

    <template v-else-if="note && one">
      <div v-if="note.locked" class="lockbar" role="status"><Lock class="size-3.5" aria-hidden="true" /><span>Locked</span><Button size="xs" variant="outline" @click="unlock">Unlock</Button></div>
      <fieldset :disabled="!!note.locked" class="fs">
      <section class="grid gap-2">
        <h3 class="sec">{{ ({ sticky: 'Sticky note', text: 'Text', rect: 'Rectangle', oval: 'Oval', line: 'Line', arrow: 'Arrow', pen: 'Drawing', title1: 'Title' } as Record<string, string>)[kind] ?? 'Note' }}</h3>
        <div v-if="kind === 'sticky' || kind === 'text' || kind === 'title1'" class="grid gap-1.5"><Label>Text</Label><Textarea rows="3" :model-value="note.text" @change="patchNote({ text: ($event.target as HTMLTextAreaElement).value })" /></div>
        <ToggleGroup v-if="kind === 'sticky'" type="single" class="flex-wrap justify-start gap-1.5" aria-label="Fill" :model-value="note.fill ?? (kind === 'sticky' ? 'yellow' : 'none')" @update:model-value="(v) => v && patchNote({ fill: String(v) })">
          <ToggleGroupItem v-for="f in FILLS" :key="f" :value="f" size="sm" class="size-6 min-w-6 rounded-full border p-0 data-[state=on]:ring-2 data-[state=on]:ring-primary" :style="{ background: fillOf(f).bg }" :title="f" :aria-label="`Fill ${f}`" />
        </ToggleGroup>
        <div v-if="kind === 'text'" class="grid gap-1.5">
          <Label>Text colour</Label>
          <div class="flex gap-1.5">
            <Input type="color" class="size-8 shrink-0 cursor-pointer p-0.5" :model-value="note.color ?? ink" @change="patchNote({ color: ($event.target as HTMLInputElement).value })" />
            <Input class="h-8" :model-value="note.color ?? ink" @change="patchNote({ color: ($event.target as HTMLInputElement).value })" />
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
        <div><Button size="xs" variant="outline" class="text-destructive" @click="emitOp({ type: 'deleteNote', id: one.id })"><Trash2 />Delete</Button></div>
      </section>
      <ShapeStylePanel :notes="selNotes" @ops="emit('ops', $event)" />
      <p v-if="kind === 'arrow' && note.bind" class="hint">Attached to {{ [note.bind.start && 'its start', note.bind.end && 'its end'].filter(Boolean).join(' and ') }}: it follows what it is attached to. Drag an end away to detach it.</p>
      <section v-else-if="kind !== 'pen'" class="grid gap-2">
        <h3 class="sec">Frame</h3>
        <div class="grid grid-cols-2 gap-2">
          <div class="grid gap-1.5"><Label>X</Label><Input class="h-8" type="number" :model-value="note.x" @change="patchNote({ x: num($event) })" /></div>
          <div class="grid gap-1.5"><Label>Y</Label><Input class="h-8" type="number" :model-value="note.y" @change="patchNote({ y: num($event) })" /></div>
          <div class="grid gap-1.5"><Label>{{ kind === 'line' || kind === 'arrow' ? 'ΔX' : 'Width' }}</Label><Input class="h-8" type="number" :model-value="note.w" @change="patchNote({ w: num($event) })" /></div>
          <div v-if="kind !== 'text'" class="grid gap-1.5"><Label>{{ kind === 'line' || kind === 'arrow' ? 'ΔY' : 'Height' }}</Label><Input class="h-8" type="number" :model-value="note.h" @change="patchNote({ h: num($event) })" /></div>
        </div>
      </section>
      </fieldset>
    </template>

    <template v-else-if="many">
      <section class="grid gap-2">
        <h3 class="sec">{{ sel.length }} items</h3>
        <p class="hint">{{ manyLabel }} selected. Drag to move them together, or use a handle to resize them as a group. Shift-click adds or removes one.</p>
        <ShapeStylePanel :notes="selNotes" @ops="emit('ops', $event)" />
        <h4 class="sub">Align</h4>
        <div class="flex flex-wrap gap-2">
          <ButtonGroup>
            <Button v-for="a in ALIGN.slice(0, 3)" :key="a.mode" size="icon-xs" variant="outline" :title="a.label" :aria-label="a.label" :disabled="movable < 2" @click="emit('align', a.mode)"><component :is="a.icon" /></Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button v-for="a in ALIGN.slice(3)" :key="a.mode" size="icon-xs" variant="outline" :title="a.label" :aria-label="a.label" :disabled="movable < 2" @click="emit('align', a.mode)"><component :is="a.icon" /></Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button size="icon-xs" variant="outline" title="Distribute horizontally" aria-label="Distribute horizontally" :disabled="movable < 3" @click="emit('distribute', 'x')"><AlignHorizontalSpaceBetween /></Button>
            <Button size="icon-xs" variant="outline" title="Distribute vertically" aria-label="Distribute vertically" :disabled="movable < 3" @click="emit('distribute', 'y')"><AlignVerticalSpaceBetween /></Button>
          </ButtonGroup>
        </div>
        <div><Button size="xs" variant="outline" class="text-destructive" @click="confirmDeleteMany = true"><Trash2 />Delete all</Button></div>
      </section>
      <AlertDialog v-model:open="confirmDeleteMany">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {{ sel.length }} items?</AlertDialogTitle>
            <AlertDialogDescription>{{ manyLabel }}. Board files are removed from the current version. Older versions keep them.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction @click="removeSelection">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
.fs { display: grid; gap: 16px; min-width: 0; margin: 0; padding: 0; border: 0; }
.lockbar { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted-foreground); }
.lockbar span { flex: 1; }
.sub { margin: 0; font-size: 12px; font-weight: 500; }
.hint { margin: 0; color: var(--muted-foreground); font-size: 12px; }
</style>
