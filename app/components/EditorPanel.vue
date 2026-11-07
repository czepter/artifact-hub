<script setup lang="ts">
import { CONTAINER_TAGS, type PaletteKind } from '#shared/palette'
import type { CanvasOp } from '#shared/canvasOps'
import type { EditSel } from '~/types'
import type { TreeNode } from './LayerTree.vue'
import { Minus, Plus, Undo2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const props = defineProps<{
  sel: EditSel | null
  status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  message: string
  canUndo: boolean
  note: string
  /** true while editing inside a board (focused board or a single page) */
  elementLevel: boolean
  tree: TreeNode | null
  canvasSel: { type: 'board' | 'note', id: string }[]
  /** Element trees of every board (for the canvas-wide layers list). */
  trees: Record<string, TreeNode>
  canvas: any
  isCanvas: boolean
  boardCount: number
  artifactId: string
  files: string[]
  activeBoard: string | null
  tweaks: { defs: Record<string, any> | null, values: Record<string, unknown> } | null
  tab: 'props' | 'code' | 'tweaks'
  dragMode: 'free' | 'flow'
  codeBusy: boolean
  codeError: string
}>()
const emit = defineEmits<{
  cmd: [c: Record<string, unknown>]
  add: [kind: PaletteKind]
  drag: [kind: PaletteKind, e: PointerEvent]
  undo: []
  done: []
  hover: [id: string | null]
  pickNote: [id: string]
  pickBoard: [path: string]
  pickElement: [p: { board: string, id: string }]
  canvasOp: [op: CanvasOp]
  canvasOps: [ops: CanvasOp[]]
  align: [mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom']
  distribute: [axis: 'x' | 'y']
  editContent: [path: string]
  play: [path: string]
  tweak: [values: Record<string, unknown>]
  codeApply: [p: { mode: 'element' | 'file', path: string, id: string | null, text: string }]
  exportBoard: [path: string]
  'update:tab': [tab: 'props' | 'code' | 'tweaks']
  'update:dragMode': [m: 'free' | 'flow']
}>()

const palette: { kind: PaletteKind, label: string }[] = [
  { kind: 'heading', label: 'Heading' }, { kind: 'text', label: 'Text' }, { kind: 'button', label: 'Button' }, { kind: 'link', label: 'Link' },
  { kind: 'image', label: 'Image' }, { kind: 'box', label: 'Box' }, { kind: 'divider', label: 'Divider' }, { kind: 'input', label: 'Input' },
]
const statusText = computed(() => ({ idle: '', dirty: 'Unsaved changes…', saving: 'Saving…', saved: 'Saved', error: props.message || 'Could not save' }[props.status]))

// ---- layers ----------------------------------------------------------------------------------------------
const open = ref(new Set<string>())
function pathTo(node: TreeNode | null, id: string | null, acc: string[] = []): string[] | null {
  if (!node || !id) return null
  if (node.id === id) return acc
  for (const k of node.kids) { const r = pathTo(k, id, node.id ? [...acc, node.id] : acc); if (r) return r }
  return null
}
watch(() => [props.sel?.id, props.tree], () => {
  const p = pathTo(props.tree, props.sel?.id ?? null)
  if (!p) return
  const next = new Set(open.value); p.forEach(i => next.add(i)); open.value = next
}, { immediate: true })
function toggle(id: string) { const n = new Set(open.value); if (n.has(id)) n.delete(id); else n.add(id); open.value = n }
// New nodes in the first levels open themselves once; after that the user's own expand/collapse is respected.
const seeded = new Set<string>()
function seed(node: TreeNode | null, depth: number, add: Set<string>) {
  if (!node) return
  if (node.id && node.kids.length && depth < 3 && !seeded.has(node.id)) { seeded.add(node.id); add.add(node.id) }
  for (const k of node.kids) seed(k, depth + 1, add)
}
watch(() => props.tree, (t) => {
  const add = new Set<string>(); seed(t, 0, add)
  if (add.size) { const n = new Set(open.value); add.forEach(i => n.add(i)); open.value = n }
}, { immediate: true })
const layersOpen = ref(true)
</script>

<template>
  <div class="panel" @keydown.stop>
    <header class="top">
      <strong>Edit</strong>
      <span class="status" :class="status" role="status">{{ statusText }}</span>
      <span class="grow" />
      <Button size="xs" variant="outline" :disabled="!canUndo" title="Undo last change (Ctrl+Z)" @click="emit('undo')"><Undo2 />Undo</Button>
      <Button size="xs" @click="emit('done')">Done</Button>
    </header>
    <Tabs :model-value="tab" @update:model-value="(v) => emit('update:tab', v as 'props' | 'code' | 'tweaks')">
      <TabsList class="tabs w-full">
        <TabsTrigger v-for="t in ([['props', 'Properties'], ['code', 'Code'], ['tweaks', 'Tweaks']] as const)" :key="t[0]" :value="t[0]">{{ t[1] }}</TabsTrigger>
      </TabsList>
    </Tabs>

    <p v-if="note" class="note" role="status">{{ note }}</p>

    <div v-show="tab === 'props'" class="body">
      <template v-if="elementLevel">
        <section>
          <h3>Add</h3>
          <div class="palette">
            <Button
              v-for="p in palette"
              :key="p.kind"
              variant="outline"
              size="xs"
              class="grab"
              :title="`Drag ${p.label.toLowerCase()} onto the page, or click to add`"
              @pointerdown="emit('drag', p.kind, $event)"
              @click="$event.detail === 0 && emit('add', p.kind)"
            >{{ p.label }}</Button>
          </div>
          <p class="hint">{{ dragMode === 'free' ? 'Drag onto the board: it lands exactly where you let go.' : 'Drag onto the board: a line shows where it lands in the flow, a dashed box means inside.' }} Or click to add {{ sel ? (CONTAINER_TAGS.has(sel.tag) ? `inside the selected <${sel.tag}>` : 'after the selected element') : 'at the end of the page' }}.</p>
          <div class="flex items-center gap-2">
            <span class="flex-none text-xs text-muted-foreground">Dragging</span>
            <ToggleGroup type="single" variant="outline" class="flex-1" aria-label="What dragging does" :model-value="dragMode" @update:model-value="(v) => v && emit('update:dragMode', v as 'free' | 'flow')">
              <ToggleGroupItem value="free" size="sm" class="flex-1 text-xs" title="Dragging moves an element anywhere (Alt reorders instead)">Moves freely</ToggleGroupItem>
              <ToggleGroupItem value="flow" size="sm" class="flex-1 text-xs" title="Dragging reorders elements in the page flow (Alt moves freely instead)">Reorders</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </section>

        <section v-if="tree">
          <Collapsible v-model:open="layersOpen">
            <CollapsibleTrigger as-child>
              <Button variant="ghost" size="xs" class="sec w-full justify-between px-0 hover:bg-transparent"><h3>Layers</h3><component :is="layersOpen ? Minus : Plus" class="size-3" /></Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div class="tree mt-2 max-h-56 overflow-auto rounded-lg border bg-background p-1">
                <ul role="tree" aria-label="Layers" class="p-0">
                  <LayerTree :node="tree" :depth="0" :selected-id="sel?.id ?? null" :open="open" @select="emit('cmd', { cmd: 'select', id: $event })" @hover="emit('hover', $event)" @toggle="toggle" />
                </ul>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>

        <ElementProps v-if="sel" :sel="sel" @cmd="emit('cmd', $event)" @export-board="activeBoard && emit('exportBoard', activeBoard)" />
        <p v-else class="hint empty">Click an element on the board to edit it, or pick one in Layers. Double-click text to retype it. Esc deselects.</p>
      </template>
      <template v-else>
        <section>
          <h3>Layers</h3>
          <CanvasLayers
            :canvas="canvas"
            :trees="trees"
            :canvas-sel="canvasSel"
            :sel-element="sel ? { board: sel.board, id: sel.id } : null"
            @pick-note="emit('pickNote', $event)"
            @pick-board="emit('pickBoard', $event)"
            @pick-element="emit('pickElement', $event)"
          />
        </section>
      <BoardPanel :sel="canvasSel" :canvas="canvas" :is-canvas="isCanvas" :board-count="boardCount" @ops="emit('canvasOps', $event)" @align="emit('align', $event)" @distribute="emit('distribute', $event)" @edit-content="emit('editContent', $event)" @play="emit('play', $event)" />
      </template>
      <section v-if="!isCanvas && elementLevel">
        <h3>Canvas</h3>
        <p class="hint">Turn this page into a canvas with several boards side by side.</p>
        <Button size="xs" variant="outline" class="w-fit" @click="emit('canvasOp', { type: 'addBoard', title: 'Board', x: 1400, y: 0, w: 1280, h: 800 })"><Plus />Add a board</Button>
      </section>
    </div>

    <div v-show="tab === 'code'" class="body">
      <CodePanel :artifact-id="artifactId" :board="activeBoard" :element-id="elementLevel ? (sel?.id ?? null) : null" :files="files" :busy="codeBusy" :error="codeError" @apply="emit('codeApply', $event)" />
    </div>

    <div v-show="tab === 'tweaks'" class="body">
      <TweaksPanel :board="activeBoard" :defs="tweaks?.defs ?? null" :values="tweaks?.values ?? {}" @change="emit('tweak', $event)" />
    </div>
  </div>
</template>

<style scoped>
.panel { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-content: start; font-size: 13px; min-width: 0; }
.top { display: flex; align-items: center; gap: 8px; position: sticky; top: -10px; background: var(--panel); padding: 10px 0 8px; z-index: 3; margin-top: -10px; }
.tabs { position: sticky; top: 36px; z-index: 3; }
.body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; min-width: 0; }
.body :deep(section) { min-width: 0; }
.grow { flex: 1; }
.status { font-size: 12px; color: var(--muted); }
.status.saved::before, .status.saving::before, .status.dirty::before, .status.error::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; background: #3a8f5c; }
.status.saving::before, .status.dirty::before { background: #d49a1c; }
.status.error { color: #b3261e; } .status.error::before { background: #b3261e; }
section { display: grid; gap: 8px; }
h3 { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 0; font-weight: 600; }
.sec { color: var(--muted); }
.palette { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.grab { cursor: grab; touch-action: none; user-select: none; } .grab:active { cursor: grabbing; }
.note { margin: 0; padding: 8px 10px; background: var(--hover); border-radius: 8px; }
.hint { margin: 0; color: var(--muted); font-size: 12px; } .hint.empty { padding: 4px 2px; }
</style>
