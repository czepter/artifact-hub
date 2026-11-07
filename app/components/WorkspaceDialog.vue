<script setup lang="ts">
// Create or rename a workspace (name, description, colour).
import { Check } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const props = defineProps<{ workspace?: WorkspaceInfo | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [WorkspaceInfo] }>()

const name = ref('')
const description = ref('')
const color = ref<string | null>(null)
const busy = ref(false)
const error = ref('')
watch(open, (o) => {
  if (!o) return
  name.value = props.workspace?.name ?? ''
  description.value = props.workspace?.description ?? ''
  color.value = props.workspace?.color ?? null
  error.value = ''
})

async function save() {
  busy.value = true
  error.value = ''
  try {
    const body = { name: name.value, description: description.value, color: color.value }
    const w = props.workspace
      ? await $fetch<WorkspaceInfo>(`/api/workspaces/${props.workspace.id}`, { method: 'PATCH', body })
      : await $fetch<WorkspaceInfo>('/api/workspaces', { method: 'POST', body })
    open.value = false
    emit('saved', w)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Could not save the workspace'
  } finally { busy.value = false }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <form class="grid gap-4" @submit.prevent="save">
        <DialogHeader>
          <DialogTitle>{{ workspace ? 'Edit workspace' : 'New workspace' }}</DialogTitle>
          <DialogDescription>Workspaces group artifacts. Each artifact lives in exactly one.</DialogDescription>
        </DialogHeader>
        <div class="grid gap-1.5">
          <Label for="ws-name">Name</Label>
          <Input id="ws-name" v-model="name" maxlength="60" required autocomplete="off" placeholder="Brand site" />
        </div>
        <div class="grid gap-1.5">
          <Label for="ws-desc">Description <span class="font-normal text-muted-foreground">(optional)</span></Label>
          <Textarea id="ws-desc" v-model="description" maxlength="500" rows="2" />
        </div>
        <fieldset class="grid gap-1.5">
          <legend class="mb-1.5 text-sm font-medium leading-none">Colour</legend>
          <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
            <Button type="button" variant="outline" size="icon" class="size-7 rounded-full" role="radio" :aria-checked="color === null" aria-label="No colour" @click="color = null">
              <Check v-if="color === null" class="size-3.5" />
            </Button>
            <Button
              v-for="c in WORKSPACE_COLORS" :key="c" type="button" variant="outline" size="icon" class="size-7 rounded-full border-transparent"
              :style="{ backgroundColor: c }" role="radio" :aria-checked="color === c" :aria-label="`Colour ${c}`" @click="color = c"
            >
              <Check v-if="color === c" class="size-3.5 text-white" />
            </Button>
          </div>
        </fieldset>
        <Alert v-if="error" variant="destructive" role="alert"><AlertDescription>{{ error }}</AlertDescription></Alert>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="busy || !name.trim()">{{ workspace ? 'Save' : 'Create' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
