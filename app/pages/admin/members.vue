<script setup lang="ts">
definePageMeta({ layout: 'shell', access: 'owner' })
import { ChevronDown, Copy, MoreHorizontal, Plus } from '@lucide/vue'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

interface Member { id: string, name: string, email: string, role: string, created_at: string }
interface Invite { id: string, email: string, role: string, created_at: string }
const { me } = useOwner()
const { data, error: loadError, refresh } = useHubData('members', () => $fetch<{ members: Member[], invites: Invite[] }>('/api/members'))
const error = computed(() => (data.value ? '' : (loadError.value as any)?.data?.statusMessage ?? (loadError.value ? 'Could not load members.' : '')))
const load = refresh
const inviteOpen = ref(false)
const inviteEmail = ref('')
const inviteRole = ref<'editor' | 'commenter'>('editor')
const inviteLink = ref('')
const inviteErr = ref('')
const copied = ref('')
const removing = ref<Member | null>(null)

const initials = (m: { name?: string, email: string }) => (m.name || m.email).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?'

function openInvite() { inviteEmail.value = ''; inviteRole.value = 'editor'; inviteLink.value = ''; inviteErr.value = ''; inviteOpen.value = true }
async function createInvite() {
  inviteErr.value = ''
  try {
    const r = await $fetch<{ url: string }>('/api/invites', { method: 'POST', body: { email: inviteEmail.value, role: inviteRole.value } })
    inviteLink.value = r.url
    await load()
  } catch (e: any) { inviteErr.value = e?.data?.statusMessage ?? 'Could not create the invitation.' }
}
async function copy(text: string, key: string) {
  await navigator.clipboard.writeText(text)
  copied.value = key
  setTimeout(() => (copied.value = ''), 1500)
}
async function setRole(m: Member, role: string) { await $fetch(`/api/members/${m.id}`, { method: 'PATCH', body: { role } }); await load() }
async function remove() { if (!removing.value) return; await $fetch(`/api/members/${removing.value.id}`, { method: 'DELETE' }); removing.value = null; await load() }
async function revoke(i: Invite) { await $fetch(`/api/invites/${i.id}`, { method: 'DELETE' }); await load() }
useHead({ title: 'Members · Artifact Hub' })
</script>

<template>
  <p v-if="error" class="px-1 text-sm text-muted-foreground" role="alert">{{ error }}</p>
  <BoardSkeleton v-else-if="!data" />
  <template v-else>
    <Teleport defer to="#shell-actions"><Button size="sm" @click="openInvite"><Plus />Invite</Button></Teleport>
    <h1 class="mb-5 px-1 text-xl font-semibold tracking-tight">Members</h1>
    <div class="grid gap-6">
      <Board :label="`People (${data.members.length})`">
        <ul class="divide-y">
          <li v-for="m in data.members" :key="m.id" class="flex items-center gap-3 px-4 py-3">
            <Avatar class="size-8"><AvatarFallback class="text-xs font-medium">{{ initials(m) }}</AvatarFallback></Avatar>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{{ m.name || m.email }}<span v-if="m.id === me?.id" class="ml-1 font-normal text-muted-foreground">(you)</span></div>
              <div class="truncate text-xs text-muted-foreground">{{ m.email }}</div>
            </div>
            <Badge v-if="m.role === 'owner'" variant="secondary">Owner</Badge>
            <DropdownMenu v-else>
              <DropdownMenuTrigger as-child><Button variant="outline" size="sm" class="capitalize">{{ m.role }}<ChevronDown /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup :model-value="m.role" @update:model-value="(v) => setRole(m, String(v))">
                  <DropdownMenuRadioItem value="editor">Editor</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="commenter">Commenter</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu v-if="m.role !== 'owner'">
              <DropdownMenuTrigger as-child><Button variant="ghost" size="icon-sm" aria-label="Member actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" @select="removing = m">Remove member</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        </ul>
      </Board>
      <Board v-if="data.invites.length" :label="`Invitations (${data.invites.length})`">
        <ul class="divide-y">
          <li v-for="i in data.invites" :key="i.id" class="flex items-center gap-3 px-4 py-3">
            <div class="min-w-0 flex-1 truncate text-sm">{{ i.email }}</div>
            <Badge variant="secondary" class="capitalize">{{ i.role }}</Badge>
            <time class="text-xs text-muted-foreground" :datetime="i.created_at">{{ ago(i.created_at) }}</time>
            <Button variant="ghost" size="sm" @click="revoke(i)">Revoke</Button>
          </li>
        </ul>
      </Board>
    </div>

    <Dialog v-model:open="inviteOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>{{ inviteLink ? 'Send this link to them. It works once, for this e-mail address.' : 'They sign up with the link, using this e-mail address.' }}</DialogDescription>
        </DialogHeader>
        <div v-if="!inviteLink" class="grid gap-4">
          <div class="grid gap-1.5"><Label for="iemail">E-mail</Label><Input id="iemail" v-model="inviteEmail" type="email" autocomplete="off" /></div>
          <div class="grid gap-1.5">
            <Label>Role</Label>
            <ToggleGroup type="single" variant="outline" :model-value="inviteRole" class="justify-start" @update:model-value="(v) => { if (v) inviteRole = v as 'editor' | 'commenter' }">
              <ToggleGroupItem value="commenter">Commenter</ToggleGroupItem>
              <ToggleGroupItem value="editor">Editor</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <Alert v-if="inviteErr" variant="destructive" role="alert"><AlertDescription>{{ inviteErr }}</AlertDescription></Alert>
        </div>
        <div v-else class="flex items-center gap-2">
          <Input :model-value="inviteLink" readonly class="font-mono text-xs" aria-label="Invitation link" />
          <Button variant="outline" @click="copy(inviteLink, 'new')"><Copy />{{ copied === 'new' ? 'Copied' : 'Copy' }}</Button>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="inviteOpen = false">{{ inviteLink ? 'Done' : 'Cancel' }}</Button>
          <Button v-if="!inviteLink" :disabled="!inviteEmail" @click="createInvite">Create invite link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="!!removing" @update:open="(o: boolean) => { if (!o) removing = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {{ removing?.name || removing?.email }}?</AlertDialogTitle>
          <AlertDialogDescription>They lose access right away. Their sessions end and the clients they approved stop working. Their comments stay.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive text-white hover:bg-destructive/90" @click="remove">Remove member</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </template>
</template>
