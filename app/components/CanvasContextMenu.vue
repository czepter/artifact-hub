<script setup lang="ts">
import { ArrowRightLeft, ArrowDownToLine, Group, Lock, LockOpen, Ungroup, ArrowUpToLine, ChevronDown, ChevronUp, ClipboardPaste, Copy, CopyPlus, Download, Maximize2, Minus, Pencil, Play, Plus, Presentation, ScanSearch, SlidersHorizontal, StickyNote, Trash2 } from '@lucide/vue'
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from '@/components/ui/context-menu'

// The right-click menu of the canvas. It only decides what to show; Canvas does the work.
defineProps<{ type: 'board' | 'note' | 'canvas', id: string, canvasLevel: boolean, hasClip: boolean, locked: boolean, grouped: boolean, canGroup: boolean }>()
defineEmits<{
  play: [], focus: [], tweaks: [], export: [], duplicate: [], rename: [], lock: [], group: [], ungroup: [], deleteBoard: [], transfer: [mode: 'copy' | 'move'], copy: [], deleteNote: []
  reorder: [mode: 'front' | 'forward' | 'backward' | 'back'], addBoard: [], addSticky: [], paste: [], fit: [], zoom: [factor: number], present: []
}>()
</script>

<template>
  <ContextMenuContent class="w-56">
    <template v-if="type === 'board'">
      <ContextMenuItem @select="$emit('play')"><Play />Play</ContextMenuItem>
      <ContextMenuItem @select="$emit('focus')"><Maximize2 />Open full window<ContextMenuShortcut>F</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @select="$emit('tweaks')"><SlidersHorizontal />Tweaks</ContextMenuItem>
      <ContextMenuItem @select="$emit('export')"><Download />Download board</ContextMenuItem>
      <template v-if="canvasLevel">
        <ContextMenuItem @select="$emit('duplicate')"><Copy />Duplicate<ContextMenuShortcut>Ctrl D</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem @select="$emit('rename')"><Pencil />Rename</ContextMenuItem>
        <ContextMenuItem @select="$emit('transfer', 'copy')"><Copy />Copy to artifact…</ContextMenuItem>
        <ContextMenuItem :disabled="locked" @select="$emit('transfer', 'move')"><ArrowRightLeft />Move to artifact…</ContextMenuItem>
        <ContextMenuItem @select="$emit('lock')"><component :is="locked ? LockOpen : Lock" />{{ locked ? 'Unlock' : 'Lock' }}<ContextMenuShortcut>Ctrl Shift L</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem v-if="canGroup" @select="$emit('group')"><Group />Group<ContextMenuShortcut>Ctrl G</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem v-if="grouped" @select="$emit('ungroup')"><Ungroup />Ungroup<ContextMenuShortcut>Ctrl Shift G</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" :disabled="locked" @select="$emit('deleteBoard')"><Trash2 />Delete board<ContextMenuShortcut>⌫</ContextMenuShortcut></ContextMenuItem>
      </template>
    </template>
    <template v-else-if="type === 'note'">
      <template v-if="canvasLevel">
        <ContextMenuItem @select="$emit('copy')"><Copy />Copy<ContextMenuShortcut>Ctrl C</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem @select="$emit('duplicate')"><CopyPlus />Duplicate<ContextMenuShortcut>Ctrl D</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem @select="$emit('reorder', 'front')"><ArrowUpToLine />Bring to front<ContextMenuShortcut>Ctrl ]</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem @select="$emit('reorder', 'forward')"><ChevronUp />Bring forward<ContextMenuShortcut>]</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem @select="$emit('reorder', 'backward')"><ChevronDown />Send backward<ContextMenuShortcut>[</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem @select="$emit('reorder', 'back')"><ArrowDownToLine />Send to back<ContextMenuShortcut>Ctrl [</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem @select="$emit('lock')"><component :is="locked ? LockOpen : Lock" />{{ locked ? 'Unlock' : 'Lock' }}<ContextMenuShortcut>Ctrl Shift L</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem v-if="canGroup" @select="$emit('group')"><Group />Group<ContextMenuShortcut>Ctrl G</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem v-if="grouped" @select="$emit('ungroup')"><Ungroup />Ungroup<ContextMenuShortcut>Ctrl Shift G</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSeparator />
      </template>
      <ContextMenuItem :disabled="!canvasLevel || locked" variant="destructive" @select="$emit('deleteNote')"><Trash2 />Delete</ContextMenuItem>
    </template>
    <template v-else>
      <template v-if="canvasLevel">
        <ContextMenuItem @select="$emit('addBoard')"><Plus />Add board here</ContextMenuItem>
        <ContextMenuItem @select="$emit('addSticky')"><StickyNote />Add sticky note</ContextMenuItem>
        <ContextMenuItem :disabled="!hasClip" @select="$emit('paste')"><ClipboardPaste />Paste<ContextMenuShortcut>Ctrl V</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSeparator />
      </template>
      <ContextMenuItem @select="$emit('fit')"><ScanSearch />Fit all<ContextMenuShortcut>0</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuItem @select="$emit('zoom', 1.2)"><Plus />Zoom in</ContextMenuItem>
      <ContextMenuItem @select="$emit('zoom', 1 / 1.2)"><Minus />Zoom out</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @select="$emit('present')"><Presentation />Present canvas</ContextMenuItem>
    </template>
  </ContextMenuContent>
</template>
