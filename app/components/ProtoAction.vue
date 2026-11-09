<script setup lang="ts">
// One click-dummy trigger (data-hub-click / data-hub-hover) as a small form. Several actions, or ones the form does not
// know, are kept as text in "Custom"; the grammar is in shared/protoFlow.ts.
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TRANSITIONS, parseActions } from '#shared/protoFlow'

const props = defineProps<{
  label: string
  /** The attribute value, null when not set. */
  modelValue: string | null
  /** Boards of the canvas, with paths relative to the board being edited. */
  boards: { path: string, title: string }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const lab = 'grid min-w-0 gap-1 text-xs font-normal text-muted-foreground'
const inp = 'h-8 min-w-0 px-2 text-[13px] md:text-[13px]'
const trg = 'h-8 w-full min-w-0 px-2 text-[13px]'
const NONE = '__none'
const KINDS: [string, string][] = [['go', 'Go to board'], ['open-board', 'Show board as overlay'], ['open-el', 'Show element as overlay'], ['back', 'Go back'], ['close', 'Close overlay'], ['state', 'Set component state'], ['toggle', 'Toggle component state'], ['custom', 'Custom…']]

const parsed = computed(() => parseActions(props.modelValue ?? ''))
const kind = computed(() => {
  const v = props.modelValue?.trim()
  if (!v) return NONE
  const a = parsed.value
  if (a.length !== 1 || v.includes(';')) return 'custom'
  const x = a[0]!
  if (x.verb === 'open') return x.target.startsWith('#') ? 'open-el' : 'open-board'
  return x.verb
})
const first = computed(() => parsed.value[0] as any)
const set = (v: string) => emit('update:modelValue', v)
// An action may end in "if <tests>" / "unless <tests>"; the form edits the action and keeps its condition.
const COND = /\s+(if|unless)\s+\S[\s\S]*$/
const cond = computed(() => COND.exec(props.modelValue ?? '')?.[0].trim() ?? '')
const setA = (b: string) => set(b && cond.value ? `${b} ${cond.value}` : b)
const setCond = (e: Event) => {
  const t = val(e), base = (props.modelValue ?? '').replace(COND, '')
  set(!t ? base : `${base} ${/^(if|unless)\s/.test(t) ? t : `if ${t}`}`)
}
function pick(k: unknown) {
  const key = String(k)
  const b = props.boards[0]?.path ?? ''
  setA(key === NONE ? '' : ({ 'go': `go:${b}|fade`, 'open-board': `open:${b}`, 'open-el': 'open:#', 'back': 'back', 'close': 'close', 'state': 'state:=', 'toggle': 'toggle:=', 'custom': props.modelValue ?? 'go:' } as Record<string, string>)[key] ?? '')
}
const target = computed(() => first.value?.target ?? '')
const board = computed(() => (props.boards.some(b => b.path === target.value) ? target.value : NONE))
const val = (e: Event) => (e.target as HTMLInputElement).value.trim()
</script>

<template>
  <div class="grid min-w-0 gap-2">
    <Label :class="lab">
      <span>{{ label }}</span>
      <Select :model-value="kind" @update:model-value="pick">
        <SelectTrigger :class="trg" :aria-label="label"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem :value="NONE">Nothing</SelectItem>
          <SelectItem v-for="k in KINDS" :key="k[0]" :value="k[0]" >{{ k[1] }}</SelectItem>
        </SelectContent>
      </Select>
    </Label>
    <template v-if="kind === 'go' || kind === 'open-board'">
      <Select :model-value="board" @update:model-value="(b) => setA(kind === 'go' ? `go:${b}|${first?.transition ?? 'fade'}` : `open:${b}`)">
        <SelectTrigger :class="trg" aria-label="Board"><SelectValue placeholder="Pick a board" /></SelectTrigger>
        <SelectContent>
          <SelectItem v-if="board === NONE" :value="NONE" disabled>{{ target || 'Pick a board' }}</SelectItem>
          <SelectItem v-for="b in boards" :key="b.path" :value="b.path">{{ b.title }}</SelectItem>
        </SelectContent>
      </Select>
      <Label v-if="kind === 'go'" :class="lab">
        <span>Transition</span>
        <Select :model-value="first?.transition ?? 'fade'" @update:model-value="(t) => setA(`go:${target}|${t}`)">
          <SelectTrigger :class="trg" aria-label="Transition"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem v-for="t in TRANSITIONS" :key="t" :value="t">{{ t.replace('-', ' ') }}</SelectItem></SelectContent>
        </Select>
      </Label>
    </template>
    <Label v-else-if="kind === 'open-el'" :class="lab">
      <span>Element id (it needs the Modal switch)</span>
      <Input :class="inp" :model-value="target" placeholder="#dialog" @change="(e: Event) => setA(`open:${val(e).startsWith('#') ? val(e) : '#' + val(e)}`)" />
    </Label>
    <div v-else-if="kind === 'state' || kind === 'toggle'" class="grid grid-cols-2 gap-2">
      <Label :class="lab"><span>Component</span><Input :class="inp" :model-value="target" placeholder="this one's parent" @change="(e: Event) => setA(`${kind}:${val(e)}=${first?.value ?? ''}`)" /></Label>
      <Label :class="lab"><span>State</span><Input :class="inp" :model-value="first?.value ?? ''" placeholder="open" @change="(e: Event) => setA(`${kind}:${target}=${val(e)}`)" /></Label>
    </div>
    <Label v-if="kind !== NONE && kind !== 'custom'" :class="lab">
      <span>Only when (optional)</span>
      <Input :class="inp" :model-value="cond" placeholder="e.g. if #email:valid & #terms:checked" @change="setCond" />
    </Label>
    <Label v-if="kind === 'custom'" :class="lab">
      <span>Actions, separated by ;</span>
      <Input :class="inp" :model-value="modelValue ?? ''" placeholder="state:menu=open; go:Home.html|fade" @change="(e: Event) => set(val(e))" />
    </Label>
  </div>
</template>
