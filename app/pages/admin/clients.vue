<script setup lang="ts">
const { me, authed, load: loadOwner } = useOwner()
onMounted(async () => {
  await loadOwner()
  if (!authed.value) return navigateTo('/', { external: true })
  if (me.value?.role !== 'owner') return navigateTo('/dashboard', { external: true })
})
useHead({ title: 'Clients · Artifact Hub' })
</script>

<template>
  <div v-if="!me" class="hub-ground center" role="status"><span class="muted">Loading…</span></div>
  <AppShell v-else :me="me">
    <h1 class="mb-5 px-1 text-xl font-semibold tracking-tight">Clients</h1>
    <ClientsBoard show-member />
  </AppShell>
</template>
