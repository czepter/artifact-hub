// Canvas performance benchmark. Publishes a board-heavy canvas (the shape of a real 47-board design file, synthetic
// content), then measures load, memory and pan/zoom/drag smoothness in a real browser.
//
//   node .output/server/index.mjs   (production build, HUB_DB pointing at a throwaway database)
//   node tests/e2e/bt-perf.mjs      (HUB=http://localhost:3199 RUNS=3 BUDGET=1 SHOT=/path/prefix ID=latest to reuse the newest fixture)
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'

const B = process.env.HUB || 'http://localhost:3199'
const RUNS = +(process.env.RUNS || 3)
const BOARDS = +(process.env.BOARDS || 47) // BOARDS=1 measures the app's own floor; above 47 the extra boards are admin boards in 12 columns (the server caps an artifact at 500 files)
const NOTES = +(process.env.NOTES || 0) // extra notes on top of n1, n2 (deterministic mix of sticky, rect, text, arrow)
const COMMENTS = +(process.env.COMMENTS || 0) // top-level comments, posted after publishing
const TAG = `--perf-run=${process.pid}` // finds this browser's processes for the memory reading
const LAUNCH = { headless: true, args: [TAG], ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chromium' }) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
// Throwaway account on the local benchmark database only.
const ACCOUNT = { email: 'perf@example.test', password: 'perf-local-benchmark', name: 'Perf' }

// ---- fixture ------------------------------------------------------------------------------------------------------
const icon = 'M3 11l9-8 9 8M5 10v10h14V10'
const css = ':root{--s2:8px;--s3:12px;--s4:16px;--s5:24px;--ink:#1c1b19;--muted:#6b675f;--line:#e4e1da}*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui;color:var(--ink);background:#fff}.a{display:grid;grid-template-columns:260px 1fr}.a-side{padding:16px;border-right:1px solid var(--line)}.a-side a{display:flex;gap:8px;padding:6px 8px;color:inherit;text-decoration:none}.a-side svg{width:18px;height:18px;stroke:currentColor;fill:none}.a-main{padding:32px}.rc{border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:24px}.rows{list-style:none;padding:0;margin:0}.rows li{display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line)}.g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}\n'
  + Array.from({ length: 330 }, (_, i) => `.u${i}{padding:${i % 24}px;margin:${i % 16}px;color:color-mix(in srgb,var(--ink) ${i % 100}%,white)}.u${i}:hover>a{outline:1px solid var(--line)}`).join('\n')
const shell = `(function(){var el=document.querySelector('aside.a-side');if(!el)return;var h='';for(var i=0;i<22;i++)h+='<a href="#"><svg viewBox="0 0 24 24"><path d="${icon}"/></svg><span>Eintrag '+i+'</span></a>';el.innerHTML=h;})();`
const row = i => `<li><span><b>Beispielkunde ${i}</b> <span>Unbeantwortet vor ${i} Tagen</span></span><a class="u${i % 330}" href="#">Offen</a></li>`
const section = (n, i) => `<section class="rc"><h2>Bereich ${i}</h2><ul class="rows">${Array.from({ length: n }, (_, j) => row(j)).join('')}</ul></section>`
const page = (kb, w) => {
  const sections = Math.max(1, Math.round(kb / 0.75))
  const main = `<div class="g3">${Array.from({ length: sections }, (_, i) => section(5, i)).join('')}</div>`
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Screen</title><link rel="stylesheet" href="../css/app.css"></head><body><div class="a" ${w < 500 ? 'style="grid-template-columns:1fr"' : ''}>${w < 500 ? '' : '<aside class="a-side"></aside>'}<main class="a-main"><h1>Screen</h1>${main}</main></div><script src="../js/shell.js"></script></body></html>`
}
function fixture() {
  const sizes = [1.5, 3, 7, 4, 2.5, 3, 1, 10.6, 1.4, 1.5, 6, 2, 3.4, 1.5, 1.5, 3.6, 3, 1.9, 1.7, 2.3, 3.3, 8, 2, 3, 2.3, 1.4, 3.7]
  const boards = {}, files = [], order = []
  const add = (name, x, y, w, h, kb) => { if (order.length >= BOARDS) return; const p = `screens/${name}.html`; boards[p] = { x, y, w, h, title: name, is_interactive: true }; order.push(p); files.push({ path: p, content: page(kb, w) }) }
  for (let i = 0; i < 10; i++) add(`portal-${i}`, i * 510, 0, 390, 844, sizes[i % sizes.length])
  const cols = BOARDS > 47 ? 12 : 4, admins = Math.max(37, BOARDS - 10)
  for (let i = 0; i < admins; i++) add(`admin-${i}`, (i % cols) * 2040, 1100 + Math.floor(i / cols) * 1500, 1920, [1080, 1080, 1500, 1160][i % 4], sizes[i % sizes.length])
  const notes = { n1: { x: 0, y: -190, w: 4980, text: 'Portal', size: 's' }, n2: { x: 0, y: 960, w: 8040, text: 'Admin', size: 's' } }
  const maxX = (cols - 1) * 2040 + 1920, maxY = 1100 + Math.ceil(admins / cols) * 1500, frac = v => v - Math.floor(v)
  for (let i = 0; i < NOTES; i++) { // golden-ratio spread over the board bounds, no randomness
    const x = Math.round(frac(i * 0.6180339887) * maxX), y = Math.round(-190 + frac(i * 0.7548776662) * (maxY + 190)), m = i % 10
    notes[`m${i}`] = m < 5 ? { kind: 'sticky', x, y, w: 240, h: 140, text: `Note ${i}`, fill: 'yellow' }
      : m < 7 ? { kind: 'rect', x, y, w: 160, h: 100, fill: 'none' }
      : m < 8 ? { kind: 'text', x, y, w: 320, h: 36, text: `Label ${i}` }
      : { kind: 'arrow', x, y, w: 120, h: 60, bind: { start: { type: 'board', id: order[(i * 7) % order.length] } } }
  }
  const canvas = { v: 3, title: 'Perf fixture', launch: { view: 'canvas' }, boards, order, notes }
  return [{ path: 'canvas.json', content: JSON.stringify(canvas) }, { path: 'css/app.css', content: css }, { path: 'js/shell.js', content: shell }, ...files]
}

// ---- measuring ----------------------------------------------------------------------------------------------------
/** Every process of the benchmark browser: frames run in their own renderers and compositing in the GPU process, so the page's own timers cannot see that work. */
function procs() {
  const secs = t => t.split(':').reduce((s, p) => s * 60 + parseFloat(p), 0)
  const rows = execSync('ps -axo pid=,ppid=,rss=,time=,command=', { maxBuffer: 1 << 26 }).toString().trim().split('\n').map((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/); return m ? { pid: +m[1], ppid: +m[2], rss: +m[3], cpu: secs(m[4]), cmd: m[5] } : null
  }).filter(Boolean)
  const mine = new Set(rows.filter(r => r.cmd.includes(TAG) && !r.cmd.includes('--type=')).map(r => r.pid))
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (mine.has(r.ppid) && !mine.has(r.pid)) { mine.add(r.pid); grew = true } }
  return rows.filter(r => mine.has(r.pid))
}
const mb = list => Math.round(list.reduce((s, r) => s + r.rss, 0) / 1024)
function memory() {
  const list = procs(), renderers = list.filter(r => r.cmd.includes('--type=renderer'))
  return { rssMB: mb(list), rendererMB: mb(renderers), gpuMB: mb(list.filter(r => r.cmd.includes('--type=gpu-process'))), renderers: renderers.length }
}
const cpuMs = () => Math.round(procs().reduce((s, r) => s + r.cpu, 0) * 1000)
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const r1 = v => Math.round(v * 10) / 10

async function record(page, cdp, run) {
  await page.evaluate(() => {
    const st = window.__rec = { frames: [], long: 0, longN: 0, on: true }
    st.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { st.long += e.duration; st.longN++ } }); st.po.observe({ entryTypes: ['longtask'] })
    let last = performance.now(); const tick = (t) => { st.frames.push(t - last); last = t; if (st.on) requestAnimationFrame(tick) }; requestAnimationFrame(tick)
  })
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
  const a = await metrics(), cpu0 = cpuMs(), t0 = Date.now()
  await run()
  const wallMs = Date.now() - t0
  await sleep(120)
  const b = await metrics(), cpu = cpuMs() - cpu0
  const s = await page.evaluate(() => { const st = window.__rec; st.on = false; st.po.disconnect(); return { frames: st.frames.slice(1), long: st.long, longN: st.longN } })
  const d = k => r1((b[k] - a[k]) * 1000)
  return { cpuMs: cpu, wallMs, p50: r1(q(s.frames, .5)), p95: r1(q(s.frames, .95)), max: r1(Math.max(0, ...s.frames)), jank: s.frames.filter(f => f > 34).length, longMs: Math.round(s.long), scriptMs: d('ScriptDuration'), layoutMs: d('LayoutDuration'), styleMs: d('RecalcStyleDuration'), taskMs: d('TaskDuration') }
}
const liveFrames = page => page.evaluate(() => document.querySelectorAll('iframe').length)
const heapMB = async cdp => Math.round((await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'JSHeapUsedSize').value / 1048576)
const domCount = page => page.evaluate(() => document.querySelectorAll('*').length)
const zoomPct = page => page.evaluate(() => document.querySelector('.pct')?.textContent?.trim())

async function once(id) {
  const browser = await chromium.launch(LAUNCH)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  await signIn(ctx)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
  await page.addInitScript(() => {
    if (window.top !== window) return
    const st = window.__hubState = { n: 0, last: 0 }
    window.addEventListener('message', (e) => { if (e.data?.type === 'hub:ready') { st.n++; st.last = performance.now() } })
  })
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  const waitReady = async (quietMs = 2500, maxMs = 45000) => {
    const t0 = Date.now()
    let settled = null
    for (;;) {
      const s = await page.evaluate(() => {
        const inView = i => { const r = i.getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight }
        const imgs = [...document.querySelectorAll('img[data-thumb]')].filter(inView)
        return { n: window.__hubState.n, last: window.__hubState.last, now: performance.now(), boards: document.querySelectorAll('[data-board]').length, pending: imgs.filter(i => !i.complete).length }
      })
      if (s.boards && !s.pending) { settled ??= s.now; s.last = Math.max(s.last, settled); if (s.now - s.last > quietMs) return s } else settled = null
      if (Date.now() - t0 > maxMs) return s
      await sleep(150)
    }
  }

  const out = {}
  let requests = 0
  ctx.on('request', () => requests++)
  const t0 = Date.now(), cpu0 = cpuMs()
  await page.goto(`${B}/a/${id}`)
  await page.waitForSelector('.canvas')
  const ready = await waitReady()
  out.load = { readyMs: Math.round(ready.last), framesReady: ready.n, requests, cpuMs: cpuMs() - cpu0, wallMs: Date.now() - t0 }
  await sleep(1500)
  out.fit = { zoom: await zoomPct(page), iframes: await liveFrames(page), dom: await domCount(page), heapMB: await heapMB(cdp), ...memory() }
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-fit.png` })

  const box = await page.locator('.canvas').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  out.panFit = await record(page, cdp, async () => { for (let i = 0; i < 120; i++) { await page.mouse.wheel(0, i < 60 ? 8 : -8); await sleep(8) } })
  out.zoomFit = await record(page, cdp, async () => {
    await page.keyboard.down('Control')
    for (let i = 0; i < 80; i++) { await page.mouse.wheel(0, i < 40 ? -4 : 4); await sleep(8) }
    await page.keyboard.up('Control')
  })

  // Close up: zoom to 100% around the middle of the canvas, the way someone reads one screen.
  for (let i = 0; i < 40; i++) { const z = parseInt(await zoomPct(page), 10); if (z >= 96) break; await page.keyboard.press('+'); await sleep(60) }
  await waitReady(1500, 12000)
  await sleep(1500)
  out.close = { zoom: await zoomPct(page), iframes: await liveFrames(page), dom: await domCount(page), heapMB: await heapMB(cdp), ...memory() }
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-close.png` })
  out.panClose = await record(page, cdp, async () => { for (let i = 0; i < 120; i++) { await page.mouse.wheel(i < 60 ? 40 : -40, 0); await sleep(8) } })

  // Edit mode at the overview: drag one board.
  await page.keyboard.press('0')
  await sleep(700)
  await page.click('button:has-text("Edit")')
  await sleep(800)
  const b = await page.locator('[data-board]').nth(Math.min(12, BOARDS - 1)).boundingBox()
  const bx = b.x + b.width / 2, by = b.y + b.height / 2
  await page.mouse.move(bx, by)
  await page.mouse.down()
  out.dragFit = await record(page, cdp, async () => { for (let i = 1; i <= 60; i++) { await page.mouse.move(bx + i, by + i / 2); await sleep(8) } })
  await page.mouse.up()

  // Edit mode close up: drag the board nearest the middle of the view (grab point kept inside the canvas, below the top bar).
  for (let i = 0; i < 40; i++) { const z = parseInt(await zoomPct(page), 10); if (z >= 96) break; await page.keyboard.press('+'); await sleep(60) }
  await sleep(1500)
  const g = await page.evaluate(({ x, y, width: w, height: h }) => {
    const mx = x + w / 2, my = y + h / 2
    const best = [...document.querySelectorAll('[data-board]')].map((el) => { const r = el.getBoundingClientRect(); return { r, d: Math.hypot(r.x + r.width / 2 - mx, r.y + r.height / 2 - my) } }).sort((a, c) => a.d - c.d)[0].r
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
    return { x: clamp(clamp(mx, best.left + 40, best.right - 40), x + 80, x + w - 160), y: clamp(clamp(my, best.top + 40, best.bottom - 40), y + 80, y + h - 120) }
  }, box)
  await page.mouse.move(g.x, g.y)
  await page.mouse.down()
  out.dragClose = await record(page, cdp, async () => { for (let i = 1; i <= 60; i++) { await page.mouse.move(g.x + i, g.y + i / 2); await sleep(8) } })
  await page.mouse.up()
  out.errors = errors.length
  await browser.close()
  return out
}

async function signIn(ctx) {
  const headers = { origin: B }
  let r = await ctx.request.post(`${B}/api/auth/sign-in/email`, { data: ACCOUNT, headers })
  if (!r.ok()) r = await ctx.request.post(`${B}/api/auth/sign-up/email`, { data: ACCOUNT, headers })
  if (!r.ok()) throw new Error(`sign-in failed: ${r.status()} ${await r.text()}`)
}

async function publish() {
  const browser = await chromium.launch(LAUNCH)
  const ctx = await browser.newContext()
  await signIn(ctx)
  const r = await ctx.request.post(`${B}/api/artifacts`, { data: { title: 'Perf fixture', files: fixture() }, headers: { origin: B } })
  if (!r.ok()) throw new Error(`publish failed: ${r.status()} ${await r.text()}`)
  const a = await r.json()
  // Publishing draws the board pictures in the background; wait, so runs measure a warmed server.
  const t0 = Date.now(), paths = fixture().filter(f => f.path.startsWith('screens/')).map(f => f.path)
  let drawn = 0
  for (const p of paths) if ((await ctx.request.get(`${B}/api/view/${a.id}/thumb?path=${encodeURIComponent(p)}`, { timeout: 120000 })).ok()) drawn++
  const cr = JSON.parse(fixture()[0].content).order
  for (let i = 0; i < COMMENTS; i++) { // sequential on purpose: one writer, no rate-limit surprises
    const c = await ctx.request.post(`${B}/api/view/${a.id}/comments`, { headers: { origin: B }, data: { body: `Comment ${i}`, board: cr[i % cr.length], anchor: { selector: '#t', tag: 'h1', text: `Board ${i}`, rel: { x: 0.1, y: 0.1 }, click: { x: 200, y: 150 } } } })
    if (!c.ok()) throw new Error(`comment ${i} failed: ${c.status()} ${await c.text()}`)
  }
  console.log(`thumbs    drawn=${drawn}/${paths.length} ms=${Date.now() - t0}`)
  await browser.close()
  return a.id
}

/** ID=latest: reuse the newest 'Perf fixture' instead of publishing again. */
async function latest() {
  const browser = await chromium.launch(LAUNCH)
  const ctx = await browser.newContext()
  await signIn(ctx)
  const r = await ctx.request.get(`${B}/api/artifacts`)
  if (!r.ok()) throw new Error(`list failed: ${r.status()} ${await r.text()}`)
  const a = (await r.json()).filter(x => x.title === 'Perf fixture').sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)))[0]
  await browser.close()
  if (!a) throw new Error("no 'Perf fixture' artifact; run once without ID")
  return a.id
}

// ---- report -------------------------------------------------------------------------------------------------------
function median(runs) {
  const out = {}
  for (const sec of Object.keys(runs[0])) {
    if (typeof runs[0][sec] !== 'object') { out[sec] = q(runs.map(r => r[sec]), .5); continue }
    out[sec] = {}
    for (const k of Object.keys(runs[0][sec])) out[sec][k] = typeof runs[0][sec][k] === 'number' ? q(runs.map(r => r[sec][k]), .5) : runs[0][sec][k]
  }
  return out
}
console.log(`fixture boards=${JSON.parse(fixture()[0].content).order.length} notes=${NOTES + 2} comments=${COMMENTS}`)
const id = process.env.ID === 'latest' ? await latest() : await publish()
const runs = []
for (let i = 0; i < RUNS; i++) runs.push(await once(id))
const med = median(runs)
for (const [k, v] of Object.entries(med)) console.log(k.padEnd(9), typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a}=${b}`).join(' ') : v)
console.log('JSON ' + JSON.stringify(med))
if (process.env.BUDGET) {
  const budget = [['fit iframes', med.fit.iframes, 0], ['close iframes', med.close.iframes, 8], ['fit rendererMB', med.fit.rendererMB, 550], ['close rendererMB', med.close.rendererMB, 800], ['load requests', med.load.requests, 160], ['load cpuMs', med.load.cpuMs, 1200], ['panFit cpuMs', med.panFit.cpuMs, 1700], ['zoomFit cpuMs', med.zoomFit.cpuMs, 1500], ['dragFit cpuMs', med.dragFit.cpuMs, 900], ['dragFit jank', med.dragFit.jank, 2], ['page errors', med.errors, 0]]
  if (BOARDS >= 200) budget.splice(0, budget.length, ['fit iframes', med.fit.iframes, 0], ['close iframes', med.close.iframes, 12], ['close dom', med.close.dom, 5000], ['panFit wallMs', med.panFit.wallMs, 6500], ['panFit styleMs', med.panFit.styleMs, 200], ['zoomFit cpuMs', med.zoomFit.cpuMs, 6000], ['zoomFit jank', med.zoomFit.jank, 8], ['panClose p95', med.panClose.p95, 20], ['dragClose p95', med.dragClose.p95, 20], ['dragClose jank', med.dragClose.jank, 3], ['page errors', med.errors, 0])
  let bad = 0
  for (const [n, v, max] of budget) { const ok = v <= max; if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', n, v, '<=', max) }
  process.exit(bad ? 1 : 0)
}
