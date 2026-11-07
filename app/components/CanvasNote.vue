<script setup lang="ts">
import { arrowPath, noteBox, penPath } from '#shared/canvasGeometry'
import { type NoteView, dashOf, headOf, radiusOf, strokeOf, widthOf } from '~/utils/canvasView'
import { TEXT_PX, fillOf } from '~/utils/canvasStyle'

// One note on the canvas: sticky, text, rectangle, oval, line, arrow or pen stroke. Drawing only: Canvas owns selection and gestures.
const props = defineProps<{ n: NoteView, selected: boolean, editable: boolean, editing: boolean, hidden: boolean, erasing: boolean }>()
const emit = defineEmits<{ down: [e: PointerEvent], edit: [], commit: [text: string | null] }>()

const box = computed(() => noteBox(props.n))
const a = computed(() => arrowPath(props.n))
const sw = computed(() => widthOf(props.n))
const col = computed(() => strokeOf(props.n))
const dash = computed(() => dashOf(props.n.strokeStyle, sw.value))
const vis = computed(() => (props.hidden ? 'hidden' : 'visible'))
const cls = computed(() => ({ sel: props.selected, editable: props.editable, editing: props.editing, erasing: props.erasing }))
/** Arrowheads at the two ends: where, and which way they point. */
const heads = computed(() => (['start', 'end'] as const).map(end => ({
  type: headOf(props.n, end), x: end === 'start' ? a.value.x1 : a.value.x2, y: end === 'start' ? a.value.y1 : a.value.y2,
  rot: a.value.ang * 180 / Math.PI + (end === 'start' ? 180 : 0),
})).filter(h => h.type !== 'none'))
const labelled = computed(() => (props.n.kind === 'rect' || props.n.kind === 'oval') && (props.n.text || props.editing))

/** Focus and select the text field once per edit session (the flag clears when editing ends, so the next edit focuses again). */
function focusText(el: unknown) {
  const h = el as HTMLElement | null
  if (!h) return
  if (!props.editing) { delete h.dataset.f; return }
  if (h.dataset.f === '1') return
  h.dataset.f = '1'
  nextTick(() => { h.focus(); const r = document.createRange(); r.selectNodeContents(h); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r) })
}
function onKeys(ev: KeyboardEvent) {
  if (ev.key === 'Escape') emit('commit', null)
  else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); (ev.target as HTMLElement).blur() }
}
const done = (e: Event) => emit('commit', ((e.target as HTMLElement).innerText ?? '').replace(/\n$/, ''))
</script>

