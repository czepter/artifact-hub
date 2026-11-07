export function bytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
/** Unix seconds -> "5 min ago" / date. */
export const agoS = (s: number | null | undefined) => (s ? ago(new Date(s * 1000).toISOString()) : 'never')
