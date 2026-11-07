import { launch, api, B } from './bh.mjs'
const list = await api('/api/artifacts'); const src = list.find(a => a.title === 'Test canvas')
const id = (await api(`/api/artifacts/${src.id}/duplicate`, {}, 'POST')).id
const { browser, page: pg, logs } = await launch({ viewport: { width: 1500, height: 900 } })
pg.on('pageerror', e => console.log('PAGEERR', e.message))
pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.text().slice(0, 200)) })
await pg.goto(`${B}/a/${id}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(1200)
await pg.getByRole('button', { name: 'Edit' }).click(); await pg.waitForTimeout(1500)
await pg.screenshot({ path: 'sh-canvas.png' })
// board panel + expand
await pg.locator('ul[aria-label="Canvas layers"] .row.board').first().click(); await pg.waitForTimeout(400)
await pg.locator('ul[aria-label="Canvas layers"] ul.kids .row').first().click(); await pg.waitForTimeout(1800)
await pg.screenshot({ path: 'sh-element.png' })
await pg.getByRole('tab', { name: 'Code' }).click(); await pg.waitForTimeout(800)
await pg.screenshot({ path: 'sh-code.png' })
await browser.close()
