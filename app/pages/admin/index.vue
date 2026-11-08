<script setup lang="ts">
definePageMeta({ layout: 'shell', access: 'owner' })
import { Download } from '@lucide/vue'
import { Button } from '@/components/ui/button'

interface Overview { artifacts: number, versions: number, fileBytes: number, dataBytes: number, comments: number, dbBytes: number }
interface Ev { id: number, at: string, actor: string, kind: string, subject: string }
const PHRASE: Record<string, string> = {
  created: 'created', published: 'published', commented: 'commented on', replied: 'replied on', shared: 'shared', unshared: 'removed a share link on',
  authorized: 'approved client', revoked: 'revoked client', invited: 'invited', joined: 'joined', removed: 'removed member',
}
// Same cache entries as the Dashboard's owner panels.
const { data: o, loading } = useHubData('admin-overview', () => $fetch<Overview>('/api/admin/overview').catch(() => null))
const { data: activity } = useHubData('admin-activity', () => $fetch<Ev[]>('/api/admin/activity').catch(() => [] as Ev[]))
const events = computed(() => (activity.value ?? []).slice(0, 6))
useHead({ title: 'Admin · Artifact Hub' })
</script>

<template>
  <h1 class="mb-5 px-1 text-xl font-semibold tracking-tight">Overview</h1>
  <div class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
    <ConnectClient />
    <div v-if="o" class="grid grid-cols-[minmax(0,1fr)] items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Board label="Recent activity">
        <p v-if="!events.length" class="px-4 py-6 text-sm text-muted-foreground">Nothing has happened yet.</p>
        <ul v-else class="divide-y">
          <li v-for="e in events" :key="e.id" class="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
            <span class="min-w-0 truncate"><span class="font-medium">{{ e.actor }}</span> {{ PHRASE[e.kind] ?? e.kind }} <span class="font-medium">{{ e.subject }}</span></span>
            <time class="shrink-0 text-xs text-muted-foreground tabular-nums" :datetime="e.at">{{ ago(e.at) }}</time>
          </li>
        </ul>
        <div class="border-t px-4 py-2 text-xs"><NuxtLink to="/admin/activity" class="text-muted-foreground hover:text-foreground">All activity</NuxtLink></div>
      </Board>
      <Board label="Storage">
        <dl class="divide-y text-sm">
          <div class="flex justify-between px-4 py-2.5"><dt class="text-muted-foreground">Artifacts</dt><dd class="tabular-nums">{{ o.artifacts }} ({{ o.versions }} versions)</dd></div>
          <div class="flex justify-between px-4 py-2.5"><dt class="text-muted-foreground">Files, all versions</dt><dd class="tabular-nums">{{ bytes(o.fileBytes) }}</dd></div>
          <div class="flex justify-between px-4 py-2.5"><dt class="text-muted-foreground">Shared data</dt><dd class="tabular-nums">{{ bytes(o.dataBytes) }}</dd></div>
          <div class="flex justify-between px-4 py-2.5"><dt class="text-muted-foreground">Comments</dt><dd class="tabular-nums">{{ o.comments }}</dd></div>
          <div class="flex justify-between px-4 py-2.5"><dt class="text-muted-foreground">Database file</dt><dd class="tabular-nums">{{ bytes(o.dbBytes) }}</dd></div>
        </dl>
        <div class="border-t p-3"><Button as-child variant="outline" size="sm"><a href="/api/export" download><Download />Export all as zip</a></Button></div>
      </Board>
    </div>
    <div v-else-if="loading" class="grid grid-cols-[minmax(0,1fr)] items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><BoardSkeleton :rows="5" /><BoardSkeleton :rows="5" /></div>
    <p v-else class="px-1 text-sm text-muted-foreground">Could not load the overview. Reload to try again.</p>
  </div>
</template>
