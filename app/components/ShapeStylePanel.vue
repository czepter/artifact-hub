<script setup lang="ts">
import { type StyleChange, STYLE_FIELDS, styleOps } from '#shared/canvasItemOps'
import type { CanvasOp } from '#shared/canvasOps'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { fillOf } from '~/utils/canvasStyle'

// Stroke, fill and arrowhead controls for the selected shapes, lines and drawings. A change applies to every
// selected item it makes sense for, as one batch (one undo step).
const props = defineProps<{ notes: { id: string, kind: string, note: Record<string, any> }[] }>()
const emit = defineEmits<{ ops: [ops: CanvasOp[]] }>()

const has = (f: keyof StyleChange) => props.notes.some(n => STYLE_FIELDS[n.kind]?.includes(f))
const first = computed(() => props.notes.find(n => STYLE_FIELDS[n.kind]) ?? null)
const val = <T,>(f: string, dflt: T): T => (first.value?.note[f] as T) ?? dflt
const apply = (change: StyleChange) => emit('ops', styleOps(props.notes, change))

const FILLS = ['none', 'gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']
const WIDTHS = [{ v: 1.5, label: 'Thin' }, { v: 2.5, label: 'Medium' }, { v: 4, label: 'Bold' }]
const HEADS = [{ v: 'none', label: 'None' }, { v: 'arrow', label: 'Arrow' }, { v: 'triangle', label: 'Triangle' }, { v: 'dot', label: 'Dot' }, { v: 'bar', label: 'Bar' }]
const stroke = computed(() => val('stroke', val('color', '#1c1b19')))
// What is drawn when a field is not stored (older canvases): width 2 for shapes and 2.5 for lines; arrows end in a head.
const widthNow = computed(() => { const f = first.value; const w = f?.note.strokeWidth ?? (f?.kind === 'rect' || f?.kind === 'oval' ? 2 : 2.5); return WIDTHS.reduce((a, b) => (Math.abs(b.v - w) < Math.abs(a.v - w) ? b : a)).v })
const headNote = computed(() => props.notes.find(n => n.kind === 'arrow' || n.kind === 'line') ?? null)
const headNow = (end: 'arrowStart' | 'arrowEnd') => (headNote.value?.note[end] as string | undefined) ?? (end === 'arrowEnd' && headNote.value?.kind === 'arrow' ? 'arrow' : 'none')
/** A hex colour is applied when valid; otherwise the field goes back to what is drawn. */
function onHex(e: Event) { const el = e.target as HTMLInputElement; if (/^#[0-9a-f]{6}$/i.test(el.value)) apply({ stroke: el.value }); else el.value = stroke.value }
</script>

<template>
  <section v-if="first" class="grid gap-2" aria-label="Style">
    <h3 class="sec">Style</h3>
    <div v-if="has('stroke')" class="grid gap-1.5">
      <Label>Stroke colour</Label>
      <div class="flex gap-1.5">
        <Input type="color" class="size-8 shrink-0 cursor-pointer p-0.5" aria-label="Stroke colour" :model-value="stroke" @change="apply({ stroke: ($event.target as HTMLInputElement).value })" />
        <Input class="h-8" aria-label="Stroke colour (hex)" :model-value="stroke" @change="onHex" />
      </div>
    </div>
    <div v-if="has('strokeWidth')" class="grid gap-1.5">
      <Label>Stroke width</Label>
      <ToggleGroup type="single" variant="outline" size="sm" class="justify-start" aria-label="Stroke width" :model-value="String(widthNow)" @update:model-value="(v) => v && apply({ strokeWidth: Number(v) })">
        <ToggleGroupItem v-for="w in WIDTHS" :key="w.v" :value="String(w.v)" :aria-label="w.label">{{ w.label }}</ToggleGroupItem>
      </ToggleGroup>
    </div>
    <div v-if="has('strokeStyle')" class="grid gap-1.5">
      <Label>Stroke style</Label>
      <ToggleGroup type="single" variant="outline" size="sm" class="justify-start" aria-label="Stroke style" :model-value="val('strokeStyle', 'solid')" @update:model-value="(v) => v && apply({ strokeStyle: String(v) })">
        <ToggleGroupItem value="solid" aria-label="Solid">Solid</ToggleGroupItem>
        <ToggleGroupItem value="dashed" aria-label="Dashed">Dashed</ToggleGroupItem>
        <ToggleGroupItem value="dotted" aria-label="Dotted">Dotted</ToggleGroupItem>
      </ToggleGroup>
    </div>
    <div v-if="has('fill')" class="grid gap-1.5">
      <Label>Fill</Label>
      <ToggleGroup type="single" class="flex-wrap justify-start gap-1.5" aria-label="Fill" :model-value="val('fill', 'none')" @update:model-value="(v) => v && apply({ fill: String(v) })">
        <ToggleGroupItem v-for="f in FILLS" :key="f" :value="f" size="sm" class="size-6 min-w-6 rounded-full border p-0 data-[state=on]:ring-2 data-[state=on]:ring-primary" :style="{ background: fillOf(f).bg }" :title="f" :aria-label="`Fill ${f}`" />
      </ToggleGroup>
    </div>
    <div v-if="has('fillStyle') && notes.some(n => n.note.fill && n.note.fill !== 'none')" class="grid gap-1.5">
      <Label>Fill style</Label>
      <ToggleGroup type="single" variant="outline" size="sm" class="justify-start" aria-label="Fill style" :model-value="val('fillStyle', 'solid')" @update:model-value="(v) => v && apply({ fillStyle: String(v) })">
        <ToggleGroupItem value="solid" aria-label="Solid fill">Solid</ToggleGroupItem>
        <ToggleGroupItem value="hatch" aria-label="Hatch fill">Hatch</ToggleGroupItem>
        <ToggleGroupItem value="cross" aria-label="Cross-hatch fill">Cross</ToggleGroupItem>
      </ToggleGroup>
    </div>
    <div v-if="has('roundness')" class="grid gap-1.5">
      <Label>Corners</Label>
      <ToggleGroup type="single" variant="outline" size="sm" class="justify-start" aria-label="Corners" :model-value="val('roundness', '')" @update:model-value="(v) => v && apply({ roundness: String(v) })">
        <ToggleGroupItem value="sharp" aria-label="Sharp corners">Sharp</ToggleGroupItem>
        <ToggleGroupItem value="round" aria-label="Round corners">Round</ToggleGroupItem>
      </ToggleGroup>
    </div>
    <div v-if="has('arrowStart')" class="grid grid-cols-2 gap-2">
      <div v-for="end in (['arrowStart', 'arrowEnd'] as const)" :key="end" class="grid gap-1.5">
        <Label>{{ end === 'arrowStart' ? 'Start' : 'End' }} arrowhead</Label>
        <Select :model-value="headNow(end)" @update:model-value="(v) => apply({ [end]: String(v) })">
          <SelectTrigger size="sm" class="w-full" :aria-label="`${end === 'arrowStart' ? 'Start' : 'End'} arrowhead`"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem v-for="h in HEADS" :key="h.v" :value="h.v">{{ h.label }}</SelectItem></SelectContent>
        </Select>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sec { margin: 0 0 2px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted-foreground); font-weight: 600; }
</style>
