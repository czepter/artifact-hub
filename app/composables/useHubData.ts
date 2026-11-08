import type { AsyncDataOptions } from '#app'

/**
 * Stale-while-revalidate on top of useAsyncData, shared by every signed-in page.
 *  - A stable `key` means a page and the shell (or two pages) share one cache entry.
 *  - Navigating back renders the cached copy at once, then refetches quietly; the data is never blanked while that runs.
 *  - `loading` is true only for the first load (nothing to show yet); `refreshing` is a background revalidation.
 * Mutations call `invalidate(...keys)`; keys whose page is not mounted simply revalidate the next time it is.
 */
export function useHubData<T>(key: MaybeRefOrGetter<string>, fetcher: () => Promise<T>, opts: Pick<AsyncDataOptions<T>, 'immediate' | 'default'> & { revalidate?: boolean } = {}) {
  const { revalidate = true, ...rest } = opts
  const r = useAsyncData<T>(key, fetcher, {
    ...rest,
    // Navigating back: serve what we already have (initial load only); an explicit refresh() always goes to the network.
    getCachedData: (k, app, ctx) => (ctx.cause === 'refresh:manual' || ctx.cause === 'refresh:hook' ? undefined : app.payload.data[k] ?? app.static.data[k]),
  })
  const hadCache = r.data.value !== undefined && r.data.value !== null
  if (revalidate && hadCache && import.meta.client && rest.immediate !== false) onMounted(() => { void r.refresh() })
  const loading = computed(() => r.status.value === 'pending' && (r.data.value === undefined || r.data.value === null))
  const refreshing = computed(() => r.status.value === 'pending' && !loading.value)
  return { ...r, loading, refreshing }
}

/** Re-fetch these keys now if their page is on screen; otherwise they revalidate on next visit. A key also covers its `key:suffix` variants (`artifacts` -> `artifacts:<workspace>`). */
export function invalidate(...keys: string[]) {
  const have = Object.keys(useNuxtApp().payload.data)
  return refreshNuxtData(have.filter(h => keys.some(k => h === k || h.startsWith(`${k}:`))))
}
