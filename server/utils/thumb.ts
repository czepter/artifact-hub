import { signFrameToken } from './auth'
import { readFile } from './store'

// What a card previews: a canvas shows its first board at the board's own size, a page shows index.html at desktop size.
export function thumbFor(id: string, version: number): { src: string, w: number, h: number } | null {
  try {
    const base = `/f/${signFrameToken(id, 3600)}@${version}/`
    const raw = readFile(id, version, 'canvas.json')
    if (raw) {
      const boards = (JSON.parse(raw.content.toString('utf8')).boards ?? {}) as Record<string, { w?: number, h?: number }>
      const [path, b] = Object.entries(boards)[0] ?? []
      return path ? { src: base + path, w: b?.w ?? 1280, h: b?.h ?? 800 } : null
    }
    return readFile(id, version, 'index.html') ? { src: base + 'index.html', w: 1280, h: 800 } : null
  } catch { return null }
}
