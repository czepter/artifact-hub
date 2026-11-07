import { launch, B } from './bh.mjs'
const { browser, page: pg } = await launch({ viewport: { width: 1600, height: 950 } })
const errs=[]; pg.on('pageerror', e => errs.push(e.message))
await pg.goto(`${B}/a/389e7acf-2575-492b-85cf-ae66e51a0c8d`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(5000)
console.log('boards', await pg.locator('[data-board]').count(), 'errs', errs.slice(0,3))
await pg.screenshot({ path: 'imp-1.png' })
await browser.close()
