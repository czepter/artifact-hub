// Colours and sizes for notes and shapes on the canvas.
export const FILL: Record<string, { bg: string, bd: string }> = {
  yellow: { bg: '#fef3c7', bd: '#fcd34d' }, gray: { bg: '#f1f1f1', bd: '#d4d4d8' }, red: { bg: '#fecaca', bd: '#f87171' }, orange: { bg: '#fed7aa', bd: '#fb923c' },
  green: { bg: '#bbf7d0', bd: '#4ade80' }, teal: { bg: '#99f6e4', bd: '#2dd4bf' }, blue: { bg: '#bfdbfe', bd: '#60a5fa' }, purple: { bg: '#e9d5ff', bd: '#c084fc' },
  pink: { bg: '#fbcfe8', bd: '#f472b6' }, none: { bg: 'transparent', bd: 'transparent' },
}
export const fillOf = (f: string) => FILL[f] ?? (/^#[0-9a-f]{6}$/i.test(f) ? { bg: f, bd: f } : FILL.yellow!)
export const TEXT_PX: Record<string, number> = { s: 14, m: 18, l: 24, xl: 32, xxl: 48 }
