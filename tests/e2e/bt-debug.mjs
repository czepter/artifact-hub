import { launch, B } from './bh.mjs'
const ID = process.argv[2]
const { browser, page: pg, logs } = await launch()
const msgs = []
await pg.exposeFunction('__log', (m) => msgs.push(m))
await pg.addInitScript(() => window.addEventListener('message', e => { if (e.data && typeof e.data.type === 'string' && e.data.type.startsWith('hub:edit')) window.__log(JSON.stringify({ t: e.data.type, op: e.data.op, text: e.data.text, sel: e.data.info && { id: e.data.info.id, tag: e.data.info.tag, free: e.data.info.free, pos: e.data.info.position } })) }))
await pg.goto(`${B}/a/${ID}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(600)
await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(400)
const frame = pg.frameLocator('iframe').first()
await frame.locator('img').first().click(); await pg.waitForTimeout(300)
console.log('panel Position buttons:', await pg.locator('.seg[aria-label="Position"] button').allInnerTexts())
msgs.length = 0
await pg.locator('.seg[aria-label="Position"] button', { hasText: 'Free' }).click(); await pg.waitForTimeout(500)
console.log('messages after clicking Free:\n ', msgs.join('\n  '))
const st = await frame.locator('img').first().evaluate(e => ({ pos: getComputedStyle(e).position, inline: e.getAttribute('style') }))
console.log('img now:', JSON.stringify(st))
console.log('errors:', logs)
await browser.close()
