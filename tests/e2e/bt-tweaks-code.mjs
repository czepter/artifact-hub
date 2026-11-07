import { launch, api, B } from './bh.mjs'
import { execSync } from 'node:child_process'
const ok = (n, c, x = '') => console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 220))
const list = await api('/api/artifacts'); const src = list.find(a => a.title.startsWith('mcpwarden UI'))
const dup = await api(`/api/artifacts/${src.id}/duplicate`, {}, 'POST'); const ID = dup.id
const file = (name) => { execSync(`curl -s -H "authorization: Bearer ${process.env.T}" ${B}/api/artifacts/${ID}/export -o /tmp/tw.zip`); return execSync(`python3 -c "import zipfile;print(zipfile.ZipFile('/tmp/tw.zip').read('${name}').decode())"`).toString() }
const { browser, page: pg, logs } = await launch({ viewport: { width: 1500, height: 920 } })
await pg.goto(`${B}/a/${ID}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(1500)
const consent = pg.locator('iframe').first()
const iconBg = () => pg.frameLocator('iframe').first().locator('div[aria-hidden="true"]').first().evaluate(e => getComputedStyle(e).backgroundColor)
ok('DC board renders with the default accent (#3730a3)', (await iconBg()) === 'rgb(55, 48, 163)', await iconBg())

// ---- Tweaks
await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(600)
await pg.locator('.board-title').first().locator('button[aria-label="Tweaks"]').click(); await pg.waitForTimeout(500)
ok('Tweaks icon in the board header opens the Tweaks tab', (await pg.locator('.tabs button.on').innerText()) === 'Tweaks')
ok('the board\'s declared tweak (accent) is listed', await pg.locator('.tw .ctl .name', { hasText: 'accent' }).count() === 1)
await pg.locator('.tw .colour input.field').fill('#0f766e'); await pg.keyboard.press('Tab'); await pg.waitForTimeout(500)
ok('changing the tweak re-renders the board live (accent -> #0f766e)', (await iconBg()) === 'rgb(15, 118, 110)', await iconBg())
ok('the swatch row works', await pg.locator('.swatches .sw-c').count() >= 3)
await pg.locator('.swatches .sw-c').nth(3).click(); await pg.waitForTimeout(400)
ok('clicking a swatch applies it (#b91c1c)', (await iconBg()) === 'rgb(185, 28, 28)', await iconBg())
await pg.waitForTimeout(2400)
const cv = JSON.parse(file('canvas.json'))
ok('tweak value saved in canvas.json under the board', cv.boards['Consent.dc.html'].tweaks?.accent === '#b91c1c', cv.boards['Consent.dc.html'])
await pg.screenshot({ path: 'tw-1.png' })
await pg.locator('button:has-text("Done")').first().click(); await pg.waitForTimeout(800)
await pg.reload(); await pg.waitForSelector('iframe'); await pg.waitForTimeout(1500)
ok('after a reload the board renders with the saved tweak, no editor needed', (await iconBg()) === 'rgb(185, 28, 28)', await iconBg())

// ---- Play + focus
await pg.locator('.board-title .play').first().click(); await pg.waitForTimeout(600)
ok('PLAY opens the board filling the canvas', await pg.locator('.focusbar').isVisible())
await pg.keyboard.press('Escape'); await pg.waitForTimeout(400)
ok('Esc leaves play', await pg.locator('.focusbar').count() === 0)

// ---- Code tab
await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(500)
await pg.locator('[data-board]').first().locator('.board-shield').dblclick(); await pg.waitForTimeout(900)
ok('double-click on a board enters element editing', await pg.locator('.focusbar').isVisible() && await pg.locator('.tree').count() === 1)
await pg.frameLocator('iframe').first().locator('h1').click(); await pg.waitForTimeout(400)
await pg.locator('.tabs button', { hasText: 'Code' }).click(); await pg.waitForTimeout(700)
const code = await pg.locator('textarea.src').inputValue()
ok('Code tab shows the selected element\'s source', code.startsWith('<h1') && code.includes('Zugriff erlauben?'), code.slice(0, 80))
await pg.locator('textarea.src').fill(code.replace('Zugriff erlauben?', 'Zugriff gewähren?'))
await pg.locator('.code button:has-text("Apply")').click(); await pg.waitForTimeout(3000)
ok('Apply saved the edit and reloaded the board', (await pg.frameLocator('iframe').first().locator('h1').innerText()) === 'Zugriff gewähren?', await pg.frameLocator('iframe').first().locator('h1').innerText())
ok('the stored source changed', file('Consent.dc.html').includes('Zugriff gewähren?'))
ok('template holes survived the code edit', file('Consent.dc.html').includes('{{s.title}}'))
// file mode: edit canvas.json is validated
await pg.locator('.code .seg button', { hasText: 'File' }).click(); await pg.waitForTimeout(500)
await pg.locator('.code select').selectOption('canvas.json'); await pg.waitForTimeout(600)
await pg.locator('textarea.src').fill('{ not json'); await pg.locator('.code button:has-text("Apply")').click(); await pg.waitForTimeout(800)
ok('invalid JSON in canvas.json is refused with a message', /valid JSON/i.test(await pg.locator('.code .err').innerText()), await pg.locator('.code .err').count())
await pg.screenshot({ path: 'tw-2.png' })
console.log('errors:', logs.length ? logs : 'none'); await browser.close(); await api(`/api/artifacts/${ID}`, null, 'DELETE')
