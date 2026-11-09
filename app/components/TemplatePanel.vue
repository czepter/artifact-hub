<script setup lang="ts">
import { Info, Plus, X } from '@lucide/vue'
import type { EditSel } from '~/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

// The editor for "code-driven" elements: what a Design Component template does around and inside an element.
// Loops (<sc-for>) and conditions (<sc-if>) around it, the {{holes}} in its text and attributes, and the names a
// hole may use. Every change is a source operation on the board; the board reloads afterwards because a loop or a
// condition has no element of its own in the page to edit live.
type Kind = 'sc-for' | 'sc-if'
interface Info {
  dc: boolean
  tag: string
  directives: { kind: Kind, level: number, attrs: Record<string, string> }[]
  text: { source: string, hasHoles: boolean } | null
  attrs: { name: string, value: string, hole: boolean }[]
  scope: { props: string[], vars: string[] }
}

const props = defineProps<{ artifactId: string, board: string, sel: EditSel, busy: boolean, error: string, flushEdits: () => Promise<void> }>()
const emit = defineEmits<{ apply: [p: { board: string, ops: Record<string, unknown>[] }], openCode: [] }>()

const info = ref<Info | null>(null)
const loading = ref(false)
const err = ref('')
const draftText = ref('')
const textEl = ref<{ $el?: HTMLTextAreaElement } | HTMLTextAreaElement | null>(null)
const adding = ref<Kind | null>(null)
const addList = ref('{{items}}'), addAs = ref('item'), addValue = ref('{{show}}')
const newName = ref(''), newValue = ref('')

let seq = 0
async function load() {
  const my = ++seq
  loading.value = true; err.value = ''
  try {
    await props.flushEdits()
    const r = await $fetch<Info>(`/api/artifacts/${props.artifactId}/template`, { query: { path: props.board, el: props.sel.id } })
    if (my !== seq) return
    info.value = r
    draftText.value = r.text?.source ?? ''
  } catch (e: any) {
    if (my !== seq) return
    info.value = null
    err.value = e?.data?.statusMessage ?? e?.statusMessage ?? ''
  } finally { if (my === seq) loading.value = false }
}
watch(() => [props.board, props.sel.id], () => { adding.value = null; void load() }, { immediate: true })

const repeated = computed(() => props.sel.repeats > 1)
const loops = computed(() => info.value?.directives.filter(d => d.kind === 'sc-for') ?? [])
const holeAttrs = computed(() => info.value?.attrs.filter(a => a.hole) ?? [])
const codeDriven = computed(() => repeated.value || !!info.value?.directives.length || !!info.value?.text?.hasHoles || holeAttrs.value.length > 0)
const names = computed(() => [...(info.value?.scope.vars ?? []), ...(info.value?.scope.props ?? [])])
/** The data-props names as holes, for the hint at the bottom. Built here because braces inside a template interpolation do not parse. */
const propHoles = computed(() => (info.value?.scope.props ?? []).map(p => '{' + '{' + p + '}' + '}').join(', ') + (info.value?.scope.props.length ? ', ' : ''))
const textDirty = computed(() => !!info.value?.text && draftText.value !== info.value.text.source)

function send(...ops: Record<string, unknown>[]) { emit('apply', { board: props.board, ops: ops.map(o => ({ id: props.sel.id, ...o })) }) }
function setDirective(d: Info['directives'][number], key: string, value: string) {
  if (value === d.attrs[key]) return
  send({ type: 'directive', kind: d.kind, level: d.level, set: { [key]: value } })
}
function removeDirective(d: Info['directives'][number]) { send({ type: 'unwrapDirective', kind: d.kind, level: d.level }) }
function addDirective() {
  const kind = adding.value
  if (!kind) return
  send({ type: 'wrapDirective', kind, attrs: kind === 'sc-for' ? { list: addList.value.trim(), as: addAs.value.trim() } : { value: addValue.value.trim() } })
  adding.value = null
}
const hole = (n: string) => '{' + '{' + n + '}' + '}'
function insertHole(name: string) {
  const el = (textEl.value && '$el' in textEl.value ? textEl.value.$el : textEl.value) as HTMLTextAreaElement | null
  const text = hole(name)
  if (!el || typeof el.selectionStart !== 'number') { draftText.value += text; return }
  const a = el.selectionStart, b = el.selectionEnd
  draftText.value = draftText.value.slice(0, a) + text + draftText.value.slice(b)
  nextTick(() => { el.focus(); el.setSelectionRange(a + text.length, a + text.length) })
}
function applyText() { if (textDirty.value) send({ type: 'text', html: draftText.value }) }
function setAttr(name: string, value: string | null) { send({ type: 'tattr', name, value }) }
function addAttr() {
  const n = newName.value.trim().toLowerCase()
  if (!n) return
  setAttr(n, newValue.value); newName.value = ''; newValue.value = ''
}
const lab = 'grid gap-1 text-xs text-muted-foreground'
const inp = 'h-7 font-mono text-xs'
</script>

