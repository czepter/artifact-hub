<script setup lang="ts">
definePageMeta({ layout: 'shell' })
interface Ev { id: number, at: string, actor: string, kind: string, subject: string }
const PHRASE: Record<string, string> = {
  created: 'created', published: 'published', commented: 'commented on', replied: 'replied on', shared: 'shared', unshared: 'removed a share link on',
  authorized: 'approved client', revoked: 'revoked client', invited: 'invited', joined: 'joined', removed: 'removed member',
}
const { me, authed, load: loadOwner } = useOwner()
const events = ref<Ev[] | null>(null)
onMounted(async () => {
  await loadOwner()
  if (!authed.value) return navigateTo('/', { external: true })
  if (me.value?.role !== 'owner') return navigateTo('/dashboard', { external: true })
  events.value = await $fetch<Ev[]>('/api/admin/activity').catch(() => [])
})
useHead({ title: 'Activity · Artifact Hub' })
</script>

<template>
  <p v-if="!me || !events" class="px-1 text-sm text-muted-foreground" role="status">Loading…</p>
  <template v-else>
    <h1 class="mb-5 px-1 text-xl font-semibold tracking-tight">Activity</h1>
    <Board label="Latest 200 events">
      <p v-if="!events.length" class="px-4 py-6 text-sm text-muted-foreground">Nothing has happened yet. Publishing, comments, share links, clients and members show up here.</p>
      <ul v-else class="divide-y">
        <li v-for="e in events" :key="e.id" class="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
          <span class="min-w-0 truncate"><span class="font-medium">{{ e.actor }}</span> {{ PHRASE[e.kind] ?? e.kind }} <span class="font-medium">{{ e.subject }}</span></span>
          <time class="shrink-0 text-xs text-muted-foreground tabular-nums" :datetime="e.at" :title="new Date(e.at).toLocaleString()">{{ ago(e.at) }}</time>
        </li>
      </ul>
    </Board>
  </template>
</template>
