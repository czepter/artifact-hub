<script setup lang="ts">
import { Copy } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Share { token: string, role: string, created_at: string, artifact_id: string, title: string }
const { me, authed, load: loadOwner } = useOwner()
const shares = ref<Share[] | null>(null)
const copied = ref('')
async function load() { shares.value = await $fetch<Share[]>('/api/shares').catch(() => []) }
onMounted(async () => {
  await loadOwner()
  if (!authed.value) return navigateTo('/', { external: true })
  if (me.value?.role !== 'owner') return navigateTo('/dashboard', { external: true })
  await load()
})
async function copy(s: Share) {
  await navigator.clipboard.writeText(`${location.origin}/s/${s.token}`)
  copied.value = s.token
  setTimeout(() => (copied.value = ''), 1500)
}
async function revoke(s: Share) { await $fetch(`/api/artifacts/${s.artifact_id}/shares/${s.token}`, { method: 'DELETE' }); await load() }
useHead({ title: 'Share links · Artifact Hub' })
</script>

<template>
  <div v-if="!me || !shares" class="hub-ground center" role="status"><span class="muted">Loading…</span></div>
  <AppShell v-else :me="me">
    <h1 class="mb-5 px-1 text-xl font-semibold tracking-tight">Share links</h1>
    <Board :label="`Active links (${shares.length})`">
      <p v-if="!shares.length" class="px-4 py-6 text-sm text-muted-foreground">No share links. Artifacts are private until someone creates one from the artifact's Share menu.</p>
      <Table v-else>
        <TableHeader><TableRow><TableHead class="pl-4">Artifact</TableHead><TableHead>Access</TableHead><TableHead>Created</TableHead><TableHead class="w-0 pr-4" /></TableRow></TableHeader>
        <TableBody>
          <TableRow v-for="s in shares" :key="s.token">
            <TableCell class="pl-4"><NuxtLink :to="`/a/${s.artifact_id}`" class="font-medium hover:underline">{{ s.title }}</NuxtLink></TableCell>
            <TableCell><Badge variant="secondary">{{ s.role === 'comment' ? 'Can comment' : 'View only' }}</Badge></TableCell>
            <TableCell class="text-muted-foreground"><time :datetime="s.created_at">{{ ago(s.created_at) }}</time></TableCell>
            <TableCell class="whitespace-nowrap pr-4 text-right">
              <Button variant="outline" size="sm" @click="copy(s)"><Copy />{{ copied === s.token ? 'Copied' : 'Copy link' }}</Button>
              <Button variant="ghost" size="sm" @click="revoke(s)">Revoke</Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Board>
  </AppShell>
</template>
