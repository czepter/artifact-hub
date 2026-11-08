const errOf = (e: any, fallback: string) => e?.data?.statusMessage ?? e?.statusMessage ?? fallback

/** Creates an empty canvas artifact and opens it. Shared by the "New canvas" button and the command palette. */
export function useNewCanvas() {
  const busy = ref(false)
  const msg = ref('')
  async function newCanvas(workspace?: string) {
    busy.value = true
    msg.value = ''
    try {
      const canvas = { v: 1, title: 'Untitled canvas', boards: {}, order: [], notes: {} }
      const r = await $fetch<{ id: string }>('/api/artifacts', {
        method: 'POST', body: { title: 'Untitled canvas', files: [{ path: 'canvas.json', content: JSON.stringify(canvas, null, 2) }], label: 'New canvas', workspaceId: workspace },
      })
      await navigateTo(`/a/${r.id}`, { external: true })
    } catch (e) { msg.value = errOf(e, 'Could not create the canvas') } finally { busy.value = false }
  }
  return { busy, msg, newCanvas }
}
