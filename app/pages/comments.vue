<script setup lang="ts">
definePageMeta({ layout: 'shell', access: 'member' })
import { Check, MessageSquare } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface Thread { id: string, artifact_id: string, title: string, board: string | null, resolved: number, first_author: string, first_body: string, author_email: string, author_kind: string, body: string, last_at: string, replies: number }
const { data: threadData, loading } = useHubData('comments', () => $fetch<Thread[]>('/api/comments').catch(() => [] as Thread[]))
const threads = computed(() => threadData.value ?? [])
const filter = ref<'open' | 'resolved' | 'all'>('open')
const shown = computed(() => threads.value.filter(t => filter.value === 'all' || (filter.value === 'open' ? !t.resolved : !!t.resolved)))
const openCount = computed(() => threads.value.filter(t => !t.resolved).length)
const who = (t: Thread) => (t.author_kind === 'model' ? 'Claude' : t.author_email)
useHead({ title: 'Comments · Artifact Hub' })
</script>

<template>
  <div class="mb-5 flex flex-wrap items-end justify-between gap-3 px-1">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Comments</h1>
      <p class="text-sm text-muted-foreground">{{ loading ? 'Loading…' : `${openCount} open · ${threads.length - openCount} resolved` }}</p>
    </div>
    <Tabs v-model="filter">
      <TabsList>
        <TabsTrigger value="open">Open</TabsTrigger>
        <TabsTrigger value="resolved">Resolved</TabsTrigger>
        <TabsTrigger value="all">All</TabsTrigger>
      </TabsList>
    </Tabs>
  </div>
  <BoardSkeleton v-if="loading" />
  <Board v-else :label="filter === 'open' ? 'Open threads' : filter === 'resolved' ? 'Resolved threads' : 'All threads'">
    <p v-if="!shown.length" class="px-4 py-6 text-sm text-muted-foreground">{{ filter === 'open' ? 'No open threads. Comments on any artifact appear here until they are resolved.' : 'No threads here.' }}</p>
    <ul v-else class="divide-y">
      <li v-for="t in shown" :key="t.id">
        <Button as-child variant="ghost" class="h-auto w-full flex-col items-stretch gap-1 rounded-none px-4 py-3 text-left font-normal whitespace-normal">
          <NuxtLink :to="`/a/${t.artifact_id}`" class="flex w-full min-w-0 flex-col items-stretch gap-1">
            <span class="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
              <span class="min-w-0 truncate"><span class="font-medium text-foreground">{{ who(t) }}</span> on {{ t.title }}<template v-if="t.board"> · {{ t.board.split('/').pop() }}</template></span>
              <span class="flex shrink-0 items-center gap-2">
                <Badge v-if="t.resolved" variant="secondary" class="gap-1"><Check class="size-3" />Resolved</Badge>
                <Badge v-if="t.replies" variant="outline" class="gap-1"><MessageSquare class="size-3" />{{ t.replies }}</Badge>
                <time class="tabular-nums" :datetime="t.last_at">{{ ago(t.last_at) }}</time>
              </span>
            </span>
            <span class="line-clamp-2 text-sm" :class="t.resolved && 'text-muted-foreground'">{{ t.body }}</span>
          </NuxtLink>
        </Button>
      </li>
    </ul>
  </Board>
</template>
