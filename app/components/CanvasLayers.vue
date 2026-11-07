<script setup lang="ts">
import type { TreeNode } from './LayerTree.vue'
import { ChevronDown, ChevronRight } from '@lucide/vue'
import { Button } from '@/components/ui/button'

// Everything on the canvas in one tree, like Claude's layers panel: notes and shapes, then every board that
// expands into its own element tree. Picking an element opens that board for editing and selects it.
const props = defineProps<{
  canvas: any
  trees: Record<string, TreeNode>
  canvasSel: { type: 'board' | 'note', id: string }[]
  selElement: { board: string, id: string } | null
}>()
const emit = defineEmits<{ pickNote: [id: string], pickBoard: [path: string], pickElement: [p: { board: string, id: string }] }>()

const KIND_LABEL: Record<string, string> = { sticky: 'Note', text: 'Text', title1: 'Title', rect: 'Rectangle', oval: 'Oval', line: 'Line', arrow: 'Arrow', pen: 'Drawing', image: 'Picture' }
const KIND_ICON: Record<string, string> = { sticky: '▤', text: 'T', title1: 'T', rect: '▢', oval: '◯', line: '╱', arrow: '↗', pen: '✎', image: '▣' }

const notes = computed(() => Object.entries(props.canvas?.notes ?? {}).map(([id, n]: [string, any]) => {
  const kind = n.kind ?? 'sticky'
  const text = String(n.text ?? '').replace(/\s+/g, ' ').trim()
  return { id, kind, label: KIND_LABEL[kind] ?? 'Note', text: text.length > 30 ? text.slice(0, 30) + '…' : text, icon: KIND_ICON[kind] ?? '▤' }
}))
const boards = computed(() => {
  const c = props.canvas
  const order: string[] = Array.isArray(c?.order) ? c.order : Object.keys(c?.boards ?? {})
  const rest = Object.keys(c?.boards ?? {}).filter(p => !order.includes(p))
  return [...order, ...rest].filter(p => c?.boards?.[p]).map(p => ({ path: p, title: c.boards[p].title || p }))
})

// Per-board open state (element ids repeat between boards, so each board has its own set).
const openBoards = ref(new Set<string>())
const openEls = reactive<Record<string, Set<string>>>({})
const seeded = new Set<string>()
function seed(board: string, node: TreeNode | undefined, depth: number, add: Set<string>) {
  if (!node) return
  const key = board + '/' + node.id
  if (node.id && node.kids.length && depth < 2 && !seeded.has(key)) { seeded.add(key); add.add(node.id) }
  for (const k of node.kids) seed(board, k, depth + 1, add)
}
watch(() => props.trees, (t) => {
  for (const [board, tree] of Object.entries(t)) {
    const add = new Set<string>(); seed(board, tree, 0, add)
    if (add.size) { const n = new Set(openEls[board] ?? []); add.forEach(i => n.add(i)); openEls[board] = n }
  }
}, { immediate: true, deep: false })
// The board holding the current selection is open.
watch(() => [props.canvasSel, props.selElement?.board], () => {
  const b = props.canvasSel.find(s => s.type === 'board')?.id ?? props.selElement?.board
  if (b && !openBoards.value.has(b)) openBoards.value = new Set([...openBoards.value, b])
}, { immediate: true })

const isSel = (type: 'board' | 'note', id: string) => props.canvasSel.some(s => s.type === type && s.id === id)
function toggleBoard(path: string) { const n = new Set(openBoards.value); if (n.has(path)) n.delete(path); else n.add(path); openBoards.value = n }
function toggleEl(board: string, id: string) { const n = new Set(openEls[board] ?? []); if (n.has(id)) n.delete(id); else n.add(id); openEls[board] = n }
const emptyOpen = new Set<string>()
</script>

<template>
  <ul class="cl" role="tree" aria-label="Canvas layers">
    <li v-for="n in notes" :key="n.id" role="treeitem" :aria-selected="isSel('note', n.id)">
      <div class="row" :class="{ sel: isSel('note', n.id) }" @click="emit('pickNote', n.id)">
        <span class="ic">{{ n.icon }}</span><span class="kind">{{ n.label }}</span><span v-if="n.text" class="txt">“{{ n.text }}”</span>
      </div>
    </li>
    <li v-for="b in boards" :key="b.path" role="treeitem" :aria-expanded="openBoards.has(b.path)">
      <div class="row board" :class="{ sel: isSel('board', b.path) }" @click="emit('pickBoard', b.path)">
        <Button variant="ghost" size="icon-xs" class="caret size-4 shrink-0 p-0" :aria-label="openBoards.has(b.path) ? 'Collapse board' : 'Expand board'" tabindex="-1" @click.stop="toggleBoard(b.path)"><component :is="openBoards.has(b.path) ? ChevronDown : ChevronRight" class="size-3" /></Button>
        <span class="ic">#</span><span class="name">{{ b.title }}</span>
      </div>
      <ul v-if="openBoards.has(b.path)" role="group" class="kids">
        <li v-if="!trees[b.path]" class="hint">Loading…</li>
        <template v-else>
          <LayerTree
            v-for="(k, i) in trees[b.path]!.kids"
            :key="(k.id ?? '') + i"
            :node="k"
            :depth="1"
            :selected-id="selElement && selElement.board === b.path ? selElement.id : null"
            :open="openEls[b.path] ?? emptyOpen"
            @select="emit('pickElement', { board: b.path, id: $event })"
            @toggle="toggleEl(b.path, $event)"
          />
        </template>
      </ul>
    </li>
    <li v-if="!notes.length && !boards.length" class="hint">Nothing on the canvas yet.</li>
  </ul>
</template>

<style scoped>
.cl { margin: 0; padding: 4px; list-style: none; border: 1px solid var(--line); border-radius: 8px; max-height: 340px; overflow: auto; background: var(--bg); }
.cl li { list-style: none; }
.kids { margin: 0; padding: 0; }
.row { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 6px; cursor: pointer; font-size: 12px; min-height: 26px; white-space: nowrap; overflow: hidden; }
.row:hover { background: var(--hover); }
.row.sel { background: color-mix(in srgb, var(--brand) 16%, transparent); color: var(--fg); }
.caret { width: 14px; height: 14px; display: inline-grid; place-items: center; border: 0; background: transparent; color: var(--muted); padding: 0; flex: none; cursor: pointer; }
.ic { width: 14px; text-align: center; color: var(--muted); font-size: 11px; flex: none; }
.row.sel .ic { color: var(--brand); }
.kind { color: var(--muted); font-size: 11px; flex: none; }
.name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
.txt { overflow: hidden; text-overflow: ellipsis; color: var(--fg); min-width: 0; }
.hint { color: var(--muted); font-size: 12px; padding: 4px 8px; }
</style>
