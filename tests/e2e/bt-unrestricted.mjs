import { launch, api, B } from './bh.mjs'
import { execSync } from 'node:child_process'
const ok = (n, c, x = '') => console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 220))
const page = `<!doctype html><html><head><meta charset="utf-8"><title>U</title></head><body style="margin:0;font-family:system-ui;background:#eaeef6"><div id="card" style="max-width:560px;margin:24px auto 24px 280px;background:#f4f8ff;border:1px solid #d6dbe6;border-radius:12px;padding:28px"><h1 style="margin:0 0 12px">Zugriff erlauben?</h1><p style="margin:0 0 16px">Dieser Client darf Tools aufrufen.</p><button style="padding:10px 16px;border:0;border-radius:8px;background:#3730a3;color:#fff">Zugriff erlauben</button><p style="margin:16px 0 0">Footer text</p></div></body></html>`
const art = await api('/api/artifacts', { title: 'Unrestricted test', files: [{ path: 'index.html', content: page }] })
const { browser, page: pg, logs } = await launch({ viewport: { width: 1440, height: 900 } })
const src = () => { execSync(`curl -s -H "authorization: Bearer ${process.env.T}" ${B}/api/artifacts/${art.id}/export -o /tmp/un.zip`); return execSync(`python3 -c "import zipfile;print(zipfile.ZipFile('/tmp/un.zip').read('index.html').decode())"`).toString() }
await pg.goto(`${B}/a/${art.id}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(700)
await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(500)
const fr = pg.frameLocator('iframe').first(); const ifr = await pg.locator('iframe').boundingBox()
ok('default drag mode is "Moves freely"', (await pg.locator('.dm .seg button.on').innerText()) === 'Moves freely')

// 1. drop an image from the palette: it must land exactly under the pointer, free
const btn = await pg.locator('button.grab', { hasText: 'Image' }).boundingBox()
const drop = { x: ifr.x + 120, y: ifr.y + 380 }          // OUTSIDE the card (left margin area, below it)
await pg.mouse.move(btn.x + 20, btn.y + 10); await pg.mouse.down(); await pg.mouse.move(btn.x - 100, btn.y + 40, { steps: 5 }); await pg.mouse.move(drop.x, drop.y, { steps: 8 })
ok('a ghost box previews the drop', await fr.locator('[data-hub-overlay]').evaluateAll(els => els.some(e => e.style.borderStyle === 'dashed' && e.style.display === 'block')))
await pg.mouse.up(); await pg.waitForTimeout(500)
const img = fr.locator('img').first()
const ib = await img.boundingBox()
console.log('  dropped at', drop.x - ifr.x, drop.y - ifr.y, '-> image top-left at', Math.round(ib.x - ifr.x), Math.round(ib.y - ifr.y))
ok('image is positioned freely (absolute) at the release point', (await img.evaluate(e => getComputedStyle(e).position)) === 'absolute' && Math.abs(ib.x - drop.x) < 10 && Math.abs(ib.y - drop.y) < 10, [ib.x - drop.x, ib.y - drop.y])
ok('all 8 resize handles are shown (not just 3)', await fr.locator('[data-hub-handle]').evaluateAll(els => els.filter(e => e.style.display === 'block').length) === 8)

// 2. drag it again, no settings touched: unrestricted, in any direction, even over the card
const c = { x: ib.x + ib.width / 2, y: ib.y + ib.height / 2 }
await pg.mouse.move(c.x, c.y); await pg.mouse.down(); await pg.mouse.move(c.x + 300, c.y - 160, { steps: 8 }); await pg.mouse.move(c.x + 520, c.y - 330, { steps: 8 }); await pg.mouse.up(); await pg.waitForTimeout(300)
const ib2 = await img.boundingBox()
ok('dragged 520 right / 330 up with no restriction', Math.abs(ib2.x - ib.x - 520) < 8 && Math.abs(ib2.y - ib.y + 330) < 8, [ib2.x - ib.x, ib2.y - ib.y])
const container = await fr.locator('#card').boundingBox()
ok('it now sits over the card (not attached to a layout slot)', ib2.x > container.x && ib2.y < container.y + container.height)
await pg.mouse.move(ib2.x + 20, ib2.y + 20); await pg.mouse.down(); await pg.mouse.move(ib2.x - 400, ib2.y + 300, { steps: 10 }); await pg.mouse.up(); await pg.waitForTimeout(300)
const ib3 = await img.boundingBox()
ok('and back out again to the far left/bottom', ib3.x < ib2.x - 350 && ib3.y > ib2.y + 250, [ib3.x - ib2.x, ib3.y - ib2.y])

// 3. an EXISTING element (the button) drags freely too, without opening any menu
const bt = fr.locator('button').first(); const b0 = await bt.boundingBox()
await pg.mouse.move(b0.x + 20, b0.y + 10); await pg.mouse.down(); await pg.mouse.move(b0.x + 200, b0.y + 90, { steps: 8 }); await pg.mouse.up(); await pg.waitForTimeout(300)
const b1 = await bt.boundingBox()
ok('the existing button moved freely by ~200/90', Math.abs(b1.x - b0.x - 200) < 10 && Math.abs(b1.y - b0.y - 90) < 10, [b1.x - b0.x, b1.y - b0.y])

// 4. the switch: "Reorders" makes a drag reorder in the flow; Alt flips it back to free
await pg.locator('.dm .seg button', { hasText: 'Reorders' }).click()
const lastP = fr.locator('p').last(); const lp = await lastP.boundingBox(); const h1 = await fr.locator('h1').boundingBox()
await pg.mouse.move(lp.x + 20, lp.y + 8); await pg.mouse.down(); await pg.mouse.move(lp.x + 20, h1.y + 4, { steps: 10 }); await pg.mouse.up(); await pg.waitForTimeout(300)
ok('in "Reorders" mode the footer paragraph jumps above the heading', (await lastP.evaluate(e => getComputedStyle(e).position)) !== 'absolute' && (await lastP.boundingBox()).y < h1.y + 20, await lastP.evaluate(e => getComputedStyle(e).position))
await pg.locator('.dm .seg button', { hasText: 'Moves freely' }).click()

// 5. saved
await pg.waitForTimeout(2400)
console.log('status:', (await pg.locator('.status').innerText()).trim())
const saved = src(); const m = saved.match(/<img[^>]*>/)[0].replace(/src="[^"]{20,}"/, 'src="…"')
console.log('SAVED <img>:', m)
ok('saved file has the free position', /position: absolute; left: [\d.]+px; top: [\d.]+px/.test(m), m)
ok('the card became the positioning context', /id="card"[^>]*position: relative/.test(saved) || /position: relative[^"]*"[^>]*id="card"/.test(saved) || /position: relative/.test(saved))
await pg.screenshot({ path: 'un-1.png' })
console.log('errors:', logs.length ? logs : 'none'); await browser.close(); await api(`/api/artifacts/${art.id}`, null, 'DELETE')
