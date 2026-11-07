import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
const exe = '/home/christian/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'
const B = 'http://localhost:3111', TOK = 'KfGugGd2CNfswiLU_dw5KgLr'
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } })
const page = await ctx.newPage()
const logs = []
page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 200)) })
page.on('pageerror', e => logs.push('pageerror: ' + e.message))
await page.goto(`${B}/s/${TOK}`)
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForTimeout(1500)
console.log('iframes:', await page.locator('iframe').count())
console.log('pins visible (before email -> comment cookie not set in this ctx):', await page.locator('.pin').count())
await page.screenshot({ path: 'canvas.png' })
// email gate
await page.fill('input[type=email]', 'tester@example.com'); await page.click('text=Continue'); await page.waitForTimeout(800)
// comment mode & click inside Settings board
await page.click('button:has-text("Comment")'); await page.waitForTimeout(500)
const frame = page.frameLocator('iframe').nth(1)
await frame.locator('li', { hasText: 'Billing' }).click()
await page.waitForSelector('textarea', { timeout: 5000 })
console.log('composer text:', (await page.locator('.draft .muted').innerText()).trim())
await page.fill('.draft textarea', 'Billing should come first'); await page.click('.draft button.primary'); await page.waitForTimeout(1500)
console.log('threads:', await page.locator('.thread').count(), ' pins:', await page.locator('.pin:not(.draft)').count())
await page.screenshot({ path: 'commented.png' })
console.log(logs.length ? logs.join('\n') : 'no console errors')
await browser.close()
