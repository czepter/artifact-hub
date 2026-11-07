<script setup lang="ts">
import { LogOut, Monitor, Moon, Sun, UserRound } from '@lucide/vue'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { ThemeChoice } from '~/composables/useTheme'

import { authClient } from '~/lib/authClient'
const props = defineProps<{ me: { name: string, email: string, role: string } }>()
const { theme, setTheme } = useTheme()
const initials = computed(() => (props.me.name || props.me.email).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || 'O')

async function signOut() {
  await authClient.signOut()
  await navigateTo('/', { external: true })
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon" class="rounded-full" aria-label="Account menu">
        <Avatar class="size-8"><AvatarFallback class="text-xs font-medium">{{ initials }}</AvatarFallback></Avatar>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-60">
      <DropdownMenuLabel class="grid gap-0.5 font-normal">
        <span class="truncate text-sm font-medium">{{ me.name || me.email }}</span>
        <span class="text-xs capitalize text-muted-foreground">{{ me.role }}</span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem as-child><NuxtLink to="/account"><UserRound />Account</NuxtLink></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup :model-value="theme" @update:model-value="(v) => setTheme(v as ThemeChoice)">
        <DropdownMenuRadioItem value="light"><Sun class="size-4" />Light</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="system"><Monitor class="size-4" />System</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark"><Moon class="size-4" />Dark</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="signOut"><LogOut />Sign out</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
