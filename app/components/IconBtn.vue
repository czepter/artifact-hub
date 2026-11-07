<script setup lang="ts">
// shadcn Button + Tooltip: one icon (or icon + label) button used all over the chrome.
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

defineOptions({ inheritAttrs: false })
withDefaults(defineProps<{ label: string, active?: boolean, size?: 'icon' | 'icon-sm' | 'icon-xs' | 'sm' | 'xs' | 'default', variant?: 'ghost' | 'default' | 'outline' | 'secondary' | 'destructive', side?: 'top' | 'bottom' | 'left' | 'right' }>(), { active: undefined, size: 'icon-sm', variant: 'ghost', side: 'bottom' })
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button v-bind="$attrs" :variant="active ? 'default' : variant" :size="size" :aria-label="label" :aria-pressed="active === undefined ? undefined : active" class="relative">
        <slot />
      </Button>
    </TooltipTrigger>
    <TooltipContent :side="side">{{ label }}</TooltipContent>
  </Tooltip>
</template>
