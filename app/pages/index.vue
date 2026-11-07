<script setup lang="ts">
// Sign-in gate. Signed-in owners and members land on the dashboard.
const route = useRoute()
const { authed, load: loadOwner } = useOwner()
const cfg = ref<{ setup: boolean, github: boolean } | null>(null)

async function enter() {
  const n = route.query.next
  if (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//')) return navigateTo(n, { external: true })
  return navigateTo('/dashboard', { external: true })
}
onMounted(async () => {
  cfg.value = await $fetch('/api/auth-config').catch(() => ({ setup: false, github: false }))
  await loadOwner()
  if (authed.value) await enter()
})
useHead({ title: 'Artifact Hub' })
</script>

<template>
  <div v-if="authed !== false || !cfg" class="hub-ground center" role="status"><span class="muted">Loading…</span></div>
  <div v-else class="hub-ground center"><SignInCard :github="cfg.github" :setup="cfg.setup" @done="enter" /></div>
</template>
