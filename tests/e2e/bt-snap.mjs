// Phase 1: snapping and guides while moving and resizing; Alt switches it off; one gesture = one undo step.
import { open, ok, results, geom, center } from './cvh.mjs'
const t = await open()
const { pg, stage } = t
const g0 = geom(await t.canvas()), v0 = await t.version()
const box = (p) => pg.locator(`[data-board][data-path="${p}"]`).boundingBox()
const login0 = await box('screens/Login.html'), poll = await box('screens/Poll.html')
await pg.mouse.click(stage.x + 900, stage.y + 760)

// move Login 5px right: its left edge is 8 world px off Poll's left edge, so it snaps back and a guide shows
await pg.mouse.move(center(login0).x, center(login0).y); await pg.mouse.down()
await pg.mouse.move(center(login0).x + 3, center(login0).y, { steps: 2 }); await pg.mouse.move(center(login0).x + 5, center(login0).y, { steps: 2 })
const snapped = await box('screens/Login.html')
ok('the board snapped to the other board\'s left edge', Math.abs(snapped.x - login0.x) < 0.6, [snapped.x, login0.x])
ok('a guide line is shown while snapped', await pg.locator('.guide').count() >= 1, await pg.locator('.guide').count())
await pg.keyboard.down('Alt'); await pg.mouse.move(center(login0).x + 6, center(login0).y, { steps: 2 })
const free = await box('screens/Login.html')
ok('Alt disables snapping (the board follows the pointer)', free.x - login0.x > 5.5 && await pg.locator('.guide').count() === 0, [free.x - login0.x, await pg.locator('.guide').count()])
await pg.keyboard.up('Alt'); await pg.mouse.move(center(login0).x + 5, center(login0).y, { steps: 2 })
await pg.mouse.up(); await t.settle()
ok('the guide disappears on release', await pg.locator('.guide').count() === 0)
const c1 = await t.canvas()
ok('saved snapped: x equals Poll\'s x, one version', c1.boards['screens/Login.html'].x === 0 && await t.version() === v0 + 1, [c1.boards['screens/Login.html'].x, await t.version()])
await pg.keyboard.press('Control+z'); await t.settle(2500)
ok('undo restores', geom(await t.canvas()) === g0)

// resize: the east edge of Login snaps to Poll's east edge (860)
const v1 = await t.version()
await pg.mouse.click(center(login0).x, center(login0).y); await pg.waitForTimeout(200)
const k = login0.width / 560
const handle = center(await pg.locator('.hd').nth(3).boundingBox())   // 'e'
await pg.mouse.move(handle.x, handle.y); await pg.mouse.down()
await pg.mouse.move(handle.x + 100 * k, handle.y, { steps: 4 }); await pg.mouse.move(handle.x + (857 - 560) * k, handle.y, { steps: 4 })
ok('a guide shows while the edge is aligned', await pg.locator('.guide').count() >= 1)
await pg.mouse.up(); await t.settle()
const c2 = await t.canvas()
ok('the dragged edge snapped to 860 and it was one version', Math.abs(c2.boards['screens/Login.html'].w - 860) < 0.2 && await t.version() === v1 + 1, [c2.boards['screens/Login.html'].w, await t.version()])
await pg.keyboard.press('Control+z'); await t.settle(2500)
ok('...and one undo restores it', geom(await t.canvas()) === g0)
const clean = t.logs.filter(l => !/favicon|404/.test(l)); ok('no page errors', clean.length === 0, clean)
await t.browser.close(); process.exit(results.fails ? 1 : 0)
