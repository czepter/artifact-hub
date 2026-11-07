import { launch, api, B } from './bh.mjs'
import { execSync } from 'node:child_process'
// fresh artifact modelled on the user's screenshot: a page with a card, then an image dropped in
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Free</title></head><body style="margin:0;font-family:system-ui;background:#f4f4f5"><div style="max-width:520px;margin:40px auto;background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:28px"><h1 style="margin:0 0 12px">Zugriff erlauben?</h1><p style="margin:0 0 16px">Dieser Client darf Tools aufrufen.</p><button style="padding:10px 16px;border:0;border-radius:8px;background:#3730a3;color:#fff">Zugriff erlauben</button></div></body></html>`
const art = await api('/api/artifacts', { title: 'Free placement test', files: [{ path: 'index.html', content: page }] })
const { browser, page: pg, logs } = await launch({ viewport: { width: 1440, height: 900 } })
await pg.goto(`${B}/a/${art.id}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(700)
await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(500)
const frame = pg.frameLocator('iframe').first()
// add an image by dragging it from the palette into the card (palette -> iframe)
const imgBtn = pg.locator('button.grab', { hasText: 'Image' })
const bb = await imgBtn.boundingBox(); const card = await pg.locator('iframe').boundingBox()
await pg.mouse.move(bb.x + 20, bb.y + 10); await pg.mouse.down(); await pg.mouse.move(bb.x - 100, bb.y + 30, { steps: 5 }); await pg.mouse.move(card.x + 300, card.y + 160, { steps: 8 }); await pg.mouse.up()
await pg.waitForTimeout(500)
const img = frame.locator('img').first()
console.log('image inserted:', await img.count() === 1)
const before = await img.boundingBox()
await pg.screenshot({ path: 'free-1.png' })
// switch it to Free via the panel
await pg.locator('.seg[aria-label="Position"] button', { hasText: 'Free' }).click(); await pg.waitForTimeout(400)
const pos = await img.evaluate(e => { const s = getComputedStyle(e); return { position: s.position, left: s.left, top: s.top, width: s.width } })
console.log('after "Free": ', JSON.stringify(pos))
const afterFree = await img.boundingBox()
console.log('did NOT jump when converted (dx,dy px):', Math.round(afterFree.x - before.x), Math.round(afterFree.y - before.y))
// drag it 220px right / 90px down with the mouse
const c = { x: afterFree.x + afterFree.width / 2, y: afterFree.y + afterFree.height / 2 }
await pg.mouse.move(c.x, c.y); await pg.mouse.down(); await pg.mouse.move(c.x + 110, c.y + 45, { steps: 6 }); await pg.mouse.move(c.x + 220, c.y + 90, { steps: 6 }); await pg.mouse.up()
await pg.waitForTimeout(300)
const moved = await img.boundingBox()
console.log('dragged by:', Math.round(moved.x - afterFree.x), Math.round(moved.y - afterFree.y), '(wanted ~220, ~90; snapping may nudge a few px)')
await pg.screenshot({ path: 'free-2.png' })
// resize with the SE handle
const handle = pg.frameLocator('iframe').first().locator('[data-hub-handle="se"]')
const hb = await pg.evaluate(() => null)
const box = await img.boundingBox()
await pg.mouse.move(box.x + box.width, box.y + box.height); await pg.mouse.down(); await pg.mouse.move(box.x + box.width + 60, box.y + box.height + 40, { steps: 6 }); await pg.mouse.up(); await pg.waitForTimeout(300)
const resized = await img.boundingBox()
console.log('resized by:', Math.round(resized.width - box.width), Math.round(resized.height - box.height), '(wanted ~60, ~40)')
await pg.waitForTimeout(2200)   // let the batched save happen
console.log('status text:', (await pg.locator('.status').innerText()).trim())
await pg.screenshot({ path: 'free-3.png' })
const zip = execSync(`curl -s -H "authorization: Bearer ${process.env.T}" ${B}/api/artifacts/${art.id}/export -o /tmp/free.zip && python3 -c "import zipfile;print(zipfile.ZipFile('/tmp/free.zip').read('index.html').decode())"`).toString()
const m = zip.match(/<img[^>]*>/)
console.log('SAVED <img>:', m && m[0].replace(/src="[^"]{30,}"/, 'src="…"'))
console.log('parent got position:relative:', /position: relative/.test(zip))
console.log('errors:', logs.length ? logs : 'none')
await browser.close()
console.log('artifact', art.id)
