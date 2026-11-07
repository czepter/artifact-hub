<script setup lang="ts">
// The viewer's idiom, app-wide: floating pills over the dotted canvas ground. Page content sits below as boards.
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const props = defineProps<{ me: { name: string, email: string, role: string } | null }>()
const route = useRoute()
const inAdmin = computed(() => route.path.startsWith('/admin'))
const adminLinks = [{ to: '/admin', label: 'Overview' }, { to: '/admin/members', label: 'Members' }, { to: '/admin/clients', label: 'Clients' }, { to: '/admin/share-links', label: 'Share links' }, { to: '/admin/activity', label: 'Activity' }]
const isActive = (to: string) => (to === '/admin' ? route.path === '/admin' : to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(to + '/'))
const openThreads = ref(0)
// Kept across navigations (the shell stays mounted): refresh on route change, never reset to 0.
async function refreshThreads() { openThreads.value = (await $fetch<{ open: number }>('/api/comments/count').catch(() => ({ open: openThreads.value }))).open }
onMounted(refreshThreads)
watch(() => route.path, refreshThreads)
const links = computed(() => [{ to: '/dashboard', label: 'Dashboard' }, { to: '/artifacts', label: 'Artifacts' }, { to: '/comments', label: 'Comments' }, ...(props.me?.role === 'owner' ? [{ to: '/admin', label: 'Admin' }] : [])])
</script>

<template>
  <div class="hub-ground">
    <header class="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3">
      <div class="grid min-w-0 justify-items-start gap-2">
        <div class="float pointer-events-auto flex min-w-0 items-center gap-1 rounded-xl border bg-card p-1">
          <span class="whitespace-nowrap px-2 text-sm font-semibold tracking-tight max-sm:hidden">Artifact Hub</span>
          <nav aria-label="Main" class="flex items-center gap-0.5">
            <Button v-for="l in links" :key="l.to" as-child variant="ghost" size="sm" :class="(l.to === '/admin' ? inAdmin : isActive(l.to)) && 'bg-accent'">
              <NuxtLink :to="l.to" :aria-current="(l.to === '/admin' ? inAdmin : isActive(l.to)) ? 'page' : undefined">{{ l.label }}<Badge v-if="l.to === '/comments' && openThreads" class="ml-1 h-4 min-w-4 rounded-full px-1 text-[11px]">{{ openThreads }}</Badge></NuxtLink>
            </Button>
          </nav>
        </div>
        <div v-if="inAdmin" class="float pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border bg-card p-1">
          <nav aria-label="Admin sections" class="flex items-center gap-0.5">
            <Button v-for="l in adminLinks" :key="l.to" as-child variant="ghost" size="sm" :class="isActive(l.to) && 'bg-accent'">
              <NuxtLink :to="l.to" :aria-current="isActive(l.to) ? 'page' : undefined">{{ l.label }}</NuxtLink>
            </Button>
          </nav>
        </div>
      </div>
      <div class="float pointer-events-auto flex items-center gap-1 rounded-xl border bg-card p-1">
        <slot name="actions" />
        <UserMenu v-if="me" :me="me" />
      </div>
    </header>
    <main class="mx-auto w-full max-w-5xl px-4 pb-16" :class="inAdmin ? 'pt-32' : 'pt-20'"><slot /></main>
  </div>
</template>
