export interface Me { id: string, name: string, email: string, role: 'owner' | 'editor' | 'commenter' }

// One in-flight check per app instance (never module-global: the server handles many requests at once).
const inflightBy = new WeakMap<object, Promise<Me | null>>()

/**
 * The signed-in member, shared app-wide. `authed` is null until the first check finishes. The route middleware awaits
 * `ensure()` before any signed-in page renders, so by the time the shell mounts this is already settled (one /api/me per
 * session, not one per page). `revalidate()` re-checks quietly and never blanks the current member.
 */
export function useOwner() {
  const me = useState<Me | null>('hub-me', () => null)
  const authed = useState<boolean | null>('hub-authed', () => null)
  const nuxtApp = useNuxtApp()
  const api = useRequestFetch() // forwards the visitor's cookies during SSR
  async function revalidate(): Promise<Me | null> {
    const running = inflightBy.get(nuxtApp)
    if (running) return running
    const p: Promise<Me | null> = api<Me>('/api/me').then(
      (m) => { me.value = m; authed.value = true; return m },
      (e: any) => {
        // Only a real 401/403 signs the member out; a network blip keeps what we know.
        if ([401, 403].includes(e?.statusCode ?? e?.status)) { me.value = null; authed.value = false }
        else if (authed.value === null) authed.value = false
        return me.value
      },
    ).finally(() => { inflightBy.delete(nuxtApp) })
    inflightBy.set(nuxtApp, p)
    return p
  }
  /** Resolves with the cached member, fetching only the first time. */
  async function ensure(): Promise<Me | null> {
    return authed.value === null ? revalidate() : me.value
  }
  /** Back-compat name used by the public sign-in page. */
  const load = revalidate
  return { me, authed, ensure, revalidate, load }
}
