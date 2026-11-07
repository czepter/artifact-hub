import { launch, api, B } from './bh.mjs'
const list = await api('/api/artifacts'); const src = list.find(a => a.title === 'Test canvas')
const dup = await api(`/api/artifacts/${src.id}/duplicate`, {}, 'POST'); const ID = dup.id
const { browser, page: pg, logs } = await launch({ viewport: { width: 1500, height: 920 } })
await pg.exposeFunction('__dbgNode', (...a) => console.log('   [page]', ...a))
await pg.addInitScript(() => { window.__dbg = (...a) => window.__dbgNode(...a); window.__ev = false; for (const t of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','gotpointercapture']) window.addEventListener(t, e => { if (window.__ev) window.__dbgNode('EV', t, (e.target.className && e.target.className.baseVal === undefined ? e.target.className : e.target.tagName).toString().slice(0, 30), Math.round(e.clientX), Math.round(e.clientY), 'btn', e.buttons) }, true) })
await pg.goto(`${B}/a/${ID}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(900)
await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(500)
const sizeOf = async () => { const r = await pg.locator('[data-board]').first().boundingBox(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
const b = await pg.locator('[data-board]').first().boundingBox(); const s0 = await sizeOf()
await pg.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await pg.mouse.down(); await pg.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 30, { steps: 5 }); await pg.mouse.up()
console.log('after move:', await sizeOf(), 'was', s0)
for (const wait of [300, 1500]) {
  await pg.waitForTimeout(wait)
  const hs = await pg.locator('.hd').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }))
  const before = await sizeOf(); const se = hs[4]
  await pg.evaluate(() => { window.__ev = true }); await pg.mouse.move(se[0], se[1]); await pg.mouse.down(); await pg.mouse.move(se[0] + 20, se[1] + 15, { steps: 4 }); await pg.mouse.move(se[0] + 60, se[1] + 45, { steps: 4 })
  const mid = await sizeOf()
  await pg.mouse.up(); await pg.waitForTimeout(250)
  const after = await sizeOf()
  console.log(`resize ${wait}ms after move -> during: +${mid[2] - before[2]},+${mid[3] - before[3]}  after drop: +${after[2] - before[2]},+${after[3] - before[3]}  (want +60,+45)`)
}
console.log('errors:', logs)
await browser.close(); await api(`/api/artifacts/${ID}`, null, 'DELETE')
