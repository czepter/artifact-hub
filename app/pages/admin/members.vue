<script setup lang="ts">
definePageMeta({ layout: 'shell', access: 'owner' })
import { Check, ChevronDown, Copy, LoaderCircle, MoreHorizontal, Plus } from '@lucide/vue'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
const inviteEmail = ref('')
const inviteRole = ref<'editor' | 'commenter'>('editor')
const inviteErr = ref('')
const inviteBusy = ref(false)
// The link is only returned when the invitation is created, so it lives in local state for this session.
const links = ref<Record<string, string>>({})
const fresh = ref('')
const copied = ref('')
const emailValid = computed(() => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(inviteEmail.value.trim()))
const removing = ref<Member | null>(null)

const initials = (m: { name?: string, email: string }) => (m.name || m.email).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?'

const focusEmail = () => (document.getElementById('invite-email') as HTMLInputElement | null)?.focus()
function openInvite() {
  const form = document.getElementById('invite-form')
  form?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  focusEmail()
}
async function createInvite() {
  if (!emailValid.value || inviteBusy.value) return
  inviteErr.value = ''
  inviteBusy.value = true
  try {
    const r = await $fetch<{ id: string, url: string }>('/api/invites', { method: 'POST', body: { email: inviteEmail.value.trim(), role: inviteRole.value } })
    links.value[r.id] = r.url
    fresh.value = r.id
    setTimeout(() => { if (fresh.value === r.id) fresh.value = '' }, 2500)
    inviteEmail.value = ''
    await load()
    await nextTick()
    focusEmail()
  } catch (e: any) { inviteErr.value = e?.data?.statusMessage ?? 'Could not create the invitation. Try again.' }
  finally { inviteBusy.value = false }
}
async function copy(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => { if (copied.value === key) copied.value = '' }, 1500)
  } catch { inviteErr.value = 'Could not copy automatically. Select the link and copy it.' }
}
async function setRole(m: Member, role: string) { await $fetch(`/api/members/${m.id}`, { method: 'PATCH', body: { role } }); await load() }
async function remove() { if (!removing.value) return; await $fetch(`/api/members/${removing.value.id}`, { method: 'DELETE' }); removing.value = null; await load() }
async function revoke(i: Invite) { await $fetch(`/api/invites/${i.id}`, { method: 'DELETE' }); delete links.value[i.id]; await load() }
useHead({ title: 'Members · Artifact Hub' })
</script>

<template>
  <p v-if="error" class="px-1 text-sm text-muted-foreground" role="alert">{{ error }}</p>
  <BoardSkeleton v-else-if="!data" />
  <template v-else>
    <Teleport defer to="#shell-actions"><Button size="sm" aria-controls="invite-form" @click="openInvite"><Plus />Invite</Button></Teleport>
    <h1 class="mb-5 px-1 text-xl font-semibold tracking-tight">Members</h1>
    <div class="grid gap-6">
      <Board id="invite-form" label="Invite someone" class="scroll-mt-20 md:order-1 max-md:order-2">
        <form class="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end" novalidate @submit.prevent="createInvite">
          <div class="grid gap-1.5">
            <Label for="invite-email">E-mail</Label>
            <Input id="invite-email" v-model="inviteEmail" type="email" autocomplete="off" placeholder="name@example.com" class="max-md:h-11" :aria-invalid="!!inviteErr" :aria-describedby="inviteErr ? 'invite-err' : undefined" @input="inviteErr = ''" />
          </div>
          <div class="grid gap-1.5">
            <Label id="invite-role-label">Role</Label>
            <ToggleGroup type="single" variant="outline" aria-labelledby="invite-role-label" :model-value="inviteRole" class="w-full justify-start max-md:[&>*]:h-11 max-md:[&>*]:flex-1" @update:model-value="(v) => { if (v) inviteRole = v as 'editor' | 'commenter' }">
              <ToggleGroupItem value="commenter">Commenter</ToggleGroupItem>
              <ToggleGroupItem value="editor">Editor</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <Button type="submit" :disabled="!emailValid || inviteBusy" class="max-md:h-11 max-md:w-full"><LoaderCircle v-if="inviteBusy" class="animate-spin" />{{ inviteBusy ? 'Creating link' : 'Create invite link' }}</Button>
          <p v-if="inviteErr" id="invite-err" role="alert" class="text-sm text-destructive md:col-span-3">{{ inviteErr }}</p>
          <p v-else class="text-xs text-muted-foreground md:col-span-3">They sign up with the link, using this e-mail address.</p>
        </form>
      </Board>
      <Board class="md:order-2 max-md:order-1" :label="`People (${data.members.length})`">
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
      <Board v-if="data.invites.length" class="order-3" :label="`Invitations (${data.invites.length})`">
        <ul class="divide-y">
          <li v-for="i in data.invites" :key="i.id" class="px-4 py-3 transition-colors duration-700 motion-reduce:transition-none" :class="fresh === i.id ? 'bg-accent' : ''">
            <div class="flex items-center gap-3">
              <div class="min-w-0 flex-1 truncate text-sm">{{ i.email }}</div>
              <Badge variant="secondary" class="capitalize">{{ i.role }}</Badge>
              <time class="text-xs text-muted-foreground max-sm:hidden" :datetime="i.created_at">{{ ago(i.created_at) }}</time>
              <Button variant="ghost" size="sm" class="max-md:h-11" @click="revoke(i)">Revoke</Button>
            </div>
            <div v-if="links[i.id]" class="mt-3 grid gap-2">
              <div class="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <Input :model-value="links[i.id]" readonly class="font-mono text-xs max-md:h-11" :aria-label="`Invitation link for ${i.email}`" @focus="($event.target as HTMLInputElement).select()" />
                <Button variant="outline" class="max-md:h-11 max-md:w-full" @click="copy(links[i.id]!, i.id)"><component :is="copied === i.id ? Check : Copy" />{{ copied === i.id ? 'Copied' : 'Copy link' }}</Button>
              </div>
              <p class="text-xs text-muted-foreground" :aria-live="'polite'">Works once, for this e-mail address.<span class="sr-only">{{ copied === i.id ? ' Link copied.' : '' }}</span></p>
            </div>
          </li>
        </ul>
      </Board>
    </div>

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
