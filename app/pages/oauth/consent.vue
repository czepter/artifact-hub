<script setup lang="ts">
import { ArrowLeftRight, Plug } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { authClient } from '~/lib/authClient'

interface Req { client: string, redirectTo: string, member: { name: string, email: string, role: string }, redirectUri?: string, allowed: string[], requested: string[], params: Record<string, string>, exp: string, sig: string }
definePageMeta({ access: 'member' })
const route = useRoute()
const req = ref<Req | null>(null)
const error = ref(typeof route.query.error === 'string' ? route.query.error : '')
const chosen = ref<string[]>(['read'])
const grant = ref('look only')
const busy = ref(false)

onMounted(async () => {
  if (error.value) return
  try {
    req.value = await $fetch<Req>('/api/oauth/request', { query: route.query as Record<string, string> })
  } catch (e: any) {
    if (e?.statusCode === 401) return navigateTo(`/?next=${encodeURIComponent(route.fullPath)}`, { external: true })
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'This request cannot be completed.'
  }
})
async function switchAccount() {
  await authClient.signOut()
  await navigateTo(`/?next=${encodeURIComponent(route.fullPath)}`, { external: true })
}
async function decide(decision: 'allow' | 'deny') {
  if (!req.value) return
  busy.value = true
  try {
    const r = await $fetch<{ redirect: string }>('/api/oauth/decision', { method: 'POST', body: { params: req.value.params, exp: req.value.exp, sig: req.value.sig, scopes: chosen.value, decision } })
    window.location.href = r.redirect
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'This request expired. Start the connection again from your app.'
    busy.value = false
  }
}
useHead({ title: 'Approve access · Artifact Hub' })
</script>

<template>
  <div class="hub-ground center">
    <Card v-if="error" class="float w-full max-w-md">
      <CardHeader><CardTitle as="h1">Cannot connect</CardTitle><CardDescription>{{ error }}</CardDescription></CardHeader>
    </Card>
    <Card v-else-if="req" class="float w-full max-w-md">
      <CardHeader>
        <div class="flex items-center gap-3">
          <span class="grid size-10 shrink-0 place-items-center rounded-lg border bg-muted"><Plug class="size-5" /></span>
          <div class="min-w-0">
            <CardTitle as="h1" class="text-lg">{{ req.client }} wants to connect</CardTitle>
            <CardDescription class="truncate font-mono text-xs">{{ req.redirectTo }}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="grid gap-4">
        <div class="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
          <div class="min-w-0"><div class="truncate font-medium">{{ req.member.name || req.member.email }}</div><div class="text-xs capitalize text-muted-foreground">{{ req.member.role }}</div></div>
          <Button variant="link" size="sm" class="text-muted-foreground" @click="switchAccount">Not you?</Button>
        </div>
        <ConsentPresets v-model:scopes="chosen" v-model:grant="grant" :client="req.client" :allowed="req.allowed" :requested="req.requested" />
        <div class="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <ArrowLeftRight class="mt-0.5 size-3.5 shrink-0" />
          <p class="min-w-0">You return to <span class="break-all font-mono text-foreground">{{ req.redirectUri || req.redirectTo }}</span> after you decide. Approve only apps you started yourself.</p>
        </div>
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" class="h-11 sm:h-9" :disabled="busy" @click="decide('deny')">Deny</Button>
          <Button class="h-11 sm:h-9" :disabled="busy" @click="decide('allow')">Approve {{ grant }}</Button>
        </div>
      </CardContent>
    </Card>
    <p v-else class="muted" role="status">Loading…</p>
  </div>
</template>
