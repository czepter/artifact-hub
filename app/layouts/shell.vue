<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
// One AppShell for every signed-in page, so the nav stays mounted while pages load and swap.
// The route middleware has already settled `me` before this renders. Pages with header buttons teleport them into #shell-actions.
const { me, revalidate } = useOwner()
// Quietly re-check the session when the tab becomes visible again (at most once a minute); never blanks the nav.
let checkedAt = Date.now()
if (import.meta.client) useEventListener(document, 'visibilitychange', () => {
  if (document.visibilityState !== 'visible' || Date.now() - checkedAt < 60_000) return
  checkedAt = Date.now()
  void revalidate().then((m) => { if (!m) navigateTo('/') })
})
</script>

<template>
  <AppShell :me="me">
    <template #actions><div id="shell-actions" class="contents" /></template>
    <slot />
  </AppShell>
</template>
