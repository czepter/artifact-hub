<script setup lang="ts">
import { TooltipProvider } from '@/components/ui/tooltip'
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <NuxtPage />
  </TooltipProvider>
</template>
