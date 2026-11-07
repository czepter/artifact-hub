// The Design Component runtime, served to boards as `support.js`: React 18 (MIT, see server/assets/dc/REACT-LICENSE),
// ReactDOM, then our own .dc.html runtime (server/assets/dc/dc-runtime.js).
let cached: string | null = null

export async function dcSupportJs(): Promise<string> {
  if (cached) return cached
  const storage = useStorage('assets:server')
  const parts = await Promise.all(
    ['dc/react.production.min.js', 'dc/react-dom.production.min.js', 'dc/dc-runtime.js'].map(async (k) => {
      const raw = await storage.getItemRaw(k)
      if (!raw) throw createError({ statusCode: 500, statusMessage: `Missing server asset ${k}` })
      return Buffer.from(raw as Uint8Array).toString('utf8')
    }),
  )
  cached = parts.join('\n;\n')
  return cached
}
