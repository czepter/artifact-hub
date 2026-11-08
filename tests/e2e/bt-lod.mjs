// Board level-of-detail regression check: pictures zoomed out, live pages only when zoomed in and near the view.
//
//   node .output/server/index.mjs   (HUB_DB pointing at a throwaway database)
//   node tests/e2e/bt-lod.mjs       (HUB=http://localhost:3199 CHROME=/path/to/chrome)
import { chromium } from 'playwright-core'

const B = process.env.HUB || 'http://localhost:3199'
const LAUNCH = { headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chromium' }) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
// Throwaway account on the local benchmark database only.
const ACCOUNT = { email: 'perf@example.test', password: 'perf-local-benchmark', name: 'Perf' }
const N = 12

const paths = Array.from({ length: N }, (_, i) => `screens/b${i}.html`)
const fixture = () => {
  const boards = {}
  paths.forEach((p, i) => { boards[p] = { x: (i % 4) * 2040, y: Math.floor(i / 4) * 1200, w: 1920, h: 1080, title: `b${i}`, is_interactive: true } })
  // s3 sits far from the first boards, so it leaves the DOM when zoomed in at the top-left; a1 is an arrow bound to board b5.
  const notes = {
    s1: { kind: 'sticky', x: 50, y: -300, w: 240, h: 160, text: 'one', fill: 'yellow' },
    s2: { kind: 'sticky', x: 2100, y: -300, w: 240, h: 160, text: 'two', fill: 'blue' },
    s3: { kind: 'sticky', x: 7800, y: 3500, w: 240, h: 160, text: 'far', fill: 'green' },
    a1: { kind: 'arrow', x: 1900, y: 1000, w: 120, h: 60, bind: { start: { type: 'board', id: 'screens/b5.html' } } },
  }
  const canvas = { v: 3, title: 'LOD fixture', launch: { view: 'canvas' }, boards, notes, order: paths }
  const html = i => `<!doctype html><html><head><meta charset="utf-8"><title>b${i}</title></head><body style="margin:0;font:48px system-ui;background:hsl(${i * 30},60%,85%)"><h1 id="t">Board ${i}</h1><button>Go</button></body></html>`
  return [{ path: 'canvas.json', content: JSON.stringify(canvas) }, ...paths.map((p, i) => ({ path: p, content: html(i) }))]
}

async function signIn(ctx) {
  const headers = { origin: B }
  let r = await ctx.request.post(`${B}/api/auth/sign-in/email`, { data: ACCOUNT, headers })
  if (!r.ok()) r = await ctx.request.post(`${B}/api/auth/sign-up/email`, { data: ACCOUNT, headers })
  if (!r.ok()) throw new Error(`sign-in failed: ${r.status()} ${await r.text()}`)
}

let bad = 0
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`) }
const errors = []
const watch = (page) => { page.on('pageerror', e => errors.push(e.message.slice(0, 200))); return page }
const count = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel)
const zoom = page => page.evaluate(() => parseInt(document.querySelector('.pct')?.textContent ?? '0', 10))
const until = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await sleep(100) } }

const browser = await chromium.launch(LAUNCH)
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await signIn(ctx)
const r = await ctx.request.post(`${B}/api/artifacts`, { data: { title: 'LOD fixture', files: fixture() }, headers: { origin: B } })
if (!r.ok()) throw new Error(`publish failed: ${r.status()} ${await r.text()}`)
const id = (await r.json()).id
let drawn = 0
for (const p of paths) if ((await ctx.request.get(`${B}/api/view/${id}/thumb?path=${encodeURIComponent(p)}`, { timeout: 120000 })).ok()) drawn++
console.log(`thumbs drawn=${drawn}/${N}`)

const open = async (c = ctx, setup) => {
  const page = watch(await c.newPage())
  await setup?.(page)
  await page.goto(`${B}/a/${id}`)
  await page.waitForSelector('[data-board]')
  return page
}

// 1. overview: only pictures
let page = await open()
await until(async () => (await count(page, 'img[data-thumb]')) === N && await page.evaluate(() => [...document.querySelectorAll('img[data-thumb]')].every(i => i.complete)), 20000)
await sleep(500)
let s = await page.evaluate(() => ({ f: document.querySelectorAll('iframe').length, t: [...document.querySelectorAll('img[data-thumb]')].map(i => i.complete && i.naturalWidth > 0) }))
check('overview shows only pictures', s.f === 0 && s.t.length === N && s.t.every(Boolean), `iframes=${s.f} thumbs=${s.t.length} loaded=${s.t.filter(Boolean).length} zoom=${await zoom(page)}`)

// 2. zoomed in: some live pages, all visible, no picture under them
await page.mouse.move(720, 450)
for (let i = 0; i < 60 && (await zoom(page)) < 96; i++) { await page.keyboard.press('+'); await sleep(60) }
const z = await zoom(page)
await until(() => count(page, 'iframe'), 10000)
await sleep(1000)
s = await page.evaluate(() => {
  const fr = [...document.querySelectorAll('iframe')]
  return { n: fr.length, hidden: fr.filter(f => getComputedStyle(f).visibility !== 'visible').length, withThumb: fr.filter(f => f.closest('[data-board]')?.querySelector('img[data-thumb]')).length }
})
check('zoomed in mounts a few visible pages', z >= 96 && s.n >= 1 && s.n < N && s.hidden === 0 && s.withThumb === 0, `zoom=${z} iframes=${s.n} hidden=${s.hidden} stillWithThumb=${s.withThumb}`)

// 3. back to fit
await page.keyboard.press('0')
await sleep(1000)
check('fit returns to pictures', (await count(page, 'iframe')) === 0 && (await count(page, 'img[data-thumb]')) === N, `iframes=${await count(page, 'iframe')} thumbs=${await count(page, 'img[data-thumb]')}`)

// 4. focus
await page.keyboard.press('f')
await sleep(1200)
s = await page.evaluate(() => ({ n: document.querySelectorAll('iframe').length, vis: [...document.querySelectorAll('iframe')].some(f => getComputedStyle(f).visibility === 'visible'), bar: !!document.querySelector('.focusbar') }))
check('focus shows a live page, at most 2', s.bar && s.vis && s.n >= 1 && s.n <= 2, `focusbar=${s.bar} visible=${s.vis} iframes=${s.n}`)
await page.keyboard.press('Escape')
await sleep(500)
check('Escape leaves focus', (await count(page, '.focusbar')) === 0)
await page.close()

// 5. comment pin on a board with no live page
const cr = await ctx.request.post(`${B}/api/view/${id}/comments`, { headers: { origin: B }, data: { body: 'pin', board: paths[5], anchor: { selector: '#t', tag: 'h1', text: 'Board 5', rel: { x: 0.1, y: 0.1 }, click: { x: 200, y: 150 } } } })
page = await open()
await sleep(1500)
s = { pins: await count(page, '.pin'), f: await count(page, 'iframe') }
check('comment pin shows without a live page', cr.ok() && s.pins === 1 && s.f === 0, `comment=${cr.status()} pins=${s.pins} iframes=${s.f}`)
await page.close()

// 6. thumbnails missing: boards fall back to live pages
page = await open(ctx, p => p.route('**/thumb*', rt => rt.fulfill({ status: 404 })))
const live = await until(() => count(page, 'iframe'), 10000)
check('missing pictures fall back to live pages', live >= 1, `iframes=${live}`)
await page.close()

// ---- structure, counter-scale, selection, drag, minimap ----------------------------------------------------------
const pctText = page => page.evaluate(() => document.querySelector('.pct')?.textContent?.trim() ?? '')
const rectOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }, sel)
const B5 = '[data-board][data-path="screens/b5.html"]'
const centre = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
const zoomTo = async (page, min, at) => { await page.mouse.move(at.x, at.y); for (let i = 0; i < 60 && (await zoom(page)) < min; i++) { await page.keyboard.press('+'); await sleep(60) } await sleep(500) }
const startEdit = async (page) => { await page.click('button[title="Edit this board visually"]'); await sleep(800) }

// 7a/7b. percentage label and pin counter-scale
page = await open()
await sleep(1500)
const pct0 = await pctText(page)
const pin0 = await rectOf(page, '.pin')
const pinAt = pin0 && centre(pin0)
await zoomTo(page, 96, pinAt ?? { x: 720, y: 450 })
const pct1 = await pctText(page)
const pin1 = await until(() => rectOf(page, '.pin'), 5000)
check('.pct shows a percentage and changes on zoom', /^\d+%$/.test(pct0) && /^\d+%$/.test(pct1) && pct0 !== pct1, `overview=${pct0} zoomed=${pct1}`)
check('comment pin keeps its on-screen size', !!pin0 && !!pin1 && Math.abs(pin0.w - pin1.w) <= 4, `overview=${pin0?.w} zoomed=${pin1?.w}`)

// 4. notes leave and return
await page.keyboard.press('0')
await sleep(800)
const stickies = () => page.evaluate(() => [...document.querySelectorAll('.note.sticky')].map(e => e.offsetHeight))
const st0 = await stickies()
await zoomTo(page, 100, { x: 300, y: 250 })
const st1 = await stickies()
await page.keyboard.press('0')
await sleep(800)
const st2 = await stickies()
check('sticky notes leave the DOM when zoomed away and return on fit', st0.length === 3 && st1.length < 3 && st2.length === 3 && st0.every(h => h > 0) && st2.every(h => h > 0), `overview=${JSON.stringify(st0)} zoomed=${JSON.stringify(st1)} fit=${JSON.stringify(st2)}`)

// 7. minimap
await page.mouse.move(720, 450)
let mm = 0
for (let i = 0; i < 40 && !mm; i++) { await page.mouse.wheel(0, 400); await sleep(80); mm = await count(page, '[data-minimap]') }
await sleep(300)
const paths2 = await page.evaluate(() => document.querySelector('[data-minimap]')?.querySelectorAll('path').length ?? -1)
const w0 = await page.evaluate(() => document.querySelector('.world')?.style.transform)
if (mm) await page.click('[data-minimap]', { position: { x: 20, y: 20 } })
await sleep(800)
const w1 = await page.evaluate(() => document.querySelector('.world')?.style.transform)
check('minimap appears, has exactly 2 paths, click moves the view', mm === 1 && paths2 === 2 && !!w0 && w0 !== w1, `minimap=${mm} paths=${paths2} before=${w0} after=${w1}`)
await page.close()

// 3. selection handles at overview and zoomed in
page = await open()
await sleep(1500)
await startEdit(page)
let c5 = centre(await rectOf(page, B5))
await page.mouse.click(c5.x, c5.y)
await sleep(500)
const handles = () => page.evaluate(() => [...document.querySelectorAll('.hd')].map(e => e.getBoundingClientRect().width))
const near = (a, v, t) => a.length === 8 && a.every(w => Math.abs(w - v) <= t)
const h0 = await handles()
await zoomTo(page, 96, centre(await rectOf(page, B5)))
const h1 = await handles()
check('selection handles are 8 and about 10px at overview and zoomed in', near(h0, 10, 3) && near(h1, 10, 3), `overview=${JSON.stringify(h0)} zoomed=${JSON.stringify(h1)}`)
await page.close()

// 5/6. drag a board: it moves, persists, and the arrow bound to it follows
page = await open()
await sleep(1500)
await startEdit(page)
const A1 = '[data-note][data-id="a1"]'
const bb0 = await rectOf(page, B5)
const ar0 = await rectOf(page, A1)
c5 = centre(bb0)
await page.mouse.move(c5.x, c5.y)
await page.mouse.down()
for (let i = 1; i <= 10; i++) { await page.mouse.move(c5.x + 6 * i, c5.y + 3 * i); await sleep(30) }
await page.mouse.up()
await sleep(500)
const bb1 = await rectOf(page, B5)
const ar1 = await rectOf(page, A1)
const dx = bb1.x - bb0.x, dy = bb1.y - bb0.y
check('board drag moves it by about the pointer distance', Math.abs(dx - 60) <= 8 && Math.abs(dy - 30) <= 8, `moved=(${dx.toFixed(1)}, ${dy.toFixed(1)}) wanted=(60, 30)`)
check('bound arrow follows the dragged board', !!ar0 && !!ar1 && (Math.abs(ar1.x - ar0.x) > 2 || Math.abs(ar1.y - ar0.y) > 2 || Math.abs(ar1.w - ar0.w) > 2 || Math.abs(ar1.h - ar0.h) > 2), `before=${JSON.stringify(ar0)} after=${JSON.stringify(ar1)}`)
await sleep(3000)
await page.close()
page = await open()
await sleep(1500)
const bb2 = await rectOf(page, B5)
check('dragged board stays at its new place after reload', Math.abs(bb2.x - bb1.x) <= 8 && Math.abs(bb2.y - bb1.y) <= 8, `afterDrag=(${bb1.x.toFixed(1)}, ${bb1.y.toFixed(1)}) reloaded=(${bb2.x.toFixed(1)}, ${bb2.y.toFixed(1)})`)
await page.close()

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
process.exit(bad ? 1 : 0)
