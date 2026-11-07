import { launch, B } from './bh.mjs'
const { browser, page: pg } = await launch({ viewport: { width: 1500, height: 900 } })
await pg.goto(`${B}/a/389e7acf-2575-492b-85cf-ae66e51a0c8d`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(3000)
await pg.locator('[aria-label="Open full window"]').nth(2).click({ force: true }); await pg.waitForTimeout(2500)
await pg.screenshot({ path: 'focus-1.png' })
await browser.close()
