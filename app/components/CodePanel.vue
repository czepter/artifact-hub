<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
const props = defineProps<{ artifactId: string, board: string | null, elementId: string | null, files: string[], busy: boolean, error: string }>()
const emit = defineEmits<{ apply: [p: { mode: 'element' | 'file', path: string, id: string | null, text: string }] }>()

const mode = ref<'element' | 'file'>('element')
const path = ref('')
const text = ref('')
const original = ref('')
const loading = ref(false)
const err = ref('')
const textFiles = computed(() => props.files.filter(f => /\.(html?|css|js|mjs|json|md|txt|svg)$/i.test(f)))

watch(() => [props.board, props.elementId], () => {
  if (props.board && (!path.value || mode.value === 'element')) path.value = props.board
  if (!props.elementId && mode.value === 'element') mode.value = 'file'
  else if (props.elementId) mode.value = 'element'
}, { immediate: true })
watch(() => [mode.value, path.value, props.elementId, props.board], load, { immediate: true })

async function load() {
  const p = mode.value === 'element' ? props.board : path.value
  if (!p) { text.value = original.value = ''; return }
  loading.value = true; err.value = ''
  try {
    const r = await $fetch<{ source: string, element: string | null }>(`/api/artifacts/${props.artifactId}/source`, { query: { path: p, ...(mode.value === 'element' && props.elementId ? { el: props.elementId } : {}) } })
    original.value = mode.value === 'element' ? (r.element ?? '') : r.source
    text.value = original.value
    if (mode.value === 'element' && r.element === null) err.value = 'That element is not in the saved source (it was added by a script or not saved yet).'
  } catch (e: any) { err.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Could not load the source'; text.value = original.value = '' } finally { loading.value = false }
}
const dirty = computed(() => text.value !== original.value)
function apply() {
  const p = mode.value === 'element' ? props.board : path.value
  if (!p) return
  emit('apply', { mode: mode.value, path: p, id: mode.value === 'element' ? props.elementId : null, text: text.value })
}
defineExpose({ reload: load })
</script>

<template>
  <div class="grid grid-cols-[minmax(0,1fr)] gap-2.5 text-[13px]">
    <ToggleGroup type="single" variant="outline" class="w-full" aria-label="What to edit" :model-value="mode" @update:model-value="(v) => v && (mode = v as 'element' | 'file')">
      <ToggleGroupItem value="element" class="flex-1" size="sm" :disabled="!elementId">Selected element</ToggleGroupItem>
      <ToggleGroupItem value="file" class="flex-1" size="sm">File</ToggleGroupItem>
    </ToggleGroup>
    <Select v-if="mode === 'file'" v-model="path">
      <SelectTrigger size="sm" class="w-full" aria-label="File"><SelectValue placeholder="Choose a file" /></SelectTrigger>
      <SelectContent><SelectItem v-for="f in textFiles" :key="f" :value="f">{{ f }}</SelectItem></SelectContent>
    </Select>
    <p v-if="mode === 'element' && !elementId" class="hint">Select an element to see its source.</p>
    <Textarea v-model="text" class="min-h-72 resize-y whitespace-pre font-mono text-xs [tab-size:2]" spellcheck="false" :disabled="loading || (mode === 'element' && !elementId)" :aria-label="mode === 'element' ? 'Element source' : 'File source'" rows="18" />
    <p v-if="err || error" class="err" role="alert">{{ err || error }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <Button size="xs" :disabled="!dirty || busy || loading" @click="apply">{{ busy ? 'Saving…' : 'Apply' }}</Button>
      <Button size="xs" variant="outline" :disabled="!dirty" @click="text = original">Revert</Button>
      <span class="hint">{{ mode === 'element' ? 'Replaces this element in the saved file.' : 'Replaces the whole file.' }} The board reloads.</span>
    </div>
  </div>
</template>

<style scoped>
.hint { color: var(--muted-foreground); font-size: 12px; margin: 0; }
</style>
