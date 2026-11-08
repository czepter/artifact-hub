<script setup lang="ts">
// Sign-in gate. Signed-in owners and members land on the dashboard.
const route = useRoute()
const { me, authed, ensure } = useOwner()
// Rendered on the server: the visitor's cookie is forwarded, so a signed-in member is redirected before any HTML is sent
// and a guest gets the sign-in card in the first response (no "Loading…" screen).
const { data: cfg } = await useFetch<{ setup: boolean, github: boolean }>('/api/auth-config', { key: 'auth-config', default: () => ({ setup: false, github: false }) })
await ensure()
if (me.value) await enter(false)

// After signing in a full load starts the session clean; an already-signed-in visitor just moves on.
async function enter(external = true) {
  const n = route.query.next
  if (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//')) return navigateTo(n, { external })
  return navigateTo('/dashboard', { external })
}
useHead({ title: 'Artifact Hub' })
</script>

<template>
  <div class="hub-ground center"><SignInCard v-if="authed === false && cfg" :github="cfg.github" :setup="cfg.setup" @done="enter()" /></div>
</template>
