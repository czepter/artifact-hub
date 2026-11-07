// Phase 1: shift-click, marquee (also from a board with Shift), group move, click narrows, locked items skipped by marquee.
import { open, ok, results, geom, drag, center } from './cvh.mjs'
const t = await open()
const { pg, stage, id } = t
pg.on('dialog', d => d.accept())
const g0 = geom(await t.canvas()), v0 = await t.version()
const box = (p) => pg.locator(`[data-board][data-path="${p}"]`).boundingBox()
const sel = () => pg.locator('.board.selected').evaluateAll(els => els.map(e => e.dataset.path).sort())
const poll = await box('screens/Poll.html'), login = await box('screens/Login.html'), settings = await box('screens/Settings.html')

await pg.mouse.click(center(poll).x, poll.y + 200)
ok('click selects one board', (await sel()).join() === 'screens/Poll.html', await sel())
await pg.keyboard.down('Shift'); await pg.mouse.click(center(login).x, center(login).y); await pg.keyboard.up('Shift')
ok('shift-click adds a board', (await sel()).length === 2 && await pg.locator('text=/2 items/').first().isVisible(), await sel())
await pg.keyboard.down('Shift'); await pg.mouse.click(center(login).x, center(login).y); await pg.keyboard.up('Shift')
ok('shift-click again removes it', (await sel()).join() === 'screens/Poll.html', await sel())

// marquee on empty canvas around Login only
await pg.mouse.click(stage.x + 900, stage.y + 760)
await drag(pg, { x: login.x + login.width + 40, y: login.y + login.height - 20 }, { x: login.x - 20, y: login.y + 20 })
ok('marquee on empty canvas selects what it touches', (await sel()).join() === 'screens/Login.html', await sel())
ok('the marquee rectangle is gone after release', await pg.locator('.marquee').count() === 0)
// shift + drag from a board's shield: additive marquee, never starts a move or reaches the iframe
await pg.keyboard.down('Shift')
await drag(pg, { x: center(settings).x, y: settings.y + 300 }, { x: center(poll).x, y: poll.y + 300 })
await pg.keyboard.up('Shift')
ok('shift-drag from a board adds everything it touches', (await sel()).length === 3, await sel())
ok('nothing moved and nothing was saved', await t.version() === v0 && geom(await t.canvas()) === g0)

// group move: drag one selected board, all selected move together, one version
await drag(pg, { x: center(login).x, y: center(login).y }, { x: center(login).x + 60, y: center(login).y + 40 })
await t.settle()
const c1 = await t.canvas(), c0 = JSON.parse(g0)
ok('group move: all three boards moved by the same amount in one version', await t.version() === v0 + 1 && ['screens/Poll.html', 'screens/Settings.html', 'screens/Login.html'].every(p => c1.boards[p].x - c0.b[p][0] > 50 && Math.abs((c1.boards[p].x - c0.b[p][0]) - (c1.boards['screens/Login.html'].x - c0.b['screens/Login.html'][0])) < 0.2), c1.boards)
await pg.keyboard.press('Control+z'); await t.settle(2500)
ok('one undo moves them all back', geom(await t.canvas()) === g0)

// a plain click on one of several narrows the selection
await pg.mouse.click(stage.x + 900, stage.y + 760); await pg.keyboard.press('Control+a')
await pg.mouse.click(center(login).x, center(login).y)
ok('clicking one of several selects just that one', (await sel()).join() === 'screens/Login.html', await sel())

// locked items are skipped by marquee (set through the API, as there is no lock UI yet)
await pg.keyboard.press('Escape')
const post = (ops) => fetch(`${process.env.HUB}/api/artifacts/${id}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer devtoken' }, body: JSON.stringify({ baseVersion: 0, ops }) })
const vNow = await t.version()
await fetch(`${process.env.HUB}/api/artifacts/${id}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer devtoken' }, body: JSON.stringify({ baseVersion: vNow, ops: [{ type: 'updateBoard', path: 'screens/Login.html', patch: { locked: true } }] }) })
await pg.reload(); await pg.waitForSelector('iframe'); await pg.waitForTimeout(900); await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(600)
const l2 = await box('screens/Login.html')
await drag(pg, { x: l2.x + l2.width + 40, y: l2.y + l2.height - 20 }, { x: l2.x - 20, y: l2.y + 20 })
ok('marquee skips a locked board', (await sel()).length === 0, await sel())
await pg.keyboard.down('Shift'); await pg.mouse.click(center(l2).x, center(l2).y); await pg.keyboard.up('Shift')
ok('...but shift-click can still select it', (await sel()).join() === 'screens/Login.html', await sel())
const vL = await t.version()
await pg.keyboard.press('Control+a'); await pg.keyboard.press('ArrowRight'); await t.settle()
const c2 = await t.canvas()
ok('a locked board does not move with the group', c2.boards['screens/Login.html'].x === 0 && c2.boards['screens/Poll.html'].x === 1 && await t.version() === vL + 1, [c2.boards['screens/Login.html'].x, c2.boards['screens/Poll.html'].x])
const clean = t.logs.filter(l => !/favicon|404/.test(l)); ok('no page errors', clean.length === 0, clean)
await t.browser.close(); process.exit(results.fails ? 1 : 0)
