// Declarative gate: a page opts in with definePageMeta({ access: 'member' | 'owner' }); pages without `access` are public.
// Runs on the cached member (one /api/me per session), so an unauthenticated visitor is redirected before the shell
// (and its nav) ever mounts. Sign-in lives on `/`, which hands the visitor back to `next`.
declare module '#app' {
  interface PageMeta { access?: 'member' | 'owner' }
}
declare module 'vue-router' {
  interface RouteMeta { access?: 'member' | 'owner' }
}

export default defineNuxtRouteMiddleware(async (to) => {
  const access = to.meta.access
  if (!access) return
  const { ensure } = useOwner()
  const me = await ensure()
  if (!me) return navigateTo({ path: '/', query: to.fullPath === '/dashboard' ? {} : { next: to.fullPath } })
  if (access === 'owner' && me.role !== 'owner') return navigateTo('/dashboard')
})
