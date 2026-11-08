// A small picture of one board, for the zoomed-out canvas: a live page per board costs a whole document in the
// viewer's browser, a picture costs a decoded image. Stored per board and replaced when the board's content changes.
import { createHash } from 'node:crypto'
import { useDb } from '../db'
import { listFiles, readFile } from '../store'
import { htmlRendererAvailable, shootBoards } from './browser'

const SCALE = 0.5
const QUALITY = 72

export interface ThumbInfo { key: string, w: number, h: number, tweaks?: Record<string, unknown> }

function boardsOf(id: string, version: number): Record<string, any> | null {
  const raw = readFile(id, version, 'canvas.json')
  if (!raw) return null
  try { return JSON.parse(raw.content.toString('utf8'))?.boards ?? null } catch { return null }
}

/** What a board's picture depends on: its own file, the shared assets (css, js, images), its size and tweaks. Moving a board or editing another one changes nothing. */
export function thumbInfo(id: string, version: number, path: string, files = listFiles(id, version), boards = boardsOf(id, version)): ThumbInfo | null {
  const b = boards?.[path], own = files.find(f => f.path === path)
  if (!b || !own) return null
  const assets = Math.max(0, ...files.filter(f => !f.content_type.startsWith('text/html') && f.path !== 'canvas.json').map(f => f.rev))
  const clamp = (n: number) => Math.min(8000, Math.max(1, n))
  const w = clamp(Math.round(+b.w || 800)), h = clamp(Math.round(+b.h || 600))
  return { key: createHash('sha1').update(JSON.stringify([own.rev, assets, w, h, b.tweaks ?? null])).digest('base64url').slice(0, 16), w, h, tweaks: b.tweaks }
}

// One at a time: a canvas asks for every board at once, and each picture is a browser page on this server.
let queue: Promise<unknown> = Promise.resolve()
const running = new Map<string, Promise<Buffer | null>>()
/** Above one artifact's maximum board count; past it a new draw answers 'busy'. */
const MAX_PENDING = 600

async function shoot(id: string, version: number, path: string, info: ThumbInfo): Promise<Buffer | null> {
  if (!(await htmlRendererAvailable())) return null
  const shots = await shootBoards(id, version, [{ path, w: info.w, h: info.h }], SCALE, () => info.tweaks, QUALITY)
  const uri = shots.get(path)?.uri
  // A failed board is stored as an empty picture, so it is not redrawn on every request (the key changes with its content).
  const jpeg = uri ? Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64') : Buffer.alloc(0)
  useDb().prepare('INSERT OR REPLACE INTO thumbs (artifact_id, path, key, jpeg) VALUES (?, ?, ?, ?)').run(id, path, info.key, jpeg)
  return jpeg.length ? jpeg : null
}

/** The stored picture, or (when `draw`) a new one: null when this server cannot draw boards or this board failed, 'busy' when too many draws wait. */
export function boardThumb(id: string, version: number, path: string, info: ThumbInfo, draw: boolean): Promise<Buffer | null | 'busy'> {
  const row = useDb().prepare('SELECT jpeg FROM thumbs WHERE artifact_id = ? AND path = ? AND key = ?').get(id, path, info.key) as { jpeg: Uint8Array } | undefined
  if (row) return Promise.resolve(row.jpeg.length ? Buffer.from(row.jpeg) : null)
  if (!draw) return Promise.resolve(null)
  const k = `${id}/${path}/${info.key}`
  const busy = running.get(k)
  if (busy) return busy
  if (running.size >= MAX_PENDING) return Promise.resolve('busy')
  const job = queue.then(() => shoot(id, version, path, info)).catch(() => null).finally(() => running.delete(k))
  queue = job
  running.set(k, job)
  return job
}

/** After a publish: draws what changed in the background, so the next visit finds pictures ready. */
export async function warmThumbs(id: string, version: number) {
  const boards = boardsOf(id, version)
  if (!boards) return
  const files = listFiles(id, version), have = useDb().prepare('SELECT 1 FROM thumbs WHERE artifact_id = ? AND path = ? AND key = ?')
  const missing = Object.keys(boards).flatMap((path) => {
    const info = thumbInfo(id, version, path, files, boards)
    return info && !have.get(id, path, info.key) ? [{ path, info }] : []
  })
  // Every canvas edit publishes; most change no picture, and those must not start a browser.
  if (!missing.length || !(await htmlRendererAvailable())) return
  for (const { path, info } of missing) if (await boardThumb(id, version, path, info, true) === 'busy') break
}
