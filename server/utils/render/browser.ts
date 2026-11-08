// Optional board renderer: a headless Chromium draws the real HTML. Nothing here is required; without a browser the
// renderer falls back to a text outline of each board (see shared/canvasRender.ts).
//
// Where the browser comes from, in order: HUB_CHROMIUM (path), Playwright's own download, common system paths, a
// Playwright cache in the home directory. `HUB_RENDER_HTML=0` turns it off.
//
// Safety: a board is untrusted HTML that may run scripts. It gets a fresh context, JavaScript on (the Design
// Component runtime needs it), and NO network: every request except the artifact's own files (served from the
// store, never from a socket) and data: URLs is aborted, page WebSockets are closed (a CSP stops those opened in
// workers), and WebRTC is removed and its UDP blocked, so a board cannot probe the host's network. Each board has a
// deadline (SHOT_MS); if a hung renderer will not close, the browser is restarted. Service
// workers, downloads, permissions and popups are off. Set HUB_CHROMIUM_NO_SANDBOX=1 only where the browser cannot
// start its sandbox (typically a container); the Docker image documents this trade-off.
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cleanPath, readFile } from '../store'
import { instrumentHtml } from '../frame'
import { dcSupportJs } from '../dc'

const ORIGIN = 'http://artifact.invalid'
const MAX_SHOT_H = 8000
const MAX_SHOT_PIXELS = 16_000_000
const TOTAL_BUDGET_MS = 60_000
const SHOT_MS = 20_000
const CLOSE_MS = 5_000
const CSP = "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; worker-src 'self' blob:; webrtc 'block'"

function findExecutable(): string | null {
  const env = process.env.HUB_CHROMIUM
  if (env) return existsSync(env) ? env : null
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium']) if (existsSync(p)) return p
  try { // a Playwright cache (dev machines)
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright')
    const dirs = readdirSync(root).filter(d => /^chromium(_headless_shell)?-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    for (const d of dirs) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/headless_shell']) {
        const p = join(root, d, sub)
        if (existsSync(p)) return p
      }
    }
  } catch { /* no cache */ }
  return null
}

let browserP: Promise<any | null> | null = null
/** The browser `browserP` resolves to, so a late event from an old browser cannot reset a newer one. */
let current: any = null
let idle: ReturnType<typeof setTimeout> | null = null
/** When the browser last failed to start: not retried for a minute, so a broken install does not slow every render. */
let failedAt = 0

