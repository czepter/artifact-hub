<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
interface Def { editor?: string | null, default?: unknown, options?: unknown[], min?: number, max?: number, step?: number, unit?: string, section?: string }

const props = defineProps<{ board: string | null, defs: Record<string, Def> | null, values: Record<string, unknown> }>()
const emit = defineEmits<{ change: [values: Record<string, unknown>] }>()

const entries = computed(() => Object.entries(props.defs ?? {}).filter(([k, d]) => !k.startsWith('$') && d && d.editor))
const sections = computed(() => {
  const m = new Map<string, [string, Def][]>()
  for (const e of entries.value) { const s = e[1].section || ''; if (!m.has(s)) m.set(s, []); m.get(s)!.push(e) }
  return [...m.entries()]
})
const cur = (name: string, d: Def) => (name in props.values ? props.values[name] : d.default)
const changed = computed(() => Object.keys(props.values).length > 0)

function set(name: string, d: Def, v: unknown) {
  const next = { ...props.values }
  if (v === d.default || v === '' || v === undefined) delete next[name]
  else next[name] = v
  emit('change', next)
}
const opt = (o: unknown) => (o && typeof o === 'object' ? o as { value: string, label?: string } : { value: String(o), label: String(o) })
const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000')
</script>

<template>
  <div class="grid grid-cols-[minmax(0,1fr)] gap-3 text-[13px]">
    <p v-if="!board" class="hint">Select a board to see its tweaks.</p>
    <p v-else-if="!defs || !entries.length" class="hint">
      This board declares no tweaks. Tweaks are the few levers a <code class="rounded bg-muted px-1">.dc.html</code> board exposes through <code class="rounded bg-muted px-1">data-props</code> (an accent colour, a density switch, …).
    </p>
    <template v-else>
      <div class="flex items-center justify-between gap-2"><span class="truncate text-muted-foreground">{{ board }}</span><Button size="xs" variant="outline" :disabled="!changed" @click="emit('change', {})">Reset all</Button></div>
      <section v-for="[title, list] in sections" :key="title" class="grid gap-2.5">
        <h3 v-if="title" class="sec">{{ title }}</h3>
        <div v-for="[name, d] in list" :key="name" class="grid grid-cols-[96px_1fr] items-center gap-x-2.5 gap-y-1.5">
          <Label class="truncate text-muted-foreground">{{ name }}<span v-if="name in values" class="text-primary"> ●</span></Label>
          <Switch v-if="d.editor === 'boolean'" :model-value="!!cur(name, d)" :aria-label="name" @update:model-value="set(name, d, !!$event)" />
          <template v-else-if="d.editor === 'color'">
            <div class="flex items-center gap-1.5">
              <Input type="color" class="size-8 shrink-0 cursor-pointer p-0.5" :model-value="hex(cur(name, d))" :aria-label="name" @change="set(name, d, ($event.target as HTMLInputElement).value)" />
              <Input class="h-8" :model-value="String(cur(name, d) ?? '')" @change="set(name, d, ($event.target as HTMLInputElement).value.trim())" />
            </div>
            <div v-if="d.options?.length" class="col-start-2 flex gap-1.5">
              <Button v-for="o in d.options" :key="String(o)" variant="outline" size="icon-xs" class="size-5 rounded-full p-0" :style="{ background: String(o) }" :title="String(o)" :aria-label="`Use ${o}`" @click.prevent="set(name, d, String(o))" />
            </div>
          </template>
          <Select v-else-if="d.editor === 'enum'" :model-value="String(cur(name, d) ?? '')" @update:model-value="(v) => set(name, d, String(v))">
            <SelectTrigger size="sm" class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem v-for="o in d.options ?? []" :key="opt(o).value" :value="opt(o).value">{{ opt(o).label ?? opt(o).value }}</SelectItem></SelectContent>
          </Select>
          <div v-else-if="d.editor === 'range'" class="flex items-center gap-2">
            <Slider class="flex-1" :min="d.min ?? 0" :max="d.max ?? 100" :step="d.step ?? 1" :model-value="[Number(cur(name, d) ?? 0)]" :aria-label="name" @update:model-value="(v) => v && set(name, d, v[0])" />
            <b class="min-w-[3ch] text-right font-medium">{{ cur(name, d) }}{{ d.unit ?? '' }}</b>
          </div>
          <Input v-else-if="d.editor === 'int' || d.editor === 'float'" class="h-8" type="number" :min="d.min" :max="d.max" :step="d.step ?? (d.editor === 'int' ? 1 : 0.1)" :model-value="Number(cur(name, d) ?? 0)" @change="set(name, d, Number(($event.target as HTMLInputElement).value))" />
          <Input v-else class="h-8" :model-value="String(cur(name, d) ?? '')" @change="set(name, d, ($event.target as HTMLInputElement).value)" />
        </div>
      </section>
      <p class="hint">Changes preview live and are saved with the canvas.</p>
    </template>
  </div>
</template>

<style scoped>
.sec { margin: 0; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted-foreground); }
.hint { color: var(--muted-foreground); font-size: 12px; margin: 0; }
</style>
