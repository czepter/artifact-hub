/** Sticky notes and text grow with their content, so their real height is read from the page (world px, unscaled). */
export function useNoteHeights(viewport: Ref<HTMLElement | undefined>) {
  const heights = reactive<Record<string, number>>({})
  let ro: ResizeObserver | undefined
  function measure() {
    ro ??= new ResizeObserver((entries) => { for (const en of entries) { const el = en.target as HTMLElement; if (!el.isConnected) { ro!.unobserve(el); continue } if (el.dataset.id) heights[el.dataset.id] = el.offsetHeight } })
    viewport.value?.querySelectorAll<HTMLElement>('.note.sticky[data-id], .note.text[data-id]').forEach(el => ro!.observe(el))
  }
  onMounted(measure)
  onBeforeUnmount(() => ro?.disconnect())
  return { heights, measure }
}
