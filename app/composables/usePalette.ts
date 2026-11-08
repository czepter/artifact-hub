/** Open state of the global command palette, shared by the header triggers and the palette itself. */
export function usePalette() {
  const open = useState('hub-palette-open', () => false)
  const isMac = useState('hub-palette-mac', () => false)
  if (import.meta.client) onMounted(() => { isMac.value = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) })
  return { open, isMac, toggle: () => { open.value = !open.value } }
}
