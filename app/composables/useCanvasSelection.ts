import type { Box, GeomItem } from '#shared/canvasGeometry'
import type { Ref } from 'vue'
import { itemBox, unionBox } from '#shared/canvasGeometry'

export { boardKey, noteKey, refOfKey, type SelRef } from '#shared/canvasItemOps'
import { refOfKey, type SelRef } from '#shared/canvasItemOps'

/**
 * The canvas selection: one Set of keys (`n:<id>` for notes, `b:<path>` for boards), plus the combined
 * bounding box of what is selected. `items` are all selectable things with their live geometry.
 */
export function useCanvasSelection(items: Ref<GeomItem[]>) {
  const keys = shallowRef<Set<string>>(new Set())
  const byKey = computed(() => new Map(items.value.map(i => [i.key, i])))
  /** Selected items that still exist, in canvas order. */
  const selected = computed(() => items.value.filter(i => keys.value.has(i.key)))
  const count = computed(() => selected.value.length)
  const single = computed(() => (selected.value.length === 1 ? selected.value[0]! : null))
  /** Combined box of the selection (also for a single item). */
  const bbox = computed<Box | null>(() => unionBox(selected.value.map(itemBox)))
  const refs = computed<SelRef[]>(() => selected.value.map(i => refOfKey(i.key)))

  const has = (key: string) => keys.value.has(key)
  function set(list: string[]) { keys.value = new Set(list) }
  function clear() { if (keys.value.size) keys.value = new Set() }
  function toggle(key: string) { const s = new Set(keys.value); if (!s.delete(key)) s.add(key); keys.value = s }
  function add(key: string) { if (!keys.value.has(key)) keys.value = new Set([...keys.value, key]) }
  function selectAll() { keys.value = new Set(items.value.map(i => i.key)) }
  const only = (key: string | null) => set(key ? [key] : [])

  return { keys, byKey, selected, count, single, bbox, refs, has, set, clear, toggle, add, selectAll, only }
}
