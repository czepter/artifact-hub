import type { CanvasOp } from '#shared/canvasOps'
import { groupOps, lockOps, ungroupOps } from '#shared/canvasItemOps'
import type { useCanvasSelection } from './useCanvasSelection'

/** Group, ungroup, lock and unlock the selection. Each is one batch. Locked items are not grouped. */
export function useCanvasGrouping(selection: ReturnType<typeof useCanvasSelection>, send: (...ops: CanvasOp[]) => void, newId: () => string) {
  function groupSelection() {
    const items = selection.selected.value.filter(i => !i.locked)
    if (items.length < 2) return false
    send(...groupOps(items, 'g' + newId().slice(2)))
    return true
  }
  function ungroupSelection() {
    const ops = ungroupOps(selection.selected.value.filter(i => !i.locked))
    send(...ops)
    return ops.length > 0
  }
  /** Locks the selection, or unlocks it when everything selected is already locked. */
  function toggleLock() {
    const items = selection.selected.value
    if (!items.length) return false
    send(...lockOps(items, items.some(i => !i.locked)))
    return true
  }
  const selectionLocked = computed(() => selection.count.value > 0 && selection.selected.value.every(i => i.locked))
  const selectionGrouped = computed(() => selection.selected.value.some(i => i.group))
  return { groupSelection, ungroupSelection, toggleLock, selectionLocked, selectionGrouped }
}
