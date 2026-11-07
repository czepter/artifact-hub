<script setup lang="ts">
// One AppShell for every signed-in page, so the nav stays mounted while pages load and swap.
// Pages with header buttons teleport them into #shell-actions.
const { me } = useOwner()
</script>

<template>
  <AppShell :me="me">
    <template #actions><div id="shell-actions" class="contents" /></template>
    <slot />
  </AppShell>
</template>
