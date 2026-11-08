<script setup lang="ts">
import { TooltipProvider } from '@/components/ui/tooltip'
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <!-- The one accent (DESIGN.md: a single azure for state and the primary action) as a hairline at the top while a route loads. -->
    <NuxtLoadingIndicator color="var(--brand)" :height="2" :throttle="150" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </TooltipProvider>
</template>
