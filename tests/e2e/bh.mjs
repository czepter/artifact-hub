import { chromium } from 'playwright-core'
export const B = process.env.HUB || 'http://localhost:3111'
export const TOKEN = 'devtoken'
export async function launch(opts = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 } })
  // `npm run dev:login` signs every browser request in; no login step.
  const page = await ctx.newPage()
  const logs = []
  page.on('console', m => { if (m.type() === 'error') logs.push('console.error: ' + m.text().slice(0, 300)) })
  page.on('pageerror', e => logs.push('pageerror: ' + e.message.slice(0, 300)))
  return { browser, ctx, page, logs }
}
export async function api(path, body, method) {
  const r = await fetch(B + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text(); try { return JSON.parse(t) } catch { return t }
}
