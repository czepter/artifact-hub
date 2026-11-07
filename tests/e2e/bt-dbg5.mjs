import { launch, api, B } from './bh.mjs'
const page = `<!doctype html><html><head><meta charset="utf-8"><title>U</title></head><body style="margin:0;background:#eaeef6"><div id="card" style="max-width:560px;margin:24px auto 24px 280px;background:#f4f8ff;padding:28px"><h1>Zugriff</h1><p>Text</p></div></body></html>`
const art = await api('/api/artifacts', { title: 'dbg', files: [{ path: 'index.html', content: page }] })
const { browser, page: pg, logs } = await launch()
const msgs = []; await pg.exposeFunction('__log', m => msgs.push(m))
await pg.addInitScript(() => window.addEventListener('message', e => { const d = e.data; if (d && typeof d.type === 'string' && d.type.startsWith('hub:edit')) window.__log(JSON.stringify({ t: d.type, op: d.op, text: d.text })) }))
pg.on('console', m => msgs.push('console.' + m.type() + ': ' + m.text().slice(0, 200)))
await pg.goto(`${B}/a/${art.id}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(600)
await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(500)
const ifr = await pg.locator('iframe').boundingBox(); const btn = await pg.locator('button.grab', { hasText: 'Image' }).boundingBox()
msgs.length = 0
await pg.mouse.move(btn.x + 20, btn.y + 10); await pg.mouse.down(); await pg.mouse.move(btn.x - 100, btn.y + 40, { steps: 4 }); await pg.mouse.move(ifr.x + 120, ifr.y + 380, { steps: 6 }); await pg.mouse.up(); await pg.waitForTimeout(600)
console.log(msgs.join('\n'))
console.log('imgs in frame:', await pg.frameLocator('iframe').first().locator('img').count())
await browser.close(); await api(`/api/artifacts/${art.id}`, null, 'DELETE')