async function getBrowser(): Promise<any | null> {
  if (process.env.HUB_RENDER_HTML === '0' || Date.now() - failedAt < 60_000) return null
  if (browserP) { const b = await browserP; if (b?.isConnected()) return b; browserP = null }
  browserP = (async () => {
    try {
      const exe = findExecutable()
      if (!exe) { failedAt = Date.now(); return null }
      const { chromium } = await import('playwright-core')
      const b = await chromium.launch({
        executablePath: exe, headless: true,
        args: ['--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', ...(process.env.HUB_CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
      })
      current = b
      b.on('disconnected', () => { if (current === b) browserP = null })
      return b
    } catch (e) {
      failedAt = Date.now()
      console.warn('[render] browser unavailable:', (e as Error).message.split('\n')[0])
      return null
    }
  })()
  return browserP
}

/** Whether HTML boards can be drawn for real. Cheap after the first call. */
export async function htmlRendererAvailable(): Promise<boolean> {
  return !!(await getBrowser())
}

export interface ShotItem { path: string, w: number, h: number, /** Grow the picture to the page's height (a page artifact, not a canvas board). */ fit?: 'content' }
export interface Shot { uri: string, w: number, h: number }

/**
 * Draws each item at its size (device scale `dsf`, 1 to 3) and returns PNG data URIs. An item that fails (timeout,
 * crash) is left out: the caller falls back to the outline for it.
 */
export async function shootBoards(artifactId: string, version: number, items: ShotItem[], dsf: number, tweaks: (path: string) => Record<string, unknown> | undefined, jpegQuality?: number): Promise<Map<string, Shot>> {
  const out = new Map<string, Shot>()
  const browser = await getBrowser()
  if (!browser || !items.length) return out
  if (idle) clearTimeout(idle)
  const started = Date.now()
  try {
    for (const it of items) {
      // Pictures are capped at 16 megapixels (a huge board at device scale 2 would not fit a texture): lower the scale, or leave the board to the outline.
      const minD = jpegQuality ? 0.25 : 1 // a JPEG is asked for as a small preview
      const d = Math.min(Math.min(3, Math.max(minD, dsf)), Math.sqrt(MAX_SHOT_PIXELS / (it.w * Math.max(it.h, 1))))
      if (d < minD || Date.now() - started > TOTAL_BUDGET_MS) continue
      const ctx = await browser.newContext({ viewport: { width: Math.round(it.w), height: Math.round(it.h) }, deviceScaleFactor: d, serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: true, permissions: [], colorScheme: 'light' })
      await ctx.addInitScript(() => { delete (globalThis as any).RTCPeerConnection; delete (globalThis as any).webkitRTCPeerConnection })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const shot = await Promise.race([drawOne(ctx, artifactId, version, it, tweaks, jpegQuality), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${SHOT_MS} ms`)), SHOT_MS) })])
        out.set(it.path, shot)
      } catch (e) {
        console.warn(`[render] board ${it.path} not drawn:`, (e as Error).message.split('\n')[0])
      } finally {
        clearTimeout(timer)
        // A hung renderer can keep close() from returning: then the whole browser goes, and the next shot starts a fresh one.
        let t: ReturnType<typeof setTimeout> | undefined
        const closed = await Promise.race([ctx.close().then(() => true, () => true), new Promise<boolean>((r) => { t = setTimeout(() => r(false), CLOSE_MS) })])
        clearTimeout(t)
        if (!closed) {
          if (current === browser) browserP = null
          browser.close().catch(() => {})
          break // the remaining boards fall back to the outline; a concurrent shot on this browser fails and is logged as not drawn
        }
      }
    }
  } finally {
    idle = setTimeout(() => { browserP?.then(b => b?.close().catch(() => {})); browserP = null }, 60_000)
    idle.unref?.()
  }
  return out
}

/** One board in its own context: routes, page, screenshot. The caller enforces the deadline. */
async function drawOne(ctx: any, artifactId: string, version: number, it: ShotItem, tweaks: (path: string) => Record<string, unknown> | undefined, jpegQuality?: number): Promise<Shot> {
  await ctx.route('**/*', async (route: any) => {
    const url = new URL(route.request().url())
    if (url.origin !== ORIGIN) return route.abort()
    try {
      const path = cleanPath(decodeURIComponent(url.pathname.slice(1)) || 'index.html')
      let file = readFile(artifactId, version, path)
      if (/(^|\/)support\.js$/.test(path) && (!file || file.content.toString('utf8', 0, 400_000).includes('DCLogic'))) file = { content: Buffer.from(await dcSupportJs()), contentType: 'text/javascript; charset=utf-8' }
      if (!file) return route.fulfill({ status: 404, body: 'not found' })
      const body = file.contentType.startsWith('text/html') ? instrumentHtml(file.content.toString('utf8'), { props: tweaks(path) }) : file.content
      return route.fulfill({ status: 200, contentType: file.contentType, body, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': CSP } })
    } catch { return route.fulfill({ status: 400, body: 'bad path' }) }
  })
  await ctx.routeWebSocket(/.*/, (ws: any) => ws.close())
  const page = await ctx.newPage()
  page.on('popup', (p: any) => p.close().catch(() => {}))
  page.on('dialog', (x: any) => x.dismiss().catch(() => {}))
  await page.goto(`${ORIGIN}/${it.path.split('/').map(encodeURIComponent).join('/')}`, { waitUntil: 'load', timeout: 12_000 })
  await page.evaluate(() => (document as any).fonts?.ready).catch(() => {})
  await page.waitForTimeout(250)
  let h = Math.round(it.h)
  if (it.fit === 'content') {
    h = Math.min(MAX_SHOT_H, Math.max(h, await page.evaluate(() => document.documentElement.scrollHeight)))
    if (h !== Math.round(it.h)) { await page.setViewportSize({ width: Math.round(it.w), height: h }); await page.waitForTimeout(100) }
  }
  const shot: Buffer = await page.screenshot(jpegQuality ? { type: 'jpeg', quality: jpegQuality, timeout: 10_000 } : { type: 'png', timeout: 10_000 })
  return { uri: `data:image/${jpegQuality ? 'jpeg' : 'png'};base64,${shot.toString('base64')}`, w: Math.round(it.w), h }
}
