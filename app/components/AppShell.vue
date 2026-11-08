<script setup lang="ts">
// The viewer's idiom, app-wide: floating pills over the dotted canvas ground. Page content sits below as boards.
import { Badge } from '@/components/ui/badge'
import { Search } from '@lucide/vue'
import { useEventListener } from '@vueuse/core'
import { Button } from '@/components/ui/button'

const props = defineProps<{ me: { name: string, email: string, role: string } | null }>()
const route = useRoute()
const inAdmin = computed(() => route.path.startsWith('/admin'))
const adminLinks = [{ to: '/admin', label: 'Overview' }, { to: '/admin/members', label: 'Members' }, { to: '/admin/clients', label: 'Clients' }, { to: '/admin/share-links', label: 'Share links' }, { to: '/admin/activity', label: 'Activity' }]
const isActive = (to: string) => (to === '/admin' ? route.path === '/admin' : to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(to + '/'))
const openThreads = useCommentCount()
const links = computed(() => [{ to: '/dashboard', label: 'Dashboard' }, { to: '/artifacts', label: 'Artifacts' }, { to: '/comments', label: 'Comments' }, ...(props.me?.role === 'owner' ? [{ to: '/admin', label: 'Admin' }] : [])])
const { open: paletteOpen, isMac, toggle: togglePalette } = usePalette()
const desktopTrigger = ref<{ $el: HTMLElement } | null>(null)
const mobileTrigger = ref<{ $el: HTMLElement } | null>(null)
// Cmd/Ctrl+K toggles the palette. The viewer (/a/<id>) has its own canvas palette on the same keys and does not use this shell.
useEventListener(typeof document === 'undefined' ? undefined : document, 'keydown', (e: KeyboardEvent) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k' || !props.me) return
  e.preventDefault()
  togglePalette()
})
function returnFocus() {
  const t = [desktopTrigger.value?.$el, mobileTrigger.value?.$el].find(el => el && el.offsetParent !== null)
  t?.focus()
}
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
          <WorkspaceSwitcher :can-create="me.role !== 'commenter'" />
          <Button ref="desktopTrigger" variant="outline" size="sm" class="gap-2 max-[800px]:hidden" aria-label="Search and commands" aria-haspopup="dialog" :aria-expanded="paletteOpen" @click="togglePalette">
            <Search />Search<kbd class="rounded border px-1 text-[11px] font-normal text-muted-foreground" aria-hidden="true">{{ isMac ? '⌘K' : 'Ctrl K' }}</kbd>
          </Button>
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
        <Button ref="mobileTrigger" variant="ghost" size="icon" class="size-11 min-[801px]:hidden" aria-label="Search and commands" aria-haspopup="dialog" :aria-expanded="paletteOpen" @click="togglePalette"><Search /></Button>
        <slot name="actions" />
        <UserMenu v-if="me" :me="me" />
      </div>
    </header>
    <CommandPaletteGlobal v-if="me" v-model:open="paletteOpen" :role="me.role" @return-focus="returnFocus" />
    <main class="mx-auto w-full max-w-5xl px-4 pb-16" :class="inAdmin ? 'pt-32' : 'pt-20'"><slot /></main>
  </div>
</template>