<template>
  <section v-if="info?.dc || codeDriven" class="grid gap-3" aria-label="Template">
    <h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Template</h3>

    <div v-if="codeDriven" class="flex gap-2 rounded-lg border bg-muted/40 p-2.5 text-xs" role="status">
      <Info class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <p class="m-0">
        <template v-if="repeated">These <b>{{ sel.repeats }}</b> elements are rendered from one template node. What you change here applies to all of them.</template>
        <template v-else-if="info?.directives.length">This element sits inside a loop or condition of the template.</template>
        <template v-else>This element shows data from the board's script.</template>
      </p>
    </div>

    <div v-if="err" class="text-xs text-muted-foreground">{{ err }}</div>
    <p v-if="error" class="m-0 text-xs text-destructive" role="alert">{{ error }}</p>

    <!-- loops and conditions around the element -->
    <div v-if="info?.directives.length" class="grid gap-2">
      <div v-for="d in info.directives" :key="d.kind + d.level" class="grid gap-1.5 rounded-lg border p-2">
        <div class="flex items-center justify-between gap-2">
          <span class="font-mono text-[11px] font-semibold">&lt;{{ d.kind }}&gt;<span class="ml-1.5 font-sans font-normal text-muted-foreground">{{ d.kind === 'sc-for' ? 'repeats for each item' : 'shown only if' }}</span></span>
          <Button variant="ghost" size="icon-xs" :disabled="busy" :title="d.kind === 'sc-for' ? 'Stop repeating (keeps one copy of the content)' : 'Always show (removes the condition)'" :aria-label="`Remove ${d.kind}`" @click="removeDirective(d)"><X /></Button>
        </div>
        <template v-if="d.kind === 'sc-for'">
          <label :class="lab"><span>List</span><Input :class="inp" :model-value="d.attrs.list" :disabled="busy" @change="setDirective(d, 'list', ($event.target as HTMLInputElement).value.trim())" /></label>
          <label :class="lab"><span>Each item is called</span><Input :class="inp" :model-value="d.attrs.as" :disabled="busy" @change="setDirective(d, 'as', ($event.target as HTMLInputElement).value.trim())" /></label>
        </template>
        <label v-else :class="lab"><span>Condition</span><Input :class="inp" :model-value="d.attrs.value" :disabled="busy" @change="setDirective(d, 'value', ($event.target as HTMLInputElement).value.trim())" /></label>
      </div>
    </div>

    <!-- make this element repeat or conditional -->
    <div v-if="info" class="grid gap-2">
      <div class="flex flex-wrap gap-1.5">
        <Button variant="outline" size="xs" :disabled="busy" @click="adding = adding === 'sc-for' ? null : 'sc-for'"><Plus />Repeat for each…</Button>
        <Button variant="outline" size="xs" :disabled="busy" @click="adding = adding === 'sc-if' ? null : 'sc-if'"><Plus />Show only if…</Button>
      </div>
      <form v-if="adding" class="grid gap-1.5 rounded-lg border p-2" @submit.prevent="addDirective">
        <template v-if="adding === 'sc-for'">
          <label :class="lab"><span>List</span><Input v-model="addList" :class="inp" placeholder="{{items}}" /></label>
          <label :class="lab"><span>Each item is called</span><Input v-model="addAs" :class="inp" placeholder="item" /></label>
        </template>
        <label v-else :class="lab"><span>Condition</span><Input v-model="addValue" :class="inp" placeholder="{{show}}" /></label>
        <div class="flex gap-1.5"><Button size="xs" type="submit" :disabled="busy">Wrap element</Button><Button size="xs" variant="outline" type="button" @click="adding = null">Cancel</Button></div>
      </form>
    </div>

    <!-- text, with its data holes -->
    <div v-if="info?.text" class="grid gap-1.5">
      <span :class="lab">Text{{ info.text.hasHoles ? ' (with data)' : '' }}</span>
      <Textarea ref="textEl" v-model="draftText" class="min-h-16 font-mono text-xs" spellcheck="false" :disabled="busy" aria-label="Template text" @keydown.ctrl.enter.prevent="applyText" @keydown.meta.enter.prevent="applyText" />
      <div v-if="names.length" class="flex flex-wrap items-center gap-1">
        <span class="text-[11px] text-muted-foreground">Insert</span>
        <Button v-for="n in names" :key="n" variant="outline" size="xs" class="h-5 px-1.5 font-mono text-[11px]" :title="`Insert ${hole(n)}`" @click="insertHole(n)">{{ n }}</Button>
      </div>
      <div class="flex gap-1.5"><Button size="xs" :disabled="!textDirty || busy" @click="applyText">Apply text</Button><Button size="xs" variant="outline" :disabled="!textDirty" @click="draftText = info.text!.source">Revert</Button></div>
    </div>

    <!-- attributes, including the ones bound to data -->
    <div v-if="info" class="grid gap-1.5">
      <span :class="lab">Attributes</span>
      <div v-for="a in info.attrs" :key="a.name" class="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-1.5">
        <span class="truncate font-mono text-[11px]" :class="a.hole ? 'text-foreground' : 'text-muted-foreground'" :title="a.name">{{ a.name }}</span>
        <Input :class="inp" :model-value="a.value" :disabled="busy" :aria-label="a.name" @change="setAttr(a.name, ($event.target as HTMLInputElement).value)" />
        <Button variant="ghost" size="icon-xs" :disabled="busy" :aria-label="`Remove ${a.name}`" @click="setAttr(a.name, null)"><X /></Button>
      </div>
      <form class="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-1.5" @submit.prevent="addAttr">
        <Input v-model="newName" :class="inp" placeholder="name" aria-label="New attribute name" />
        <Input v-model="newValue" :class="inp" placeholder="value or {{hole}}" aria-label="New attribute value" />
        <Button variant="outline" size="icon-xs" type="submit" :disabled="busy || !newName.trim()" aria-label="Add attribute"><Plus /></Button>
      </form>
    </div>

    <p v-if="info?.dc" class="m-0 text-xs text-muted-foreground">
      What the holes resolve to ({{ propHoles }}<code>renderVals()</code>, state) is written in the board's script:
      <Button variant="link" size="xs" class="h-auto p-0 text-xs" @click="emit('openCode')">open the file in the Code tab</Button>.
    </p>
  </section>
</template>
