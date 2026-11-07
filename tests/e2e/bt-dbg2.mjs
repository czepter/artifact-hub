import { launch, B } from './bh.mjs'
const ID = process.argv[2]
const { browser, page: pg, logs } = await launch({ viewport: { width: 1500, height: 920 } })
await pg.goto(`${B}/a/${ID}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(900)
await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(500)
const stage = await pg.locator('.canvas').boundingBox()
console.log('world transform:', await pg.locator('.world').evaluate(e => e.style.transform))
// RECT: draw in an empty region; report what is under the pointer and any note text
await pg.locator('button[aria-label="Rectangle"]').click()
const x0 = stage.x + 560, y0 = stage.y + 560
console.log('element under rect start:', await pg.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.className || e.tagName) }, [x0, y0]))
await pg.mouse.move(x0, y0); await pg.mouse.down(); await pg.mouse.move(x0 + 40, y0 + 20, { steps: 4 }); await pg.mouse.move(x0 + 160, y0 + 90, { steps: 4 })
console.log('while dragging, preview .draw count:', await pg.locator('.draw').count())
await pg.mouse.up(); await pg.waitForTimeout(400)
console.log('shapes after:', await pg.locator('.note.shape').count(), '| tool pressed:', await pg.locator('.tb .tool.on').getAttribute('aria-label'), '| note text:', (await pg.locator('.note[role=status], .panel .note').allInnerTexts()))
await pg.screenshot({ path: 'dbg-rect.png' })
// BOARD RESIZE: select board 1, find the se handle geometry
await pg.locator('button[aria-label="Select"]').click()
const b = await pg.locator('[data-board]').first().boundingBox()
await pg.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await pg.waitForTimeout(300)
const hs = await pg.locator('.hd').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2), e.style.cursor] }))
console.log('handles:', JSON.stringify(hs))
console.log('board box:', JSON.stringify([b.x, b.y, b.x + b.width, b.y + b.height].map(Math.round)))
const se = hs[4]
await pg.mouse.move(se[0], se[1]); await pg.mouse.down(); await pg.mouse.move(se[0] + 20, se[1] + 15, { steps: 4 }); await pg.mouse.move(se[0] + 60, se[1] + 45, { steps: 4 })
const mid = await pg.locator('[data-board]').first().boundingBox()
console.log('during drag, board size delta:', Math.round(mid.width - b.width), Math.round(mid.height - b.height))
await pg.mouse.up(); await pg.waitForTimeout(400)
const after = await pg.locator('[data-board]').first().boundingBox()
console.log('after drop, size delta:', Math.round(after.width - b.width), Math.round(after.height - b.height))
console.log('errors:', logs)
await browser.close()
