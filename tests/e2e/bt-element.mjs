import { launch, api, B } from './bh.mjs'
import { execSync } from 'node:child_process'
const ok = (n, c, x = '') => console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 200))
const page = `<!doctype html><html><head><meta charset="utf-8"><title>El</title></head><body style="margin:0;font-family:system-ui;background:#f4f4f5"><div id="card" style="max-width:520px;margin:40px auto;background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:28px"><h1 style="margin:0 0 12px;color:#777">Zugriff erlauben?</h1><p style="margin:0 0 16px">Dieser Client darf Tools aufrufen.</p><button style="padding:10px 16px;border:0;border-radius:8px;background:#3730a3;color:#fff">Zugriff erlauben</button></div></body></html>`
const art = await api('/api/artifacts', { title: 'Element test', files: [{ path: 'index.html', content: page }] })
const { browser, page: pg, logs } = await launch({ viewport: { width: 1440, height: 900 } })
const src = () => { execSync(`curl -s -H "authorization: Bearer ${process.env.T}" ${B}/api/artifacts/${art.id}/export -o /tmp/el.zip`); return execSync(`python3 -c "import zipfile;print(zipfile.ZipFile('/tmp/el.zip').read('index.html').decode())"`).toString() }
await pg.goto(`${B}/a/${art.id}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(700)
await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(500)
const fr = pg.frameLocator('iframe').first()

// layer tree: lists the page, clicking a layer selects it
const rows = await pg.locator('.tree .row').allInnerTexts()
ok('layer tree lists body > div > h1/p/button', rows.length >= 5 && rows.some(r => r.includes('Zugriff erlauben?')), rows)
await pg.locator('.tree .row', { hasText: 'Dieser Client' }).click(); await pg.waitForTimeout(300)
ok('clicking a layer selects it (panel shows <p>)', (await pg.locator('.panel h3', { hasText: '<p>' }).count()) === 1)
ok('selection box drawn on that element in the board', await fr.locator('[data-hub-overlay]').count() > 3)

// text + contrast: the heading is low contrast grey on white
await fr.locator('h1').click(); await pg.waitForTimeout(300)
const contrast = await pg.locator('.contrast').innerText()
ok('contrast badge reports the low-contrast heading', /Low contrast|large text/i.test(contrast), contrast)
await pg.locator('.panel label:has(span:text-is("Colour")) input.field').first().fill('#111111'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(400)
ok('fixing the colour turns the badge green', (await pg.locator('.contrast.good').count()) === 1, await pg.locator('.contrast').innerText())

// size modes: Fill sets width:100%
await fr.locator('button').first().click(); await pg.waitForTimeout(300)
await pg.locator('select[aria-label="Width mode"]').selectOption('fill'); await pg.waitForTimeout(400)
const w = await fr.locator('button').first().evaluate(e => ({ inline: e.style.width, px: e.getBoundingClientRect().width }))
ok('Width: Fill makes the button span its container', w.inline === '100%' && w.px > 400, w)

// Alt-drag pulls an element out of the flow
const p = fr.locator('p').first(); const pb0 = await p.boundingBox()
await pg.keyboard.down('Alt')
await pg.mouse.move(pb0.x + 30, pb0.y + 8); await pg.mouse.down(); await pg.mouse.move(pb0.x + 90, pb0.y + 40, { steps: 5 }); await pg.mouse.move(pb0.x + 150, pb0.y + 80, { steps: 5 }); await pg.mouse.up()
await pg.keyboard.up('Alt'); await pg.waitForTimeout(300)
const pos = await p.evaluate(e => getComputedStyle(e).position)
const pb1 = await p.boundingBox()
ok('Alt+drag turned the paragraph into a free element and moved it', pos === 'absolute' && Math.abs(pb1.x - pb0.x - 120) < 12, [pos, pb1.x - pb0.x, pb1.y - pb0.y])

// arrow-key nudge (Shift = 10px)
const nb0 = await p.boundingBox()
await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('Shift+ArrowDown'); await pg.waitForTimeout(250)
const nb1 = await p.boundingBox()
ok('arrow keys nudge a free element (2px right, 10px down)', Math.round(nb1.x - nb0.x) === 2 && Math.round(nb1.y - nb0.y) === 10, [nb1.x - nb0.x, nb1.y - nb0.y])

// align: centre horizontally within its parent
await pg.locator('.aligns button[title="Centre horizontally"]').click(); await pg.waitForTimeout(300)
const card = await fr.locator('#card').boundingBox(); const pc = await p.boundingBox()
ok('Centre horizontally centres a free element in its container', Math.abs((pc.x + pc.width / 2) - (card.x + card.width / 2)) < 3, [pc.x + pc.width / 2, card.x + card.width / 2])

// back to flow
await pg.locator('.seg[aria-label="Position"] button', { hasText: 'Flow' }).click(); await pg.waitForTimeout(300)
ok('Flow puts it back in the page flow', (await p.evaluate(e => getComputedStyle(e).position)) === 'static')

// save + undo
await pg.waitForTimeout(2200)
ok('saved', (await pg.locator('.status').innerText()).includes('Saved'))
const saved = src()
ok('saved source has the colour fix and width:100%', /color: #111111/.test(saved) && /width: 100%/.test(saved), saved.slice(0, 200))
await pg.locator('button:has-text("Undo")').first().click(); await pg.waitForTimeout(1500)
const afterUndo = src()
ok('Undo reverted the last saved batch', afterUndo !== saved, afterUndo.length)
await pg.screenshot({ path: 'el-1.png' })
console.log('errors:', logs.length ? logs : 'none'); await browser.close(); await api(`/api/artifacts/${art.id}`, null, 'DELETE')
