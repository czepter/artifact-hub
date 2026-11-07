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

async function run(fn: () => Promise<{ error?: { message?: string } | null } | undefined>) {
  err.value = ''
  busy.value = true
  try {
    const r = await fn()
    if (r?.error) { err.value = r.error.message || 'That did not work.'; return }
    emit('done')
  } finally { busy.value = false }
}
const submit = () => run(() => props.setup
  ? authClient.signUp.email({ name: name.value.trim() || email.value, email: email.value, password: password.value })
  : authClient.signIn.email({ email: email.value, password: password.value }))
const withPasskey = () => run(() => authClient.signIn.passkey())
const withGithub = () => run(() => authClient.signIn.social({ provider: 'github', callbackURL: next.value }))
</script>

<template>
  <Card class="float w-full max-w-sm">
    <CardHeader>
      <CardTitle as="h1">{{ setup ? 'Create the owner account' : 'Sign in' }}</CardTitle>
    </CardHeader>
    <CardContent class="grid gap-4">
      <div v-if="!setup" class="grid gap-2">
        <Button v-if="github" variant="outline" class="w-full" :disabled="busy" @click="withGithub"><GithubMark />Continue with GitHub</Button>
        <Button variant="outline" class="w-full" :disabled="busy" @click="withPasskey"><KeyRound />Sign in with a passkey</Button>
        <div class="flex items-center gap-3 text-xs text-muted-foreground"><span class="h-px flex-1 bg-border" />or<span class="h-px flex-1 bg-border" /></div>
      </div>
      <form class="grid gap-3" @submit.prevent="submit">
        <div v-if="setup" class="grid gap-1.5"><Label for="name">Name</Label><Input id="name" v-model="name" autocomplete="name" /></div>
        <div class="grid gap-1.5"><Label for="email">E-mail</Label><Input id="email" v-model="email" type="email" required autocomplete="username webauthn" /></div>
        <div class="grid gap-1.5"><Label for="password">Password</Label><Input id="password" v-model="password" type="password" required :minlength="setup ? 10 : undefined" :autocomplete="setup ? 'new-password' : 'current-password'" /></div>
        <Alert v-if="err" variant="destructive" role="alert"><AlertDescription>{{ err }}</AlertDescription></Alert>
        <Button type="submit" class="w-full" :disabled="busy || !email || !password">{{ setup ? 'Create account' : 'Sign in' }}</Button>
      </form>
    </CardContent>
  </Card>
</template>
