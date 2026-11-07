// Phase 0: selection set, group move/resize through one code path, one gesture = one undo step, key handling.
import { open, ok, results, geom, drag, center } from './cvh.mjs'
const t = await open()
const { pg, stage } = t
pg.on('dialog', d => d.accept())
const v0 = await t.version(), c0 = await t.canvas(), g0 = geom(c0)

// shortcuts are the canvas's only after the canvas was clicked; before that the browser keeps Ctrl+A
const early = await pg.evaluate(() => { const e = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, cancelable: true, bubbles: true }); window.dispatchEvent(e); return e.defaultPrevented })
ok('Ctrl+A is not hijacked before the canvas was clicked', early === false)
await pg.mouse.click(stage.x + 900, stage.y + 720)   // empty canvas
const unknown = await pg.evaluate(() => { const e = new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', ctrlKey: true, cancelable: true, bubbles: true }); window.dispatchEvent(e); return e.defaultPrevented })
ok('unregistered Ctrl combos (Ctrl+D) stay the browser\'s even on the canvas', unknown === false)
await pg.keyboard.press('Control+a'); await pg.waitForTimeout(200)
const nHandles = await pg.locator('.hd').count()
ok('Ctrl+A selects everything: one box with 8 handles', nHandles === 8 && await pg.locator('.selbox').count() === 1, nHandles)
ok('panel says how many items are selected', await pg.locator('text=/\\d+ items/').first().isVisible(), '')

// group resize: drag the se handle -> one batch -> one version
const se = await pg.locator('.hd').nth(6).boundingBox()   // sw handle: bottom-left stays clear of the side panel
await drag(pg, center(se), { x: center(se).x + 60, y: center(se).y - 40 })
await t.settle()
const v1 = await t.version(), c1 = await t.canvas()
ok('group resize is one save (one version)', v1 === v0 + 1, [v0, v1])
ok('all boards changed size', Object.keys(c1.boards).every(k => c1.boards[k].w !== c0.boards[k].w), c1.boards)
ok('relative layout kept: board 2 x/width scale by the same factor as board 1', (() => { const f = c1.boards['screens/Poll.html'].w / c0.boards['screens/Poll.html'].w; return Math.abs(c1.boards['screens/Settings.html'].w / c0.boards['screens/Settings.html'].w - f) < 0.01 })(), c1.boards)
await pg.keyboard.press('Control+z'); await t.settle(2500)
ok('one undo step restores every item', geom(await t.canvas()) === g0, '')

// group move + nudging a held arrow key = one version
const v2 = await t.version()
await pg.mouse.click(stage.x + 900, stage.y + 720); await pg.keyboard.press('Control+a')
for (let i = 0; i < 40; i++) { await pg.keyboard.down('ArrowRight'); await pg.keyboard.up('ArrowRight'); await pg.waitForTimeout(15) }
await t.settle()
const v3 = await t.version(), c3 = await t.canvas()
ok('holding an arrow key moved everything in a single version', v3 === v2 + 1 && c3.boards['screens/Poll.html'].x === c0.boards['screens/Poll.html'].x + 40 && c3.notes.n1.x === c0.notes.n1.x + 40, [v2, v3, c3.boards['screens/Poll.html'].x])
await pg.keyboard.press('Control+z'); await t.settle(2500)
ok('...and one undo restores it', geom(await t.canvas()) === g0)

// Delete with several selected: one confirm, one version, undo brings back boards and their files
const v4 = await t.version()
await pg.mouse.click(stage.x + 900, stage.y + 720); await pg.keyboard.press('Control+a'); await pg.keyboard.press('Delete')
await t.settle()
const c5 = await t.canvas(), v5 = await t.version()
ok('Delete removes the whole selection in one version', v5 === v4 + 1 && Object.keys(c5.boards).length === 0 && Object.keys(c5.notes).length === 0, [v4, v5])
await pg.keyboard.press('Control+z'); await t.settle(3200)
const c6 = await t.canvas(), view6 = await t.view()
ok('undo of a multi-delete loses nothing (entries and board files)', geom(c6) === g0 && ['screens/Poll.html', 'screens/Settings.html', 'screens/Login.html'].every(p => view6.files.some(f => f.path === p)), [Object.keys(c6.boards), view6.files.map(f => f.path)])

// Escape clears the selection
await pg.mouse.click(stage.x + 900, stage.y + 720); await pg.keyboard.press('Control+a'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(200)
ok('Escape clears the selection', await pg.locator('.selbox').count() === 0)
const clean = t.logs.filter(l => !/favicon|404/.test(l))
ok('no page errors', clean.length === 0, clean)
console.log('artifact', t.id)
await t.browser.close(); process.exit(results.fails ? 1 : 0)
