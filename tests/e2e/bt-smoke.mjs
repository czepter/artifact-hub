import { launch, api, B, TOKEN } from './bh.mjs'
import { chromium } from 'playwright-core'
const ok = (n, c, x = '') => console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 200))
const list = await api('/api/artifacts'); const src = list.find(a => a.title === 'Test canvas')
const dup = await api(`/api/artifacts/${src.id}/duplicate`, {}, 'POST'); const ID = dup.id
const share = await api(`/api/artifacts/${ID}/shares`, { role: 'comment' }, 'POST')
const { browser, page: pg, logs, ctx } = await launch({ viewport: { width: 1440, height: 900 } })
await pg.goto(`${B}/a/${ID}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(1200)

// comments still work (comment mode -> click in a board -> popover on the marker)
await pg.click('button:has-text("Comment")'); await pg.waitForTimeout(300)
await pg.frameLocator('iframe').first().locator('h1').first().click(); await pg.waitForTimeout(500)
ok('comment composer opens as a popover at the marker', await pg.locator('.popover textarea').count() === 1)
await pg.locator('.popover textarea').fill('Make the headline bigger'); await pg.locator('.popover button:has-text("Comment")').click(); await pg.waitForTimeout(800)
ok('comment saved and a numbered pin appears', await pg.locator('.pin:not(.draft)').count() === 1)
await pg.click('button:has-text("Done commenting")')

// present from the top-right pill and from the header
await pg.locator('.zoom .playall').click(); await pg.waitForTimeout(700)
ok('Present (top-right) fills the window and hides the chrome', await pg.locator('.focusbar').isVisible() && !(await pg.locator('header.bar').isVisible()))
await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(500)
ok('arrow key steps to the next board', (await pg.locator('.focusbar .count').innerText()).startsWith('2 /'), await pg.locator('.focusbar .count').innerText())
await pg.keyboard.press('Escape'); await pg.waitForTimeout(500)
ok('Esc leaves presenting', await pg.locator('header.bar').isVisible())

// a share-link viewer gets no editing UI and no canvas tools, and cannot save edits
const viewer = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const vp = await viewer.newPage()
await vp.goto(share.url.replace(/^https?:\/\/[^/]+/, B)); await vp.waitForSelector('iframe'); await vp.waitForTimeout(1200)
ok('share viewer: no Edit button, no Share menu', await vp.locator('button:has-text("Edit")').count() === 0 && await vp.locator('button:has-text("Share")').count() === 0)
ok('share viewer: boards are not draggable (no tool palette)', await vp.locator('[role=toolbar]').count() === 0)
const r = await vp.evaluate(async (id) => (await fetch(`/api/artifacts/${id}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseVersion: 2, ops: [{ type: 'addNote', id: 'x', note: { kind: 'sticky' } }] }) })).status, ID)
ok('share viewer cannot call the canvas API (401)', r === 401, r)
const r2 = await vp.evaluate(async (id) => (await fetch(`/api/artifacts/${id}/source?path=index.html`)).status, ID); ok('share viewer cannot read source (401)', r2 === 401, r2)
console.log('errors:', logs.length ? logs : 'none'); await browser.close(); await api(`/api/artifacts/${ID}`, null, 'DELETE')
