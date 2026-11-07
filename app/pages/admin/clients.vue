<script setup lang="ts">
definePageMeta({ layout: 'shell', access: 'owner' })
useHead({ title: 'Clients · Artifact Hub' })
</script>

<template>
  <h1 class="mb-5 px-1 text-xl font-semibold tracking-tight">Clients</h1>
  <ClientsBoard show-member />
</template>
