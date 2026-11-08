<script setup lang="ts">
// "Connect a client": endpoint + the three steps on the left, live connected clients on the right.
// Polls /api/grants every 5 s while the tab is visible so a freshly approved client appears without a reload.
import { Check, ChevronDown, Copy } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'

interface Grant { family: string, client: string, scope: string, authorized_at: number | null, last_used: number | null }
const SCOPE_LABEL: Record<string, string> = { read: 'Read', comment: 'Comment', write: 'Publish and edit', share: 'Share' }
const PROMPT = 'Publish a one-page artifact called "Hello from my MCP client" to Artifact Hub.'

const grants = ref<Grant[] | null>(null)
const userOpen = ref<boolean | null>(null)
const connected = computed(() => (grants.value?.length ?? 0) > 0)
// Steps are open by default only while nothing is connected; the user's own choice wins once made.
const stepsOpen = computed({ get: () => userOpen.value ?? !connected.value, set: (v: boolean) => { userOpen.value = v } })

const endpoint = computed(() => (import.meta.client ? `${location.origin}/mcp` : ''))
const copiedKey = ref<'endpoint' | 'prompt' | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | undefined
async function copy(text: string, key: 'endpoint' | 'prompt') {
  try { await navigator.clipboard.writeText(text) } catch { document.querySelector<HTMLInputElement>('#mcp-endpoint')?.select(); return }
  copiedKey.value = key
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => (copiedKey.value = null), 1800)
}

async function load() { grants.value = await $fetch<Grant[]>('/api/grants').catch(() => grants.value ?? []) }
let poll: ReturnType<typeof setInterval> | undefined
const tick = () => { if (document.visibilityState === 'visible') void load() }
onMounted(() => { void load(); poll = setInterval(tick, 5000); document.addEventListener('visibilitychange', tick) })
onBeforeUnmount(() => { clearInterval(poll); clearTimeout(copyTimer); document.removeEventListener('visibilitychange', tick) })

const used = (g: Grant) => (g.last_used ? `used ${agoS(g.last_used)}` : 'never used')
</script>

<template>
  <Board label="Connect a client">
    <div class="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div class="min-w-0 p-4">
        <label for="mcp-endpoint" class="mb-2 block text-sm font-medium">MCP endpoint</label>
        <div class="flex gap-2">
          <Input id="mcp-endpoint" :model-value="endpoint" readonly class="min-w-0 font-mono text-xs" />
          <Button variant="outline" class="shrink-0" @click="copy(endpoint, 'endpoint')">
            <component :is="copiedKey === 'endpoint' ? Check : Copy" />{{ copiedKey === 'endpoint' ? 'Copied' : 'Copy' }}
          </Button>
        </div>
        <p class="sr-only" role="status">{{ copiedKey === 'endpoint' ? 'Endpoint copied' : copiedKey === 'prompt' ? 'Prompt copied' : '' }}</p>

        <Collapsible v-model:open="stepsOpen" class="mt-4">
          <div v-if="connected" class="flex items-center justify-between gap-3 text-sm">
            <span class="text-muted-foreground">Endpoint, approval, first publish: three steps.</span>
            <CollapsibleTrigger as-child>
              <Button variant="ghost" size="sm" class="shrink-0"><ChevronDown class="transition-transform" :class="stepsOpen && 'rotate-180'" />{{ stepsOpen ? 'Hide steps' : 'Show steps' }}</Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent :class="connected && 'pt-3'">
            <ol class="grid list-none gap-3 p-0 text-sm">
              <li class="grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5">
                <span class="grid size-[1.375rem] place-items-center rounded-full border text-xs tabular-nums text-muted-foreground" aria-hidden="true">1</span>
                <span>Add the endpoint to your MCP client<small class="block text-xs text-muted-foreground">Claude Desktop, Claude Code or any client that speaks MCP over HTTP.</small></span>
              </li>
              <li class="grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5">
                <span class="grid size-[1.375rem] place-items-center rounded-full border text-xs tabular-nums text-muted-foreground" aria-hidden="true">2</span>
                <span>Approve it on the consent screen<small class="block text-xs text-muted-foreground">You choose what it may do: look, reply, or publish and edit.</small></span>
              </li>
              <li class="grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5">
                <span class="grid size-[1.375rem] place-items-center rounded-full border text-xs tabular-nums text-muted-foreground" aria-hidden="true">3</span>
                <div class="min-w-0">
                  <span>Ask it to publish something</span>
                  <div class="mt-1.5 flex items-start gap-2 rounded-md border bg-muted/40 py-1.5 pl-2.5 pr-1.5">
                    <code class="min-w-0 flex-1 break-words py-0.5 font-mono text-xs">{{ PROMPT }}</code>
                    <Button variant="ghost" size="icon-sm" class="shrink-0" :aria-label="copiedKey === 'prompt' ? 'Prompt copied' : 'Copy example prompt'" @click="copy(PROMPT, 'prompt')">
                      <component :is="copiedKey === 'prompt' ? Check : Copy" />
                    </Button>
                  </div>
                  <small class="mt-1 block text-xs text-muted-foreground">It appears under Artifacts as soon as the client publishes it.</small>
                </div>
              </li>
            </ol>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <div class="min-w-0 border-t p-4 md:border-l md:border-t-0">
        <h3 class="mb-2 text-sm font-medium">Connected clients</h3>
        <p v-if="!grants" class="text-sm text-muted-foreground" role="status">Loading…</p>
        <template v-else-if="!grants.length">
          <p class="text-sm">No client is connected yet.</p>
          <p class="mt-1 flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <span class="size-2 shrink-0 rounded-full bg-muted-foreground motion-safe:animate-pulse" aria-hidden="true" />Waiting for the first client…
          </p>
        </template>
        <ul v-else class="m-0 list-none divide-y p-0">
          <li v-for="g in grants" :key="g.family" class="py-2.5 first:pt-0">
            <div class="flex items-center gap-2 text-sm">
              <span class="size-2 shrink-0 rounded-full" :class="g.last_used ? 'bg-primary' : 'border border-muted-foreground'" aria-hidden="true" />
              <span class="min-w-0 truncate font-medium">{{ g.client }}</span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-4">
              <span class="text-xs text-muted-foreground">{{ used(g) }}</span>
              <Badge v-for="s in g.scope.split(' ')" :key="s" variant="secondary">{{ SCOPE_LABEL[s] ?? s }}</Badge>
            </div>
          </li>
        </ul>
        <Button as-child variant="outline" size="sm" class="mt-3"><NuxtLink to="/admin/clients">Manage clients</NuxtLink></Button>
      </div>
    </div>
  </Board>
</template>
