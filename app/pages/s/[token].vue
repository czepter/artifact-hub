<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <Viewer :ref-id="String(route.params.token)" />
</template>
