<script setup lang="ts">
import { KeyRound } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '~/lib/authClient'

const props = defineProps<{ github: boolean, setup: boolean }>()
const emit = defineEmits<{ done: [] }>()
const name = ref('')
const email = ref('')
const password = ref('')
const err = ref('')
const busy = ref(false)
const route = useRoute()
const next = computed(() => { const n = route.query.next; return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/' })

type AuthResult = { error?: { message?: string, code?: string, name?: string } | null } | undefined
const host = useRequestURL().host
const active = ref<'password' | 'passkey' | 'github' | ''>('')

const cancelled = (e: { message?: string, code?: string, name?: string } | null | undefined) =>
  !!e && (e.name === 'NotAllowedError' || e.name === 'AbortError' || e.code === 'AUTH_CANCELLED' || /NotAllowedError|AbortError|cancel/i.test(e.message || ''))

async function run(kind: 'password' | 'passkey' | 'github', fn: () => Promise<AuthResult>) {
  err.value = ''
  busy.value = true
  active.value = kind
  try {
    const r = await fn()
    if (r?.error) {
      err.value = kind === 'passkey' && cancelled(r.error) ? 'Passkey sign-in was cancelled.' : r.error.message || 'That did not work.'
      return
    }
    emit('done')
  } catch (e) {
    err.value = kind === 'passkey' && cancelled(e as Error) ? 'Passkey sign-in was cancelled.' : 'That did not work. Try again.'
  } finally { busy.value = false; active.value = '' }
}
const submit = () => run('password', () => props.setup
  ? authClient.signUp.email({ name: name.value.trim() || email.value, email: email.value, password: password.value })
  : authClient.signIn.email({ email: email.value, password: password.value }))
const withPasskey = () => run('passkey', () => authClient.signIn.passkey())
const withGithub = () => run('github', () => authClient.signIn.social({ provider: 'github', callbackURL: next.value }))
const hit = 'max-sm:h-11'
</script>

<template>
  <div class="grid w-full max-w-sm gap-4">
    <p v-if="!setup" class="flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <span class="size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
      <span class="truncate">{{ host }} · your Artifact Hub</span>
    </p>
    <Card class="float w-full">
      <CardHeader>
        <CardTitle as="h1">{{ setup ? 'Create the owner account' : 'Sign in' }}</CardTitle>
      </CardHeader>
      <CardContent class="grid gap-4">
        <template v-if="!setup">
          <div class="grid gap-2">
            <Button variant="outline" class="w-full justify-start" :class="hit" :disabled="busy" :aria-busy="active === 'passkey'" @click="withPasskey"><KeyRound />Sign in with a passkey</Button>
            <p class="text-xs text-muted-foreground">Fastest: no typing, uses this device.</p>
          </div>
          <div class="flex items-center gap-3 text-xs text-muted-foreground"><span class="h-px flex-1 bg-border" />or with e-mail<span class="h-px flex-1 bg-border" /></div>
        </template>
        <form class="grid gap-3" @submit.prevent="submit">
          <div v-if="setup" class="grid gap-1.5"><Label for="name">Name</Label><Input id="name" v-model="name" autocomplete="name" :class="hit" /></div>
          <div class="grid gap-1.5"><Label for="email">E-mail</Label><Input id="email" v-model="email" type="email" required autocomplete="username webauthn" placeholder="you@example.com" :class="hit" /></div>
          <div class="grid gap-1.5"><Label for="password">Password</Label><Input id="password" v-model="password" type="password" required :minlength="setup ? 10 : undefined" :autocomplete="setup ? 'new-password' : 'current-password'" :class="hit" /></div>
          <Alert v-if="err" variant="destructive" role="alert"><AlertDescription>{{ err }}</AlertDescription></Alert>
          <Button type="submit" class="w-full" :class="hit" :disabled="busy || !email || !password" :aria-busy="active === 'password'">{{ setup ? 'Create account' : 'Sign in' }}</Button>
        </form>
        <Button v-if="!setup && github" variant="ghost" class="w-full justify-start" :class="hit" :disabled="busy" :aria-busy="active === 'github'" @click="withGithub"><GithubMark />Continue with GitHub</Button>
      </CardContent>
    </Card>
    <p v-if="!setup" class="text-center text-xs text-muted-foreground">New here? Sign-up is by invitation from the owner.</p>
  </div>
</template>
