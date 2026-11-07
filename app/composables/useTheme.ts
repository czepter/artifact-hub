export type ThemeChoice = 'light' | 'system' | 'dark'

/** Light / system / dark. "system" removes the attribute so the OS preference applies; the choice persists in localStorage. */
export function useTheme() {
  const theme = useState<ThemeChoice>('hub-theme', () => 'system')

  function apply(t: ThemeChoice) {
    theme.value = t
    const root = document.documentElement
    if (t === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', t)
    try { t === 'system' ? localStorage.removeItem('hub-theme') : localStorage.setItem('hub-theme', t) } catch { /* private mode: the choice lasts for this tab only */ }
  }

  onMounted(() => {
    try {
      const saved = localStorage.getItem('hub-theme')
      if (saved === 'light' || saved === 'dark') theme.value = saved
    } catch { /* ignore */ }
  })

  return { theme, setTheme: apply }
}
