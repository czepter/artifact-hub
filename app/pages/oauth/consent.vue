<script setup lang="ts">
import { Plug } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { authClient } from '~/lib/authClient'

interface Req { client: string, redirectTo: string, member: { name: string, email: string, role: string }, allowed: string[], requested: string[], params: Record<string, string>, exp: string, sig: string }
const SCOPES: Record<string, { label: string, hint: string }> = {
  read: { label: 'Read', hint: 'Artifacts, files, comments and shared data' },
  comment: { label: 'Comment', hint: 'Reply to and resolve comment threads' },
  write: { label: 'Publish and edit', hint: 'Create artifacts, publish versions, edit files, write shared data' },
  share: { label: 'Share', hint: 'Create share links' },
}
const route = useRoute()
const req = ref<Req | null>(null)
const error = ref(typeof route.query.error === 'string' ? route.query.error : '')
const chosen = ref<string[]>([])
const busy = ref(false)

onMounted(async () => {
  if (error.value) return
  try {
    req.value = await $fetch<Req>('/api/oauth/request', { query: route.query as Record<string, string> })
    chosen.value = req.value.requested.filter(s => req.value!.allowed.includes(s))
  } catch (e: any) {
    if (e?.statusCode === 401) return navigateTo(`/?next=${encodeURIComponent(route.fullPath)}`, { external: true })
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'This request cannot be completed.'
  }
})
async function switchAccount() {
  await authClient.signOut()
  await navigateTo(`/?next=${encodeURIComponent(route.fullPath)}`, { external: true })
}
function toggle(s: string, on: boolean) { chosen.value = on ? [...new Set([...chosen.value, s])] : chosen.value.filter(x => x !== s) }
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
        <fieldset class="grid">
          <legend class="mb-1 text-sm font-medium">Allow it to</legend>
          <div v-for="(meta, key) in SCOPES" :key="key" class="flex items-start gap-3 border-t py-3">
            <Checkbox :id="`s-${key}`" class="mt-0.5" :model-value="chosen.includes(key as string) || key === 'read'" :disabled="key === 'read' || !req.allowed.includes(key as string)" @update:model-value="(v) => toggle(key as string, v === true)" />
            <Label :for="`s-${key}`" class="grid gap-0.5 font-normal"><span class="font-medium">{{ meta.label }}</span><span class="text-xs text-muted-foreground">{{ meta.hint }}{{ req.allowed.includes(key as string) ? '' : ' (not available for your role)' }}</span></Label>
          </div>
        </fieldset>
        <div class="flex justify-end gap-2">
          <Button variant="outline" :disabled="busy" @click="decide('deny')">Deny</Button>
          <Button :disabled="busy" @click="decide('allow')">Approve</Button>
        </div>
      </CardContent>
    </Card>
    <p v-else class="muted" role="status">Loading…</p>
  </div>
</template>
