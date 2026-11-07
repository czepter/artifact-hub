<script setup lang="ts">
// Connected MCP clients (OAuth grants). Owners see everyone's; members see their own.
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Grant { family: string, client: string, member_name: string | null, member_email: string | null, scope: string, authorized_at: number | null, last_used: number | null, refresh_expires: number }
const props = defineProps<{ showMember?: boolean }>()
const grants = ref<Grant[] | null>(null)
const revoking = ref<Grant | null>(null)
const SCOPE_LABEL: Record<string, string> = { read: 'Read', comment: 'Comment', write: 'Publish and edit', share: 'Share' }

async function load() { grants.value = await $fetch<Grant[]>('/api/grants').catch(() => []) }
async function revoke() {
  if (!revoking.value) return
  await $fetch(`/api/grants/${revoking.value.family}`, { method: 'DELETE' })
  revoking.value = null
  await load()
}
const expires = (s: number) => new Date(s * 1000).toLocaleDateString()
onMounted(load)
defineExpose({ load })
</script>

<template>
  <Board :label="`Connected clients${grants ? ` (${grants.length})` : ''}`">
    <p v-if="grants && !grants.length" class="px-4 py-6 text-sm text-muted-foreground">No clients are connected. An MCP client appears here after you approve it.</p>
    <Table v-else-if="grants">
      <TableHeader>
        <TableRow>
          <TableHead class="pl-4">Client</TableHead>
          <TableHead v-if="props.showMember">Member</TableHead>
          <TableHead>Access</TableHead>
          <TableHead>Authorised</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead class="w-0 pr-4" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="g in grants" :key="g.family">
          <TableCell class="pl-4 font-medium">{{ g.client }}</TableCell>
          <TableCell v-if="props.showMember" class="text-muted-foreground">{{ g.member_name || g.member_email || 'Unknown' }}</TableCell>
          <TableCell><div class="flex flex-wrap gap-1"><Badge v-for="s in g.scope.split(' ')" :key="s" variant="secondary">{{ SCOPE_LABEL[s] ?? s }}</Badge></div></TableCell>
          <TableCell class="text-muted-foreground">{{ agoS(g.authorized_at) }}</TableCell>
          <TableCell class="text-muted-foreground">{{ agoS(g.last_used) }}</TableCell>
          <TableCell class="text-muted-foreground">{{ expires(g.refresh_expires) }}</TableCell>
          <TableCell class="pr-4 text-right"><Button variant="outline" size="sm" @click="revoking = g">Revoke</Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
    <p v-else class="px-4 py-6 text-sm text-muted-foreground" role="status">Loading…</p>

    <AlertDialog :open="!!revoking" @update:open="(o: boolean) => { if (!o) revoking = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke “{{ revoking?.client }}”?</AlertDialogTitle>
          <AlertDialogDescription>It loses access right away. To use it again, its member has to approve it again.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive text-white hover:bg-destructive/90" @click="revoke">Revoke access</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Board>
</template>
