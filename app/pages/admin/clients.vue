<script setup lang="ts">
definePageMeta({ layout: 'shell' })
const { me, authed, load: loadOwner } = useOwner()
onMounted(async () => {
  await loadOwner()
  if (!authed.value) return navigateTo('/', { external: true })
  if (me.value?.role !== 'owner') return navigateTo('/dashboard', { external: true })
})
useHead({ title: 'Clients · Artifact Hub' })
</script>

<template>
  <p v-if="!me" class="px-1 text-sm text-muted-foreground" role="status">Loading…</p>
  <template v-else>
    <h1 class="mb-5 px-1 text-xl font-semibold tracking-tight">Clients</h1>
    <ClientsBoard show-member />
  </template>
</template>
