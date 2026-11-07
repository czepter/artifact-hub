import { chromium } from 'playwright-core'
export const B = process.env.HUB || 'http://192.168.42.16:3100'
export const TOKEN = 'devtoken'
export async function launch(opts = {}) {
  const browser = await chromium.launch({ executablePath: '/home/christian/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox'], env: { ...process.env, LD_LIBRARY_PATH: '/tmp/claude-1000/-home-christian--t3-scratch-2026-11-06-is-there-an-opensource-alternative-39b4b457/00602bf4-a546-4128-a40b-6523462d718e/scratchpad/libs/root/usr/lib/x86_64-linux-gnu', FONTCONFIG_FILE: '/tmp/claude-1000/-home-christian--t3-scratch-2026-11-06-is-there-an-opensource-alternative-39b4b457/00602bf4-a546-4128-a40b-6523462d718e/scratchpad/libs/fc/fonts.conf' } })
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 } })
  await ctx.request.post(B + '/api/login', { data: { token: TOKEN } })
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