<template>
  <!-- sticky and text notes -->
  <div
    v-if="n.kind === 'sticky' || n.kind === 'text' || n.kind === 'title1'"
    data-note :data-id="n.id" class="note" :class="[n.kind, cls]"
    :style="{
      left: n.x + 'px', top: n.y + 'px', width: (n.w || 240) + 'px', visibility: vis,
      ...(n.kind === 'sticky' ? { background: fillOf(n.fill).bg, borderColor: fillOf(n.fill).bd } : {}),
      ...(n.kind === 'text' ? { fontSize: (TEXT_PX[n.size] ?? 18) + 'px', fontWeight: n.bold ? 700 : 400, color: n.color } : {}),
      ...(n.kind === 'sticky' && n.h ? { minHeight: n.h + 'px' } : {}),
    }"
    @pointerdown="emit('down', $event)" @dblclick.stop="emit('edit')"
  >
    <div :ref="focusText" class="ntext" :contenteditable="editing" :data-placeholder="n.kind === 'sticky' ? 'Write a note…' : 'Text'" @blur="done" @keydown.stop="onKeys">{{ n.text }}</div>
  </div>
  <!-- shapes: svg, so a hollow rectangle only catches clicks on its outline -->
  <svg
    v-else-if="n.kind === 'rect' || n.kind === 'oval'"
    data-note :data-id="n.id" class="note vec shape" :class="cls"
    :style="{ left: n.x + 'px', top: n.y + 'px', width: n.w + 'px', height: n.h + 'px', visibility: vis }"
    :viewBox="`0 0 ${n.w} ${n.h}`" overflow="visible" @pointerdown="emit('down', $event)" @dblclick.stop="emit('edit')"
  >
    <rect v-if="n.kind === 'rect'" x="1" y="1" :width="Math.max(n.w - 2, 1)" :height="Math.max(n.h - 2, 1)" :rx="radiusOf(n)" :fill="fillOf(n.fill).bg" :stroke="col" :stroke-width="sw" :stroke-dasharray="dash" stroke-linecap="round" />
    <ellipse v-else :cx="n.w / 2" :cy="n.h / 2" :rx="Math.max(n.w / 2 - 1, 1)" :ry="Math.max(n.h / 2 - 1, 1)" :fill="fillOf(n.fill).bg" :stroke="col" :stroke-width="sw" :stroke-dasharray="dash" stroke-linecap="round" />
  </svg>
  <svg
    v-else-if="n.kind === 'line' || n.kind === 'arrow'"
    data-note :data-id="n.id" class="note vec" :class="cls"
    :style="{ left: box.x + 'px', top: box.y + 'px', width: Math.max(box.w, 1) + 'px', height: Math.max(box.h, 1) + 'px', visibility: vis }"
    :viewBox="`0 0 ${a.bw} ${a.bh}`" overflow="visible" @pointerdown="emit('down', $event)"
  >
    <line :x1="a.x1" :y1="a.y1" :x2="a.x2" :y2="a.y2" :stroke="col" :stroke-width="sw" :stroke-dasharray="dash" stroke-linecap="round" />
    <template v-for="h in heads" :key="h.x + ',' + h.y">
      <g :transform="`translate(${h.x} ${h.y}) rotate(${h.rot})`">
        <polygon v-if="h.type === 'arrow'" :points="`0,0 -${10 + sw * 1.6},-${4 + sw} -${10 + sw * 1.6},${4 + sw}`" :fill="col" />
        <polygon v-else-if="h.type === 'triangle'" :points="`0,0 -${10 + sw * 1.6},-${4 + sw} -${10 + sw * 1.6},${4 + sw}`" fill="none" :stroke="col" :stroke-width="sw" stroke-linejoin="round" />
        <circle v-else-if="h.type === 'dot'" :cx="-sw * 1.5" cy="0" :r="sw * 1.6 + 1" :fill="col" />
        <line v-else-if="h.type === 'bar'" x1="0" :y1="-(4 + sw * 1.5)" x2="0" :y2="4 + sw * 1.5" :stroke="col" :stroke-width="sw" stroke-linecap="round" />
      </g>
    </template>
    <line :x1="a.x1" :y1="a.y1" :x2="a.x2" :y2="a.y2" stroke="transparent" stroke-width="16" />
  </svg>
  <svg
    v-else-if="n.kind === 'pen'"
    data-note :data-id="n.id" class="note vec" :class="cls"
    :style="{ left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px', visibility: vis }"
    :viewBox="`0 0 ${box.w} ${box.h}`" overflow="visible" @pointerdown="emit('down', $event)"
  >
    <path :d="penPath(n)" fill="none" :stroke="col" :stroke-width="sw" :stroke-dasharray="dash" stroke-linecap="round" stroke-linejoin="round" />
    <path :d="penPath(n)" fill="none" stroke="transparent" stroke-width="14" />
  </svg>
  <!-- text inside a shape: centred, edited with the same double-click as sticky notes -->
  <div
    v-if="labelled"
    data-note :data-id="n.id" class="note label" :class="cls"
    :style="{ left: n.x + 'px', top: n.y + 'px', width: n.w + 'px', height: n.h + 'px', visibility: vis, fontSize: (TEXT_PX[n.size] ?? 18) + 'px', fontWeight: n.bold ? 700 : 400, color: n.color }"
    @pointerdown="emit('down', $event)" @dblclick.stop="emit('edit')"
  >
    <div :ref="focusText" class="ntext" :contenteditable="editing" data-placeholder="Text" @blur="done" @keydown.stop="onKeys">{{ n.text }}</div>
  </div>
</template>

<style scoped>
.note { position: absolute; font-size: 14px; line-height: 1.5; color: var(--muted); white-space: pre-wrap; pointer-events: none; }
.note.editable { pointer-events: auto; cursor: move; }
.note.erasing { opacity: .3; }
.note.title1 { font-size: 40px; font-weight: 650; color: var(--fg); line-height: 1.15; }
.note.sticky { border: 1px solid; border-radius: 3px; padding: 10px 12px; color: #3b2f14; box-shadow: 0 2px 6px rgb(0 0 0 / .08); font-size: 13px; min-height: 60px; }
.note.text { color: var(--fg); }
.note.label { display: grid; place-items: center; text-align: center; padding: 6px; box-sizing: border-box; overflow: hidden; }
.note .ntext { outline: none; min-height: 1.2em; cursor: inherit; max-width: 100%; }
.note .ntext[contenteditable="true"] { user-select: text; -webkit-user-select: text; }
.note.editing .ntext { cursor: text; }
.note .ntext:empty::before { content: attr(data-placeholder); opacity: .45; }
.note.vec { overflow: visible; }
.note.vec.editable { pointer-events: none; }
.note.vec.editable :deep(line), .note.vec.editable :deep(path), .note.vec.editable :deep(polygon), .note.vec.editable :deep(circle) { pointer-events: stroke; cursor: move; }
.note.vec.editable :deep(rect), .note.vec.editable :deep(ellipse) { pointer-events: visiblePainted; cursor: move; }
</style>
