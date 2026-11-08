<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

// The access choice on the consent screen: three plain presets, with the exact scopes one disclosure away.
const props = defineProps<{ client: string, allowed: string[], requested: string[] }>()
const scopes = defineModel<string[]>('scopes', { required: true })
// The name of the current grant ("look only", "custom access", ...), for the approve button.
const grant = defineModel<string>('grant', { default: 'look only' })

const PRESETS = [
  { key: 'look', title: 'Look only', desc: 'Open artifacts, files, comments and shared data. Nothing can be changed.', scopes: ['read'] },
  { key: 'review', title: 'Review and reply', desc: 'Everything in Look only, and answer or resolve comment threads.', scopes: ['read', 'comment'] },
  { key: 'publish', title: 'Publish and edit', desc: 'Everything above, and create artifacts, publish versions, edit files and write shared data.', scopes: ['read', 'comment', 'write'] },
]
const SCOPES: Record<string, { label: string, hint: string }> = {
  read: { label: 'Read', hint: 'Artifacts, files, comments and shared data' },
  comment: { label: 'Comment', hint: 'Reply to and resolve comment threads' },
  write: { label: 'Publish and edit', hint: 'Create artifacts, publish versions, edit files, write shared data' },
  share: { label: 'Share', hint: 'Create share links' },
}
const same = (a: string[], b: string[]) => a.length === b.length && a.every(s => b.includes(s))
const withRead = (l: string[]) => [...new Set(['read', ...l])]
const fits = (p: { scopes: string[] }) => p.scopes.every(s => props.allowed.includes(s))

const want = withRead(props.requested)
const exact = PRESETS.find(p => same(p.scopes, want))
// Closest preset that fits inside what was asked for and what the role allows.
const start = (exact && fits(exact) ? exact : [...PRESETS].reverse().find(p => fits(p) && p.scopes.every(s => want.includes(s)))) ?? PRESETS[0]!
scopes.value = [...start.scopes]
const open = ref(!exact)

const current = computed(() => PRESETS.find(p => same(p.scopes, withRead(scopes.value))))
const radio = computed({ get: () => current.value?.key ?? '', set: (k: string) => { const p = PRESETS.find(x => x.key === k); if (p) scopes.value = [...p.scopes] } })
watchEffect(() => { grant.value = current.value ? current.value.title.toLowerCase() : 'custom access' })
const notGranted = computed(() => Object.keys(SCOPES).filter(s => s !== 'read' && !scopes.value.includes(s)).map(s => SCOPES[s]!.label))
function toggle(s: string, on: boolean) { scopes.value = withRead(on ? [...scopes.value, s] : scopes.value.filter(x => x !== s)) }
</script>

<template>
  <div class="grid gap-3">
    <div class="grid gap-2">
      <div id="consent-presets-label" class="text-sm font-medium">What may {{ client }} do?</div>
      <RadioGroup v-model="radio" aria-labelledby="consent-presets-label" class="gap-2">
        <Label v-for="p in PRESETS" :key="p.key" :for="`preset-${p.key}`"
          class="grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-lg border px-3.5 py-3 font-normal transition-colors hover:bg-accent has-[[data-state=checked]]:border-foreground has-[[data-state=checked]]:bg-muted/60 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:disabled]:hover:bg-transparent">
          <RadioGroupItem :id="`preset-${p.key}`" :value="p.key" :disabled="!fits(p)" :aria-labelledby="`preset-${p.key}-t`" :aria-describedby="`preset-${p.key}-d`" class="mt-0.5" />
          <span class="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span :id="`preset-${p.key}-t`">{{ p.title }}</span>
            <Badge v-if="p === exact" variant="secondary">Requested</Badge>
          </span>
          <span :id="`preset-${p.key}-d`" class="col-start-2 text-xs text-muted-foreground">{{ p.desc }}</span>
          <span v-if="!fits(p)" class="col-start-2 text-xs text-muted-foreground">Not available for your role.</span>
          <span class="col-start-2 mt-1 flex flex-wrap gap-1">
            <Badge v-for="s in p.scopes" :key="s" variant="outline" class="font-normal">{{ SCOPES[s]!.label }}</Badge>
          </span>
        </Label>
      </RadioGroup>
      <p v-if="notGranted.length" class="text-xs text-muted-foreground">Not granted: {{ notGranted.join(', ') }}</p>
    </div>
    <Collapsible v-model:open="open" class="rounded-lg border">
      <CollapsibleTrigger class="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3.5 py-2.5 text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <span class="flex items-center gap-2">Choose exact access <Badge v-if="!current" variant="secondary">Custom</Badge></span>
        <ChevronDown class="size-4 text-muted-foreground transition-transform" :class="open && 'rotate-180'" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p v-if="!exact" class="border-t px-3.5 py-2 text-xs text-muted-foreground">{{ client }} asked for: {{ want.map(s => SCOPES[s]?.label ?? s).join(', ') }}.</p>
        <div v-for="(meta, key) in SCOPES" :key="key" class="flex items-start gap-3 border-t px-3.5 py-3">
          <Checkbox :id="`s-${key}`" class="mt-0.5" :model-value="scopes.includes(key as string) || key === 'read'" :disabled="key === 'read' || !allowed.includes(key as string)" @update:model-value="(v) => toggle(key as string, v === true)" />
          <Label :for="`s-${key}`" class="grid gap-0.5 font-normal"><span class="font-medium">{{ meta.label }}</span><span class="text-xs text-muted-foreground">{{ meta.hint }}{{ allowed.includes(key as string) ? '' : ' (not available for your role)' }}</span></Label>
        </div>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>
