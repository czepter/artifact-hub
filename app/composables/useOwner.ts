export interface Me { id: string, name: string, email: string, role: 'owner' | 'editor' | 'commenter' }

/** The signed-in member for the app chrome. `authed` is null until the first check finishes. */
export function useOwner() {
  const me = useState<Me | null>('hub-me', () => null)
  const authed = useState<boolean | null>('hub-authed', () => null)
  async function load() {
    try {
      me.value = await $fetch<Me>('/api/me')
      authed.value = true
    } catch {
      me.value = null
      authed.value = false
    }
  }
  return { me, authed, load }
}
