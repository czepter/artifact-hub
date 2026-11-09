<script setup lang="ts">
import type { EditSel } from '~/types'
import { ChevronDown, Minus, Plus } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const props = defineProps<{ sel: EditSel, boards?: { path: string, title: string }[], activeBoard?: string | null }>()
const emit = defineEmits<{ cmd: [c: Record<string, unknown>], exportBoard: [] }>()

const c = computed(() => props.sel.c)
const d = computed(() => props.sel.declared)
const isSet = (...p: string[]) => p.some(k => k in d.value)
const num = (v?: string) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '' }
const isFlex = computed(() => /flex/.test(c.value.display ?? ''))
const isGrid = computed(() => /grid/.test(c.value.display ?? ''))
const isCol = computed(() => c.value.flexDirection?.startsWith('column'))
const hasText = computed(() => props.sel.textEditable || props.sel.bound || /^(p|h[1-6]|span|a|button|label|li|td|th|div|b|i|em|strong|small|input)$/.test(props.sel.tag))

function hex(v?: string): string {
  const m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?\s*\)$/.exec(v ?? '')
  if (!m || (m[4] !== undefined && parseFloat(m[4]) === 0)) return ''
  return '#' + [m[1], m[2], m[3]].map(x => Number(x).toString(16).padStart(2, '0')).join('')
}
const val = (e: Event) => (e.target as HTMLInputElement).value.trim()
function style(set: Record<string, string | null>) { emit('cmd', { cmd: 'style', set }) }
const css = (prop: string, v: string) => style({ [prop]: v === '' ? null : v })
const pxOf = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? `${v}px` : v)
const cpx = (prop: string, e: Event) => { const v = val(e); style({ [prop]: v === '' ? null : pxOf(v) }) }
const NONE = '__none'
const unNone = (v: unknown) => (v === NONE || v == null ? '' : String(v))
// ---- click dummy ------------------------------------------------------------------------------------------------------
/** Board paths as the active board's file would write them (relative to its folder). */
const relBoards = computed(() => {
  const from = (props.activeBoard ?? '').split('/').slice(0, -1)
  return (props.boards ?? []).filter(b => b.path !== props.activeBoard).map((b) => {
    const to = b.path.split('/'); let i = 0
    while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
    return { path: [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/'), title: b.title }
  })
})
const moreTriggers = ref(false)
const proto = computed(() => props.sel.proto ?? { click: null, hover: null, press: null, focus: null, blur: null, change: null, input: null, after: null, component: null, state: null, show: null, hide: null, modal: null, dismiss: null })
const MODALS: [string, string][] = [[NONE, 'Not an overlay'], ['dialog', 'Dialog (centred, dimmed)'], ['drawer-right', 'Drawer from the right'], ['drawer-left', 'Drawer from the left'], ['sheet', 'Sheet from the bottom'], ['popover', 'Popover under its opener'], ['free', 'Free (you place it)']]
const modalKind = computed(() => (proto.value.modal === null ? NONE : proto.value.modal === '' ? 'dialog' : MODALS.some(m => m[0] === proto.value.modal) ? proto.value.modal! : 'dialog'))
const setModal = (v: unknown) => setProto('modal', v === NONE ? '' : String(v))
/** What closes or resets it: the attribute if set, else the overlay kind's default (drawers, sheets and popovers close on both). */
const dismisses = computed(() => {
  const a = proto.value.dismiss, m = proto.value.modal
  if (a === null) return new Set(m && /^(drawer|sheet|popover)/.test(m) ? ['outside', 'escape'] : [])
  if (a.trim() === '') return new Set(['outside', 'escape'])
  return new Set(a.split(/\s+/).filter(x => x === 'outside' || x === 'escape'))
})
function setDismiss(what: 'outside' | 'escape', on: boolean) {
  const next = new Set(dismisses.value)
  if (on) next.add(what); else next.delete(what)
  setProto('dismiss', next.size ? [...next].join(' ') : 'none')
}
const setProto = (name: string, value: string) => emit('cmd', { cmd: 'attr', name: `data-hub-${name}`, value })
const protoText = (name: string, e: Event) => setProto(name, (e.target as HTMLInputElement).value.trim())
const attr = (name: string, e: Event) => emit('cmd', { cmd: 'attr', name, value: (e.target as HTMLInputElement).value })

// ---- size modes -----------------------------------------------------------------------------------
type Mode = 'auto' | 'hug' | 'fixed' | 'fill'
function modeOf(prop: 'width' | 'height'): Mode {
  const v = d.value[prop]
  if (!v) return 'auto'
  if (/^(fit-content|max-content|min-content)/.test(v)) return 'hug'
  if (v === '100%' || v === 'stretch' || /^calc\(100%/.test(v)) return 'fill'
  return 'fixed'
}
function setMode(prop: 'width' | 'height', v: unknown) {
  const m = String(v) as Mode
  style({ [prop]: m === 'auto' ? null : m === 'hug' ? 'fit-content' : m === 'fill' ? '100%' : `${Math.round(parseFloat(c.value[prop] ?? '0'))}px` })
}

// ---- padding / radius, one value or per side --------------------------------------------------------
const padSplit = ref(false), radSplit = ref(false)
const pad = (side: 'top' | 'right' | 'bottom' | 'left') => num(c.value[`padding${side[0]!.toUpperCase()}${side.slice(1)}`])
const radii = computed(() => [num(c.value.borderRadius), num(c.value.radiusTR), num(c.value.radiusBR), num(c.value.radiusBL)])

// ---- text -----------------------------------------------------------------------------------------
const PRESETS: Record<string, Record<string, string>> = {
  h1: { 'font-size': '32px', 'font-weight': '700', 'line-height': '1.2' },
  h2: { 'font-size': '24px', 'font-weight': '700', 'line-height': '1.25' },
  body: { 'font-size': '16px', 'font-weight': '400', 'line-height': '1.5' },
  small: { 'font-size': '13px', 'font-weight': '400', 'line-height': '1.45' },
  caption: { 'font-size': '12px', 'font-weight': '400', 'line-height': '1.4', color: '#6b675f' },
  label: { 'font-size': '13px', 'font-weight': '500', 'line-height': '1.3' },
  link: { color: '#2563eb', 'text-decoration': 'underline' },
}
function preset(v: unknown) { const k = String(v ?? ''); if (k && PRESETS[k]) style(PRESETS[k]!) }
const FONTS = ['Inter, system-ui, sans-serif', 'system-ui, sans-serif', 'Georgia, serif', '\'Times New Roman\', serif', 'Arial, Helvetica, sans-serif', 'ui-monospace, \'JetBrains Mono\', monospace', '\'Space Grotesk\', sans-serif']
const fontNow = computed(() => d.value['font-family'] ?? '')
const SHADOWS: [string, string][] = [['None', ''], ['Small', '0 1px 3px rgba(0,0,0,.14)'], ['Medium', '0 6px 16px rgba(0,0,0,.16)'], ['Large', '0 16px 40px rgba(0,0,0,.22)'], ['Glow', '0 0 0 4px rgba(59,130,246,.35)']]
const shadowPreset = computed(() => { const v = d.value['box-shadow'] ?? ''; return SHADOWS.find(s => s[1] === v)?.[1] || (v ? '__custom' : NONE) })
function shadow(v: unknown) { if (v !== '__custom') css('box-shadow', unNone(v)) }

const contrast = computed(() => props.sel.contrast)
const contrastGood = computed(() => !!contrast.value && ['AA', 'AAA', 'AA large'].includes(contrast.value.level))
const contrastText = computed(() => {
  const k = contrast.value; if (!k) return ''
  return k.level === 'AAA' ? `Excellent contrast ${k.ratio}:1` : k.level === 'AA' ? `Good contrast ${k.ratio}:1` : k.level === 'AA large' ? `OK for large text ${k.ratio}:1` : `Low contrast ${k.ratio}:1`
})

const editsAttr = computed(() => ({ src: props.sel.tag === 'img', href: props.sel.tag === 'a', placeholder: ['input', 'textarea'].includes(props.sel.tag) }))
const free = computed(() => props.sel.free)
const showAdvanced = ref(false)

// opacity slider: local value while dragging, emitted on commit only
const op = ref<number[]>([1])
watch(() => c.value.opacity, v => { const n = parseFloat(v || '1'); op.value = [Number.isFinite(n) ? n : 1] }, { immediate: true })
const commitOpacity = (v: number[] | undefined) => { const s = String(v?.[0] ?? 1); style({ opacity: s === '1' ? null : s }) }

const lab = 'grid min-w-0 gap-1 text-xs font-normal text-muted-foreground'
const inp = 'h-8 min-w-0 px-2 text-[13px] md:text-[13px]'
const trg = 'h-8 w-full px-2 text-[13px]'
const seg = 'w-full'
const segItem = 'h-8 flex-1 px-1 text-xs capitalize'
const h3 = 'mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
const hint = 'text-xs text-muted-foreground'
const MODES = [['auto', 'Auto'], ['hug', 'Hug'], ['fixed', 'Fixed'], ['fill', 'Fill']] as const
const ALIGNS = [['left', '⇤', 'Align left'], ['hcenter', '↔', 'Centre horizontally'], ['right', '⇥', 'Align right'], ['top', '⤒', 'Align top'], ['vmiddle', '↕', 'Centre vertically'], ['bottom', '⤓', 'Align bottom']] as const
const ALIGN_ITEMS = [['flex-start', 'Start'], ['center', 'Center'], ['flex-end', 'End'], ['stretch', 'Stretch']] as const
const JUSTIFY = [['flex-start', 'Start'], ['center', 'Center'], ['flex-end', 'End'], ['space-between', 'Between']] as const
const BORDERS = [['none', 'None'], ['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']] as const
const WEIGHTS = [['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold']] as const
const PRESET_LIST = [['h1', 'Heading 1'], ['h2', 'Heading 2'], ['body', 'Body'], ['small', 'Small'], ['caption', 'Caption'], ['label', 'Label'], ['link', 'Link']] as const
const layoutNow = computed(() => (isGrid.value ? 'grid' : isFlex.value ? 'flex' : 'block'))
const alignNow = computed(() => (c.value.alignItems === 'normal' ? 'stretch' : c.value.alignItems ?? ''))
const justifyNow = computed(() => (c.value.justifyContent === 'normal' ? 'flex-start' : c.value.justifyContent ?? ''))
const borderNow = computed(() => c.value.borderStyle || 'none')
const textAlignNow = computed(() => (c.value.textAlign === 'start' ? 'left' : c.value.textAlign ?? ''))
const fontOpen = ref(false)
</script>

<template>
  <div class="grid grid-cols-[minmax(0,1fr)] gap-4 text-[13px]">
    <!-- element actions and placement -->
    <section class="grid gap-2">
      <h3 :class="h3">&lt;{{ sel.tag }}&gt;</h3>
      <div class="flex flex-wrap gap-1.5">
        <Button variant="outline" size="xs" :disabled="!sel.parentId" title="Select the parent element" @click="emit('cmd', { cmd: 'select', id: sel.parentId })">Parent</Button>
        <Button variant="outline" size="xs" :disabled="!sel.canUp" title="Move up" @click="emit('cmd', { cmd: 'move', dir: 'up' })">↑</Button>
        <Button variant="outline" size="xs" :disabled="!sel.canDown" title="Move down" @click="emit('cmd', { cmd: 'move', dir: 'down' })">↓</Button>
        <Button variant="outline" size="xs" title="Duplicate (Ctrl+D)" @click="emit('cmd', { cmd: 'duplicate' })">Duplicate</Button>
        <Button variant="outline" size="xs" class="text-destructive" title="Delete (Del)" @click="emit('cmd', { cmd: 'delete' })">Delete</Button>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <Button variant="outline" size="xs" :disabled="!sel.canGroup" title="Wrap the selected elements in a group (Ctrl+G)" @click="emit('cmd', { cmd: 'group' })">Group{{ sel.multi ? ` (${sel.multi + 1})` : '' }}</Button>
        <Button variant="outline" size="xs" :disabled="!sel.groupable" title="Replace this group by its content (Ctrl+Shift+G)" @click="emit('cmd', { cmd: 'ungroup' })">Ungroup</Button>
        <span :class="hint">Shift-click siblings to group several.</span>
      </div>
      <ToggleGroup type="single" variant="outline" :class="seg" aria-label="Position" :model-value="free ? 'free' : 'flow'">
        <ToggleGroupItem value="flow" :class="segItem" title="Part of the page flow" @click="emit('cmd', { cmd: 'position', mode: 'flow' })">Flow</ToggleGroupItem>
        <ToggleGroupItem value="free" :class="segItem" title="Place anywhere: drag it, resize with the handles, arrow keys nudge. Alt+drag pulls an element out of the flow." @click="emit('cmd', { cmd: 'position', mode: 'free' })">Free</ToggleGroupItem>
      </ToggleGroup>
      <p v-if="free" :class="hint">Drag it on the board; handles resize; arrow keys nudge (Shift = 10 px). Snaps to its container and neighbours.</p>
      <p v-else :class="hint">Tip: <b>Free</b> lets you drag it anywhere, or hold <b>Alt</b> while dragging.</p>
      <div class="grid grid-cols-6 gap-1" role="group" aria-label="Align">
        <Button v-for="a in ALIGNS" :key="a[0]" variant="outline" size="icon-sm" class="w-full text-sm" :title="a[2]" :aria-label="a[2]" @click="emit('cmd', { cmd: 'align', to: a[0] })">{{ a[1] }}</Button>
      </div>
      <p v-if="sel.bound" :class="hint">Its text comes from template data. Style it here; change the text and data holes under Template.</p>
      <p v-else-if="sel.textEditable" :class="hint">Double-click to retype the text.</p>
    </section>

    <Separator />

    <section class="grid gap-2">
      <h3 :class="h3">Size</h3>
      <div v-for="p in (['width', 'height'] as const)" :key="p" class="grid grid-cols-[52px_1fr_86px] items-center gap-1.5">
        <span class="text-xs capitalize text-muted-foreground">{{ p }}</span>
        <Input :class="inp" :model-value="num(c[p])" @change="cpx(p, $event)" />
        <Select :model-value="modeOf(p)" @update:model-value="setMode(p, $event)">
          <SelectTrigger :class="trg" :aria-label="p === 'width' ? 'Width mode' : 'Height mode'"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem v-for="m in MODES" :key="m[0]" :value="m[0]">{{ m[1] }}</SelectItem></SelectContent>
        </Select>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <Label :class="lab"><span>Min width<i v-if="isSet('min-width')" class="text-[9px] not-italic text-primary"> ●</i></span><Input :class="inp" :model-value="c.minWidth === 'auto' || c.minWidth === '0px' ? '' : num(c.minWidth)" placeholder="0" @change="cpx('min-width', $event)" /></Label>
        <Label v-if="sel.parentFlex" :class="lab"><span>Grow<i v-if="isSet('flex-grow', 'flex')" class="text-[9px] not-italic text-primary"> ●</i></span><Input :class="inp" type="number" min="0" :model-value="c.flexGrow" @change="css('flex-grow', val($event))" /></Label>
      </div>
      <div v-if="free" class="grid grid-cols-2 gap-2">
        <Label :class="lab"><span>X (left)<i v-if="isSet('left')" class="text-[9px] not-italic text-primary"> ●</i></span><Input :class="inp" :model-value="num(c.left)" @change="cpx('left', $event)" /></Label>
        <Label :class="lab"><span>Y (top)<i v-if="isSet('top')" class="text-[9px] not-italic text-primary"> ●</i></span><Input :class="inp" :model-value="num(c.top)" @change="cpx('top', $event)" /></Label>
      </div>
    </section>

    <Separator />

    <section class="grid gap-2">
      <h3 :class="h3">Layout</h3>
      <ToggleGroup type="single" variant="outline" :class="seg" aria-label="Layout" :model-value="layoutNow">
        <ToggleGroupItem value="block" :class="segItem" @click="css('display', 'block')">Block</ToggleGroupItem>
        <ToggleGroupItem value="flex" :class="segItem" title="Stack children in a row or column" @click="css('display', 'flex')">Stack</ToggleGroupItem>
        <ToggleGroupItem value="grid" :class="segItem" @click="css('display', 'grid')">Grid</ToggleGroupItem>
      </ToggleGroup>
      <template v-if="isFlex">
        <ToggleGroup type="single" variant="outline" :class="seg" aria-label="Direction" :model-value="isCol ? 'column' : 'row'">
          <ToggleGroupItem value="row" :class="segItem" @click="style({ 'flex-direction': 'row' })">→ Row</ToggleGroupItem>
          <ToggleGroupItem value="column" :class="segItem" @click="style({ 'flex-direction': 'column' })">↓ Column</ToggleGroupItem>
        </ToggleGroup>
        <Label :class="lab">Align</Label>
        <ToggleGroup type="single" variant="outline" :class="seg" aria-label="Align items" :model-value="alignNow">
          <ToggleGroupItem v-for="o in ALIGN_ITEMS" :key="o[0]" :value="o[0]" :class="segItem" @click="style({ 'align-items': o[0] })">{{ o[1] }}</ToggleGroupItem>
        </ToggleGroup>
        <Label :class="lab">Distribute</Label>
        <ToggleGroup type="single" variant="outline" :class="seg" aria-label="Justify content" :model-value="justifyNow">
          <ToggleGroupItem v-for="o in JUSTIFY" :key="o[0]" :value="o[0]" :class="segItem" @click="style({ 'justify-content': o[0] })">{{ o[1] }}</ToggleGroupItem>
        </ToggleGroup>
        <Label class="flex items-center gap-2 text-xs font-normal"><Checkbox :model-value="c.flexWrap === 'wrap'" @update:model-value="css('flex-wrap', $event === true ? 'wrap' : '')" /><span>Wrap</span></Label>
      </template>
      <div v-if="isFlex || isGrid" class="grid grid-cols-2 gap-2">
        <Label :class="lab"><span>Gap<i v-if="isSet('gap', 'row-gap')" class="text-[9px] not-italic text-primary"> ●</i></span><Input :class="inp" :model-value="num(c.gap)" @change="cpx('gap', $event)" /></Label>
      </div>
      <div class="flex items-center justify-between"><span class="text-xs text-muted-foreground">Padding</span><Button variant="link" size="xs" class="h-auto p-0 text-xs" @click="padSplit = !padSplit">{{ padSplit ? 'One value' : 'Per side' }}</Button></div>
      <Input v-if="!padSplit" :class="[inp, isSet('padding') && 'border-primary']" :model-value="c.padding" placeholder="8px 16px" @change="css('padding', val($event))" />
      <div v-else class="grid grid-cols-4 gap-1.5">
        <Label v-for="s in (['top', 'right', 'bottom', 'left'] as const)" :key="s" :class="lab"><span>{{ s[0]!.toUpperCase() }}</span><Input :class="inp" :model-value="pad(s)" @change="cpx(`padding-${s}`, $event)" /></Label>
      </div>
      <Label :class="lab"><span>Margin<i v-if="isSet('margin', 'margin-top', 'margin-left')" class="text-[9px] not-italic text-primary"> ●</i></span><Input :class="inp" :model-value="c.margin" placeholder="0 0 12px" @change="css('margin', val($event))" /></Label>
    </section>

    <Separator />

    <section class="grid gap-2">
      <h3 :class="h3">Appearance</h3>
      <div class="grid grid-cols-2 gap-2">
        <div :class="lab"><Label :class="lab"><span>Fill<i v-if="isSet('background-color', 'background')" class="text-[9px] not-italic text-primary"> ●</i></span></Label>
          <div class="flex items-center gap-1.5"><Input type="color" class="h-8 w-8 shrink-0 cursor-pointer p-0.5" :model-value="hex(c.backgroundColor) || '#ffffff'" aria-label="Fill colour" @change="css('background-color', val($event))" /><Input :class="inp" :model-value="hex(c.backgroundColor)" placeholder="None" @change="css('background-color', val($event))" /></div></div>
        <div :class="lab"><Label :class="lab"><span>Opacity {{ Math.round((op[0] ?? 1) * 100) }}%<i v-if="isSet('opacity')" class="text-[9px] not-italic text-primary"> ●</i></span></Label>
          <Slider class="h-8" :model-value="op" :min="0" :max="1" :step="0.05" aria-label="Opacity" @update:model-value="op = $event ?? [1]" @value-commit="commitOpacity" /></div>
      </div>
      <div class="flex items-center justify-between"><span class="text-xs text-muted-foreground">Radius</span><Button variant="link" size="xs" class="h-auto p-0 text-xs" @click="radSplit = !radSplit">{{ radSplit ? 'One value' : 'Per corner' }}</Button></div>
      <Input v-if="!radSplit" :class="[inp, isSet('border-radius') && 'border-primary']" :model-value="num(c.borderRadius)" @change="cpx('border-radius', $event)" />
      <div v-else class="grid grid-cols-4 gap-1.5">
        <Label v-for="(corner, i) in ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']" :key="corner" :class="lab"><span>{{ ['TL', 'TR', 'BR', 'BL'][i] }}</span><Input :class="inp" :model-value="radii[i]" @change="cpx(corner, $event)" /></Label>
      </div>
      <Label :class="lab">Border</Label>
      <ToggleGroup type="single" variant="outline" :class="seg" aria-label="Border style" :model-value="borderNow">
        <ToggleGroupItem v-for="o in BORDERS" :key="o[0]" :value="o[0]" :class="segItem" @click="style(o[0] === 'none' ? { 'border-style': 'none' } : { 'border-style': o[0], ...(parseFloat(c.borderWidth || '0') === 0 ? { 'border-width': '1px' } : {}) })">{{ o[1] }}</ToggleGroupItem>
      </ToggleGroup>
      <div class="grid grid-cols-2 gap-2">
        <div :class="lab"><Label :class="lab"><span>Colour<i v-if="isSet('border-color', 'border')" class="text-[9px] not-italic text-primary"> ●</i></span></Label>
          <div class="flex items-center gap-1.5"><Input type="color" class="h-8 w-8 shrink-0 cursor-pointer p-0.5" :model-value="hex(c.borderColor) || '#d4d0c8'" aria-label="Border colour" @change="css('border-color', val($event))" /><Input :class="inp" :model-value="hex(c.borderColor)" @change="css('border-color', val($event))" /></div></div>
        <Label :class="lab"><span>Width<i v-if="isSet('border-width', 'border')" class="text-[9px] not-italic text-primary"> ●</i></span><Input :class="inp" :model-value="num(c.borderWidth)" @change="cpx('border-width', $event)" /></Label>
      </div>
    </section>

    <template v-if="hasText">
      <Separator />
      <section class="grid gap-2">
        <h3 :class="h3">Text</h3>
        <div :class="lab"><Label :class="lab">Style</Label>
          <Select model-value="" @update:model-value="preset">
            <SelectTrigger :class="trg" aria-label="Text style"><SelectValue placeholder="Apply a preset…" /></SelectTrigger>
            <SelectContent><SelectItem v-for="p in PRESET_LIST" :key="p[0]" :value="p[0]">{{ p[1] }}</SelectItem></SelectContent>
          </Select></div>
        <div :class="lab"><Label :class="lab"><span>Font<i v-if="isSet('font-family')" class="text-[9px] not-italic text-primary"> ●</i></span></Label>
          <div class="flex items-center gap-1.5">
            <Input :class="inp" :model-value="fontNow || ''" :placeholder="c.fontFamily?.split(',')[0]" @change="css('font-family', val($event))" />
            <Popover v-model:open="fontOpen">
              <PopoverTrigger as-child><Button variant="outline" size="icon-sm" class="shrink-0" aria-label="Pick a font"><ChevronDown /></Button></PopoverTrigger>
              <PopoverContent align="end" class="grid w-64 gap-0.5 p-1">
                <Button v-for="f in FONTS" :key="f" variant="ghost" size="sm" class="justify-start truncate font-normal" :style="{ fontFamily: f }" @click="css('font-family', f); fontOpen = false">{{ f.split(',')[0]!.replace(/'/g, '') }}</Button>
              </PopoverContent>
            </Popover>
          </div></div>
        <div class="grid grid-cols-2 gap-2">
          <div :class="lab"><Label :class="lab"><span>Weight<i v-if="isSet('font-weight')" class="text-[9px] not-italic text-primary"> ●</i></span></Label>
            <Select :model-value="c.fontWeight || NONE" @update:model-value="css('font-weight', unNone($event))">
              <SelectTrigger :class="trg" aria-label="Font weight"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem :value="NONE">Default</SelectItem><SelectItem v-for="w in WEIGHTS" :key="w[0]" :value="w[0]">{{ w[1] }}</SelectItem></SelectContent>
            </Select></div>
          <Label :class="lab"><span>Size<i v-if="isSet('font-size')" class="text-[9px] not-italic text-primary"> ●</i></span><Input :class="inp" :model-value="num(c.fontSize)" @change="cpx('font-size', $event)" /></Label>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Label :class="lab"><span>Line height<i v-if="isSet('line-height')" class="text-[9px] not-italic text-primary"> ●</i></span><Input :class="inp" :model-value="c.lineHeight === 'normal' ? '' : num(c.lineHeight)" placeholder="1.5 or 24px" @change="css('line-height', val($event))" /></Label>
          <Label :class="lab"><span>Spacing<i v-if="isSet('letter-spacing')" class="text-[9px] not-italic text-primary"> ●</i></span><Input :class="inp" :model-value="c.letterSpacing === 'normal' ? '' : num(c.letterSpacing)" placeholder="0" @change="cpx('letter-spacing', $event)" /></Label>
        </div>
        <div :class="lab"><Label :class="lab"><span>Colour<i v-if="isSet('color')" class="text-[9px] not-italic text-primary"> ●</i></span></Label>
          <div class="flex items-center gap-1.5"><Input type="color" class="h-8 w-8 shrink-0 cursor-pointer p-0.5" :model-value="hex(c.color) || '#000000'" aria-label="Text colour" @change="css('color', val($event))" /><Input :class="inp" :model-value="hex(c.color)" placeholder="#000000" @change="css('color', val($event))" /></div></div>
        <p v-if="contrast" class="rounded-md px-2 py-1.5 text-xs" :class="contrastGood ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'" role="status">{{ contrastGood ? '✓' : '!' }} {{ contrastText }}</p>
        <ToggleGroup type="single" variant="outline" :class="seg" aria-label="Text align" :model-value="textAlignNow">
          <ToggleGroupItem v-for="a in ['left', 'center', 'right', 'justify']" :key="a" :value="a" :class="segItem" @click="style({ 'text-align': a })">{{ a }}</ToggleGroupItem>
        </ToggleGroup>
      </section>
    </template>

    <Separator />

    <section class="grid gap-2">
      <h3 :class="h3">Effects</h3>
      <div :class="lab"><Label :class="lab"><span>Shadow<i v-if="isSet('box-shadow')" class="text-[9px] not-italic text-primary"> ●</i></span></Label>
        <Select :model-value="shadowPreset" @update:model-value="shadow">
          <SelectTrigger :class="trg" aria-label="Shadow"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="s in SHADOWS" :key="s[0]" :value="s[1] || NONE">{{ s[0] }}</SelectItem>
            <SelectItem v-if="shadowPreset === '__custom'" value="__custom">Custom</SelectItem>
          </SelectContent>
        </Select></div>
    </section>

    <template v-if="editsAttr.src || editsAttr.href || editsAttr.placeholder">
      <Separator />
      <section class="grid gap-2">
        <h3 :class="h3">{{ editsAttr.href ? 'Link' : 'Content' }}</h3>
        <Label v-if="editsAttr.src" :class="lab"><span>Image URL</span><Input :class="inp" :model-value="sel.attrs.src ?? ''" placeholder="https://… or a file in this artifact" @change="attr('src', $event)" /></Label>
        <Label v-if="editsAttr.src" :class="lab"><span>Alt text</span><Input :class="inp" :model-value="sel.attrs.alt ?? ''" @change="attr('alt', $event)" /></Label>
        <Label v-if="editsAttr.href" :class="lab"><span>Destination</span><Input :class="inp" :model-value="sel.attrs.href ?? ''" placeholder="https://…" @change="attr('href', $event)" /></Label>
        <Label v-if="editsAttr.placeholder" :class="lab"><span>Placeholder</span><Input :class="inp" :model-value="sel.attrs.placeholder ?? ''" @change="attr('placeholder', $event)" /></Label>
      </section>
    </template>

    <Separator />

    <section class="grid gap-2">
      <h3 :class="h3">Prototype</h3>
      <ProtoAction label="On click" :model-value="proto.click" :boards="relBoards" @update:model-value="setProto('click', $event)" />
      <ProtoAction label="While hovering" :model-value="proto.hover" :boards="relBoards" @update:model-value="setProto('hover', $event)" />
      <Collapsible v-model:open="moreTriggers" class="grid min-w-0 gap-2">
        <CollapsibleTrigger as-child>
          <Button variant="ghost" size="xs" class="h-auto w-full justify-between p-0 text-xs font-normal text-muted-foreground hover:bg-transparent" :aria-expanded="moreTriggers"><span>More triggers</span><component :is="moreTriggers ? Minus : Plus" /></Button>
        </CollapsibleTrigger>
        <CollapsibleContent class="grid min-w-0 gap-2">
          <ProtoAction label="While pressed" :model-value="proto.press" :boards="relBoards" @update:model-value="setProto('press', $event)" />
          <ProtoAction label="While focused" :model-value="proto.focus" :boards="relBoards" @update:model-value="setProto('focus', $event)" />
          <ProtoAction label="On change" :model-value="proto.change" :boards="relBoards" @update:model-value="setProto('change', $event)" />
          <ProtoAction label="On every keystroke" :model-value="proto.input" :boards="relBoards" @update:model-value="setProto('input', $event)" />
          <ProtoAction label="When focus leaves" :model-value="proto.blur" :boards="relBoards" @update:model-value="setProto('blur', $event)" />
          <Label :class="lab"><span>After a delay (ms, then actions)</span><Input :class="inp" :model-value="proto.after ?? ''" placeholder="e.g. 1500 go:Home.html|fade" @change="protoText('after', $event)" /></Label>
          <p :class="hint">Change fires for a select, radio, checkbox or field. In its actions, <code>{value}</code> is what the control holds: <code>state:Plan={value}</code>. A checkbox gives on or off.</p>
        </CollapsibleContent>
      </Collapsible>
      <div class="grid grid-cols-2 gap-2">
        <Label :class="lab"><span>Component</span><Input :class="inp" :model-value="proto.component ?? ''" placeholder="e.g. Menu" @change="protoText('component', $event)" /></Label>
        <Label :class="lab"><span>Starts in state</span><Input :class="inp" :model-value="proto.state ?? ''" placeholder="e.g. closed tab:a" @change="protoText('state', $event)" /></Label>
        <Label :class="lab"><span>Only in states</span><Input :class="inp" :model-value="proto.show ?? ''" placeholder="e.g. open tab:a" @change="protoText('show', $event)" /></Label>
        <Label :class="lab"><span>Hidden in states</span><Input :class="inp" :model-value="proto.hide ?? ''" placeholder="e.g. closed" @change="protoText('hide', $event)" /></Label>
      </div>
      <Label :class="lab">
        <span>Show as overlay</span>
        <Select :model-value="modalKind" @update:model-value="setModal">
          <SelectTrigger :class="trg" aria-label="Overlay kind"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem v-for="m in MODALS" :key="m[0]" :value="m[0]">{{ m[1] }}</SelectItem></SelectContent>
        </Select>
      </Label>
      <template v-if="proto.modal !== null || proto.component">
        <Label class="flex items-center gap-2 text-xs font-normal text-muted-foreground"><Checkbox :model-value="dismisses.has('outside')" @update:model-value="setDismiss('outside', !!$event)" /><span>Close or reset on a click outside</span></Label>
        <Label class="flex items-center gap-2 text-xs font-normal text-muted-foreground"><Checkbox :model-value="dismisses.has('escape')" @update:model-value="setDismiss('escape', !!$event)" /><span>Close or reset on Esc</span></Label>
      </template>
      <p :class="hint">Press play on a board to try it. A click on empty space flashes the hotspots.</p>
    </section>

    <Separator />

    <section class="grid gap-2">
      <h3 :class="h3">Export</h3>
      <div class="flex flex-wrap gap-1.5">
        <Button variant="outline" size="xs" @click="emit('cmd', { cmd: 'export-html' })">Copy HTML</Button>
        <Button variant="outline" size="xs" @click="emit('exportBoard')">Download board</Button>
      </div>
    </section>

    <Separator />

    <Collapsible v-model:open="showAdvanced" as="section" class="grid gap-2">
      <CollapsibleTrigger as-child>
        <Button variant="ghost" size="xs" class="h-auto w-full justify-between p-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent" :aria-expanded="showAdvanced"><span>Advanced</span><component :is="showAdvanced ? Minus : Plus" /></Button>
      </CollapsibleTrigger>
      <CollapsibleContent class="grid gap-2">
        <Label :class="lab"><span>Element id</span><Input :class="inp" :model-value="sel.attrs.id ?? ''" placeholder="e.g. hero" @change="attr('id', $event)" /></Label>
        <Label :class="lab"><span>Classes</span><Input :class="inp" :model-value="sel.attrs.cls ?? ''" placeholder="space separated" @change="attr('class', $event)" /></Label>
        <Label :class="lab"><span>Accessible label</span><Input :class="inp" :model-value="sel.attrs.ariaLabel ?? ''" placeholder="aria-label" @change="attr('aria-label', $event)" /></Label>
        <Label :class="lab"><span>Tooltip (title)</span><Input :class="inp" :model-value="sel.attrs.title ?? ''" @change="attr('title', $event)" /></Label>
        <Collapsible class="text-muted-foreground">
          <CollapsibleTrigger as-child><Button variant="link" size="xs" class="h-auto p-0 text-xs">Debug</Button></CollapsibleTrigger>
          <CollapsibleContent><pre class="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug">{{ JSON.stringify({ id: sel.id, tag: sel.tag, position: sel.position, parent: sel.parentId, declared: sel.declared }, null, 1) }}</pre></CollapsibleContent>
        </Collapsible>
      </CollapsibleContent>
    </Collapsible>
    <p :class="[hint, 'pb-2 text-center']">A dot on a label means the value is set directly on this element.</p>
  </div>
</template>
