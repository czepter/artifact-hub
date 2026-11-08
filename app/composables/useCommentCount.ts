/** Open-thread count for the nav badge: one shared cache entry, revalidated on every route change, never reset to 0. */
export function useCommentCount() {
  const route = useRoute()
  const { data, refresh } = useHubData<{ open: number }>('comment-count', () => $fetch<{ open: number }>('/api/comments/count'))
  watch(() => route.path, () => { void refresh() })
  return computed(() => data.value?.open ?? 0)
}
