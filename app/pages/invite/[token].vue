<script setup lang="ts">
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '~/lib/authClient'

const token = String(useRoute().params.token)
// Looked up on the server, so the form (or "not available") is in the first response.
const { data: invite, error: lookupError } = await useFetch<{ email: string, role: string }>('/api/invites/lookup', { query: { token }, key: `invite-${token}` })
const invalid = computed(() => !!lookupError.value || !invite.value)
const name = ref('')
const password = ref('')
const err = ref('')
const busy = ref(false)

async function join() {
  if (!invite.value) return
  err.value = ''
  busy.value = true
  const r = await authClient.signUp.email({ name: name.value.trim() || invite.value.email, email: invite.value.email, password: password.value })
  busy.value = false
  if (r.error) { err.value = r.error.message || 'Could not create the account.'; return }
  await navigateTo('/', { external: true })
}
useHead({ title: 'Join · Artifact Hub' })
</script>

<template>
  <div class="hub-ground center">
    <Card class="float w-full max-w-sm">
      <template v-if="invalid">
        <CardHeader><CardTitle as="h1">Invitation not available</CardTitle><CardDescription>This link is invalid or was already used. Ask the owner for a new one.</CardDescription></CardHeader>
      </template>
      <template v-else-if="invite">
        <CardHeader>
          <CardTitle as="h1">Join Artifact Hub</CardTitle>
          <CardDescription>You were invited as {{ invite.role }}. Create your account for {{ invite.email }}.</CardDescription>
        </CardHeader>
        <CardContent>
          <form class="grid gap-3" @submit.prevent="join">
            <div class="grid gap-1.5"><Label for="iname">Name</Label><Input id="iname" v-model="name" autocomplete="name" /></div>
            <div class="grid gap-1.5"><Label for="ipass">Password</Label><Input id="ipass" v-model="password" type="password" required minlength="10" autocomplete="new-password" /></div>
            <Alert v-if="err" variant="destructive" role="alert"><AlertDescription>{{ err }}</AlertDescription></Alert>
            <Button type="submit" class="w-full" :disabled="busy || password.length < 10">Create account</Button>
          </form>
        </CardContent>
      </template>
      <CardContent v-else class="text-sm text-muted-foreground" role="status">Loading…</CardContent>
    </Card>
  </div>
</template>
