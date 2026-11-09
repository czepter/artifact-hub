<script setup lang="ts">
import { ChevronDown, ChevronRight } from '@lucide/vue'
import { Button } from '@/components/ui/button'
export interface TreeNode { id: string | null, tag: string, label: string, free?: boolean, kids: TreeNode[] }

const props = defineProps<{ node: TreeNode, depth: number, selectedId: string | null, open: Set<string> }>()
const emit = defineEmits<{ select: [id: string, extend?: boolean], hover: [id: string | null], toggle: [id: string] }>()

const isOpen = computed(() => !!props.node.id && props.open.has(props.node.id))
const hasKids = computed(() => props.node.kids.length > 0)
</script>

<template>
  <li class="n" role="treeitem" :aria-expanded="hasKids ? isOpen : undefined" :aria-selected="node.id === selectedId">
    <div
      v-if="node.id"
      class="row"
      :class="{ sel: node.id === selectedId }"
      :style="{ paddingLeft: 6 + depth * 12 + 'px' }"
      @click="emit('select', node.id, $event.shiftKey)"
      @mouseenter="emit('hover', node.id)"
      @mouseleave="emit('hover', null)"
    >
      <Button v-if="hasKids" variant="ghost" size="icon-xs" class="caret size-4 shrink-0 p-0" :aria-label="isOpen ? 'Collapse' : 'Expand'" tabindex="-1" @click.stop="emit('toggle', node.id)"><component :is="isOpen ? ChevronDown : ChevronRight" class="size-3" /></Button>
      <span v-else class="caret" />
      <span class="tag">{{ node.tag }}</span>
      <span v-if="node.label" class="label">“{{ node.label }}”</span>
      <span v-if="node.free" class="free" title="Freely positioned">◆</span>
    </div>
    <ul v-if="hasKids && (isOpen || !node.id)" role="group" class="kids">
      <LayerTree v-for="(k, i) in node.kids" :key="(k.id ?? '') + i" :node="k" :depth="node.id ? depth + 1 : depth" :selected-id="selectedId" :open="open" @select="(i, x) => emit('select', i, x)" @hover="emit('hover', $event)" @toggle="emit('toggle', $event)" />
    </ul>
  </li>
</template>

<style scoped>
.n { list-style: none; }
.kids { margin: 0; padding: 0; }
.row { display: flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: 6px; cursor: pointer; font-size: 12px; min-height: 24px; white-space: nowrap; overflow: hidden; }
.row:hover { background: var(--hover); }
.row.sel { background: #dbeafe; color: #1e3a8a; }
.caret { width: 14px; height: 14px; display: inline-grid; place-items: center; border: 0; background: transparent; color: var(--muted); padding: 0; flex: none; cursor: pointer; }
.tag { font: 500 11px/1 ui-monospace, monospace; color: var(--muted); flex: none; }
.row.sel .tag { color: #1e40af; }
.label { overflow: hidden; text-overflow: ellipsis; color: var(--fg); min-width: 0; }
.free { color: #3b82f6; font-size: 8px; flex: none; }
</style>
