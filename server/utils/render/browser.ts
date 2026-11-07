// Optional board renderer: a headless Chromium draws the real HTML. Nothing here is required; without a browser the
// renderer falls back to a text outline of each board (see shared/canvasRender.ts).
//
// Where the browser comes from, in order: HUB_CHROMIUM (path), Playwright's own download, common system paths, a
// Playwright cache in the home directory. `HUB_RENDER_HTML=0` turns it off.
//
// Safety: a board is untrusted HTML that may run scripts. It gets a fresh context, JavaScript on (the Design
// Component runtime needs it), and NO network: every request except the artifact's own files (served from the
// store, never from a socket) and data: URLs is aborted, so a board cannot probe the host's network. Service
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
let idle: ReturnType<typeof setTimeout> | null = null

async function getBrowser(): Promise<any | null> {
  if (process.env.HUB_RENDER_HTML === '0') return null
  if (browserP) { const b = await browserP; if (b?.isConnected()) return b; browserP = null }
  browserP = (async () => {
    try {
      const exe = findExecutable()
      if (!exe) return null
      const { chromium } = await import('playwright-core')
      const b = await chromium.launch({
        executablePath: exe, headless: true,
        args: ['--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', ...(process.env.HUB_CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
      })
      b.on('disconnected', () => { browserP = null })
      return b
    } catch (e) {
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
export async function shootBoards(artifactId: string, version: number, items: ShotItem[], dsf: number, tweaks: (path: string) => Record<string, unknown> | undefined): Promise<Map<string, Shot>> {
  const out = new Map<string, Shot>()
  const browser = await getBrowser()
  if (!browser || !items.length) return out
  if (idle) clearTimeout(idle)
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: Math.min(3, Math.max(1, dsf)), serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: true, permissions: [], colorScheme: 'light' })
  try {
    await ctx.route('**/*', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.origin !== ORIGIN) return route.abort()
      try {
        const path = cleanPath(decodeURIComponent(url.pathname.slice(1)) || 'index.html')
        let file = readFile(artifactId, version, path)
        if (/(^|\/)support\.js$/.test(path) && (!file || file.content.toString('utf8', 0, 400_000).includes('DCLogic'))) file = { content: Buffer.from(await dcSupportJs()), contentType: 'text/javascript; charset=utf-8' }
        if (!file) return route.fulfill({ status: 404, body: 'not found' })
        const body = file.contentType.startsWith('text/html') ? instrumentHtml(file.content.toString('utf8'), { props: tweaks(path) }) : file.content
        return route.fulfill({ status: 200, contentType: file.contentType, body, headers: { 'Access-Control-Allow-Origin': '*' } })
      } catch { return route.fulfill({ status: 400, body: 'bad path' }) }
    })
    for (const it of items) {
      const page = await ctx.newPage()
      try {
        page.on('popup', (p: any) => p.close().catch(() => {}))
        page.on('dialog', (d: any) => d.dismiss().catch(() => {}))
        await page.setViewportSize({ width: Math.round(it.w), height: Math.round(it.h) })
        await page.goto(`${ORIGIN}/${it.path.split('/').map(encodeURIComponent).join('/')}`, { waitUntil: 'load', timeout: 12_000 })
        await page.evaluate(() => (document as any).fonts?.ready).catch(() => {})
        await page.waitForTimeout(250)
        let h = Math.round(it.h)
        if (it.fit === 'content') {
          h = Math.min(MAX_SHOT_H, Math.max(h, await page.evaluate(() => document.documentElement.scrollHeight)))
          if (h !== Math.round(it.h)) { await page.setViewportSize({ width: Math.round(it.w), height: h }); await page.waitForTimeout(100) }
        }
        const png: Buffer = await page.screenshot({ type: 'png', timeout: 10_000 })
        out.set(it.path, { uri: `data:image/png;base64,${png.toString('base64')}`, w: Math.round(it.w), h })
      } catch (e) {
        console.warn(`[render] board ${it.path} not drawn:`, (e as Error).message.split('\n')[0])
      } finally { await page.close().catch(() => {}) }
    }
  } finally {
    await ctx.close().catch(() => {})
    idle = setTimeout(() => { browserP?.then(b => b?.close().catch(() => {})); browserP = null }, 60_000)
    idle.unref?.()
  }
  return out
}
