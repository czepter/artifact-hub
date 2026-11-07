<script setup lang="ts">
import { KeyRound, Plus } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '~/lib/authClient'

interface Pk { id: string, name?: string | null, createdAt: string | Date }
interface Sess { id: string, token: string, userAgent?: string | null, createdAt: string | Date, updatedAt: string | Date }
interface Acc { id: string, providerId: string }
const { me, authed, load: loadOwner } = useOwner()
const passkeys = ref<Pk[]>([])
const sessions = ref<Sess[]>([])
const accounts = ref<Acc[]>([])
const githubOn = ref(false)
const currentToken = ref('')
const msg = ref('')
const pwOpen = ref(false)
const pw = reactive({ current: '', next: '' })
const pwErr = ref('')

async function load() {
  const [p, s, a, c, cur] = await Promise.all([
    authClient.passkey.listUserPasskeys(), authClient.listSessions(), authClient.listAccounts(),
    $fetch<{ github: boolean }>('/api/auth-config'), authClient.getSession(),
  ])
  passkeys.value = (p.data ?? []) as Pk[]
  sessions.value = (s.data ?? []) as Sess[]
  accounts.value = (a.data ?? []) as Acc[]
  githubOn.value = c.github
  currentToken.value = cur.data?.session.token ?? ''
}
onMounted(async () => {
  await loadOwner()
  if (!authed.value) return navigateTo('/', { external: true })
  await load()
})
const when = (d: string | Date) => ago(new Date(d).toISOString())
const hasGithub = computed(() => accounts.value.some(a => a.providerId === 'github'))
const hasPassword = computed(() => accounts.value.some(a => a.providerId === 'credential'))
const device = (ua?: string | null) => (ua ? (ua.match(/(Firefox|Edg|Chrome|Safari)\/[\d.]+/)?.[1] ?? 'Browser').replace('Edg', 'Edge') + (/Mobile|iPhone|Android/.test(ua) ? ' on a phone' : /Mac OS/.test(ua) ? ' on macOS' : /Windows/.test(ua) ? ' on Windows' : /Linux/.test(ua) ? ' on Linux' : '') : 'Unknown device')

async function addPasskey() {
  msg.value = ''
  const r = await authClient.passkey.addPasskey({ name: `Passkey ${passkeys.value.length + 1}` })
  if (r?.error) msg.value = r.error.message || 'Could not add the passkey.'
  await load()
}
async function removePasskey(p: Pk) { await authClient.passkey.deletePasskey({ id: p.id }); await load() }
async function revoke(s: Sess) { await authClient.revokeSession({ token: s.token }); await load() }
async function revokeOthers() { await authClient.revokeOtherSessions(); await load() }
async function connectGithub() { await authClient.linkSocial({ provider: 'github', callbackURL: '/account' }) }
async function disconnectGithub() { await authClient.unlinkAccount({ providerId: 'github' }); await load() }
async function changePassword() {
  pwErr.value = ''
  const r = await authClient.changePassword({ currentPassword: pw.current, newPassword: pw.next, revokeOtherSessions: false })
  if (r.error) { pwErr.value = r.error.message || 'Could not change the password.'; return }
  pwOpen.value = false; pw.current = ''; pw.next = ''
}
useHead({ title: 'Account · Artifact Hub' })
</script>

<template>
  <div v-if="!me" class="hub-ground center" role="status"><span class="muted">Loading…</span></div>
  <AppShell v-else :me="me">
    <h1 class="mb-5 px-1 text-xl font-semibold tracking-tight">Account</h1>
    <div class="grid max-w-2xl gap-6">
      <Board label="Profile">
        <dl class="grid gap-3 p-4 text-sm sm:grid-cols-2">
          <div><dt class="text-xs text-muted-foreground">Name</dt><dd>{{ me.name || '—' }}</dd></div>
          <div><dt class="text-xs text-muted-foreground">E-mail</dt><dd>{{ me.email }}</dd></div>
          <div><dt class="text-xs text-muted-foreground">Role</dt><dd class="capitalize">{{ me.role }}</dd></div>
        </dl>
      </Board>

      <Board label="Sign-in methods">
        <ul class="divide-y">
          <li v-if="githubOn || hasGithub" class="flex items-center gap-3 px-4 py-3">
            <GithubMark class="size-5 text-muted-foreground" />
            <div class="flex-1 text-sm"><div class="font-medium">GitHub</div><div class="text-xs text-muted-foreground">{{ hasGithub ? 'Connected' : 'Not connected' }}</div></div>
            <Button v-if="hasGithub" variant="outline" size="sm" :disabled="accounts.length < 2 && passkeys.length === 0" @click="disconnectGithub">Disconnect</Button>
            <Button v-else variant="outline" size="sm" @click="connectGithub">Connect</Button>
          </li>
          <li class="flex items-center gap-3 px-4 py-3">
            <KeyRound class="size-5 text-muted-foreground" />
            <div class="flex-1 text-sm"><div class="font-medium">Password</div><div class="text-xs text-muted-foreground">{{ hasPassword ? 'Set' : 'Not set' }}</div></div>
            <Button v-if="hasPassword" variant="outline" size="sm" @click="pwOpen = true">Change</Button>
          </li>
          <li v-for="p in passkeys" :key="p.id" class="flex items-center gap-3 px-4 py-3">
            <KeyRound class="size-5 text-muted-foreground" />
            <div class="flex-1 text-sm"><div class="font-medium">{{ p.name || 'Passkey' }}</div><div class="text-xs text-muted-foreground">Added {{ when(p.createdAt) }}</div></div>
            <Button variant="ghost" size="sm" @click="removePasskey(p)">Remove</Button>
          </li>
          <li class="px-4 py-3">
            <Button variant="outline" size="sm" @click="addPasskey"><Plus />Add a passkey</Button>
            <p v-if="msg" class="err mt-2" role="alert">{{ msg }}</p>
          </li>
        </ul>
      </Board>

      <ClientsBoard />

      <Board :label="`Sessions (${sessions.length})`">
        <ul class="divide-y">
          <li v-for="s in sessions" :key="s.id" class="flex items-center gap-3 px-4 py-3">
            <div class="flex-1 text-sm"><div class="font-medium">{{ device(s.userAgent) }}</div><div class="text-xs text-muted-foreground">Active {{ when(s.updatedAt) }}</div></div>
            <Badge v-if="s.token === currentToken" variant="secondary">This device</Badge>
            <Button v-else variant="ghost" size="sm" @click="revoke(s)">Sign out</Button>
          </li>
          <li v-if="sessions.length > 1" class="px-4 py-3"><Button variant="outline" size="sm" @click="revokeOthers">Sign out other devices</Button></li>
        </ul>
      </Board>
    </div>

    <Dialog v-model:open="pwOpen">
      <DialogContent>
        <DialogHeader><DialogTitle>Change password</DialogTitle></DialogHeader>
        <div class="grid gap-3">
          <div class="grid gap-1.5"><Label for="cur">Current password</Label><Input id="cur" v-model="pw.current" type="password" autocomplete="current-password" /></div>
          <div class="grid gap-1.5"><Label for="new">New password</Label><Input id="new" v-model="pw.next" type="password" minlength="10" autocomplete="new-password" /></div>
          <Alert v-if="pwErr" variant="destructive" role="alert"><AlertDescription>{{ pwErr }}</AlertDescription></Alert>
        </div>
        <DialogFooter><Button variant="outline" @click="pwOpen = false">Cancel</Button><Button :disabled="!pw.current || pw.next.length < 10" @click="changePassword">Change password</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </AppShell>
</template>
