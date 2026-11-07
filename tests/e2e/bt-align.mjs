// Phase 1: align and distribute from the side panel (auto-height notes use their real height), right-click keeps a group,
// board-only duplicate keeps a selection, keys on non-US layouts, Space-pan with a drawing tool.
import { open, ok, results, geom, drag, center } from './cvh.mjs'
const t = await open()
const { pg, stage, id } = t
pg.on('dialog', d => d.accept())
const post = async (ops) => fetch(`${process.env.HUB}/api/artifacts/${id}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer devtoken' }, body: JSON.stringify({ baseVersion: await t.version(), ops }) })
await post([{ type: 'addNote', id: 'r1', note: { kind: 'rect', x: 1000, y: 700, w: 100, h: 60 } }, { type: 'addNote', id: 'r2', note: { kind: 'rect', x: 1300, y: 760, w: 100, h: 60 } }, { type: 'addNote', id: 'r3', note: { kind: 'rect', x: 1700, y: 740, w: 100, h: 60 } },
  { type: 'addNote', id: 'st', note: { kind: 'sticky', x: 1000, y: 900, w: 160, text: 'A long sticky note whose text wraps over many lines so that its real height is far above the default of one hundred and twenty pixels, which is what a stored note without height would be assumed to have.' } }])
await pg.reload(); await pg.waitForSelector('iframe'); await pg.waitForTimeout(1200); await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(600)
const view = () => pg.evaluate(() => ({ r: [...document.querySelectorAll('svg.note.shape')].map(e => e.getBoundingClientRect()).map(b => ({ x: b.x, y: b.y, w: b.width, h: b.height })) }))
const rects = async () => (await view()).r
// select the three rects with a marquee in their area
const r0 = await rects()
const minX = Math.min(...r0.map(r => r.x)), maxX = Math.max(...r0.map(r => r.x + r.width ?? r.w)), minY = Math.min(...r0.map(r => r.y))
await drag(pg, { x: minX - 15, y: minY - 15 }, { x: Math.max(...r0.map(r => r.x + r.w)) + 15, y: Math.max(...r0.map(r => r.y + r.h)) + 15 })
ok('three notes selected, the panel offers align and distribute', await pg.locator('text=/3 items/').first().isVisible() && await pg.locator('button[aria-label="Align top"]').isEnabled() && await pg.locator('button[aria-label="Distribute horizontally"]').isEnabled())
const v0 = await t.version(), g0 = geom(await t.canvas())
await pg.locator('button[aria-label="Align top"]').click(); await t.settle()
let c = await t.canvas()
ok('Align top: one version, all three share the top edge', await t.version() === v0 + 1 && new Set(['r1', 'r2', 'r3'].map(k => c.notes[k].y)).size === 1, ['r1', 'r2', 'r3'].map(k => c.notes[k].y))
await pg.locator('button[aria-label="Distribute horizontally"]').click(); await t.settle()
c = await t.canvas()
const gap1 = c.notes.r2.x - (c.notes.r1.x + 100), gap2 = c.notes.r3.x - (c.notes.r2.x + 100)
ok('Distribute horizontally: equal gaps between the three', Math.abs(gap1 - gap2) < 0.3 && gap1 > 100, [gap1, gap2])
await pg.mouse.click(stage.x + 15, stage.y + 300) // the side panel keeps its own keys, so give the canvas the focus back
await pg.keyboard.press('Control+z'); await t.settle(2500); await pg.keyboard.press('Control+z'); await t.settle(2500)
{ const g1 = geom(await t.canvas()); ok('two undos restore the original layout', g1 === g0, [JSON.parse(g0).n, JSON.parse(g1).n]) }
// align bottom with a tall auto-height sticky: the real bottoms match on screen
const stickyBefore = await pg.locator('.note.sticky[data-id="st"]').boundingBox()
ok('the sticky is taller than the 120px default', stickyBefore.height / (stickyBefore.width / 160) > 150, stickyBefore)
const rr = await rects()
await drag(pg, { x: Math.min(...rr.map(r => r.x), stickyBefore.x) - 15, y: Math.min(...rr.map(r => r.y), stickyBefore.y) - 15 }, { x: Math.max(...rr.map(r => r.x + r.w), stickyBefore.x + stickyBefore.width) + 15, y: Math.max(...rr.map(r => r.y + r.h), stickyBefore.y + stickyBefore.height) + 15 })
await pg.locator('button[aria-label="Align bottom"]').click(); await t.settle()
const st = await pg.locator('.note.sticky[data-id="st"]').boundingBox(), shapes = await rects()
ok('Align bottom puts the real bottom of the auto-height sticky on the same line as the rectangles', shapes.every(s => Math.abs((st.y + st.height) - (s.y + s.h)) < 1.5), [st.y + st.height, shapes.map(s => s.y + s.h)])
await pg.keyboard.press('Control+z'); await t.settle(2500)

// right-click inside a group keeps it, so the menu acts on all of it
await pg.mouse.click(stage.x + 15, stage.y + 300); await pg.keyboard.press('Control+a')
const login = await pg.locator('[data-board][data-path="screens/Login.html"]').boundingBox()
await pg.mouse.click(center(login).x, center(login).y, { button: 'right' }); await pg.waitForTimeout(200)
ok('right-click on a member keeps the multi-selection', await pg.locator('text=/\\d+ items/').first().isVisible())
await pg.keyboard.press('Escape'); await pg.waitForTimeout(400) // the menu closes

// board-only duplicate keeps the copy selected, and can be repeated
await pg.keyboard.press('Escape'); await pg.mouse.click(center(login).x, center(login).y); await pg.waitForTimeout(200); await pg.keyboard.press('Control+d'); await t.settle()
ok('after duplicating a board the copy is selected', await pg.locator('.board.selected').count() === 1 && Object.keys((await t.canvas()).boards).length === 4, [await pg.locator('.board.selected').count(), Object.keys((await t.canvas()).boards).length, await pg.locator('[data-board]').count()])
await pg.keyboard.press('Control+d'); await t.settle()
ok('...so duplicating again works', Object.keys((await t.canvas()).boards).length === 5, Object.keys((await t.canvas()).boards))

// non-US layouts: the + key is BracketRight on a German keyboard; it must still zoom, not reorder
await pg.mouse.click(stage.x + 15, stage.y + 300)
const pct = async () => (await pg.locator('.zoom .pct').innerText()).trim()
const p0 = await pct()
await pg.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', code: 'BracketRight', bubbles: true, cancelable: true })))
await pg.waitForTimeout(300)
ok('the + key (code BracketRight on QWERTZ) still zooms in', parseInt(await pct()) > parseInt(p0), [p0, await pct()])
ok('...and Ctrl++ is left to the browser', await pg.evaluate(() => { const e = new KeyboardEvent('keydown', { key: '+', code: 'BracketRight', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented }) === false)

// Space pans even with a drawing tool picked
const v1 = await t.version(), n1 = Object.keys((await t.canvas()).notes).length
await pg.keyboard.press('r')
const poll = await pg.locator('[data-board][data-path="screens/Poll.html"]').boundingBox()
await pg.keyboard.down('Space'); await drag(pg, { x: center(poll).x, y: poll.y + 200 }, { x: center(poll).x + 60, y: poll.y + 220 }); await pg.keyboard.up('Space')
const poll2 = await pg.locator('[data-board][data-path="screens/Poll.html"]').boundingBox()
await t.settle(1800)
ok('Space + drag pans with the Rectangle tool instead of drawing', Math.abs(poll2.x - poll.x - 60) < 2 && Object.keys((await t.canvas()).notes).length === n1, [poll2.x - poll.x])
const clean = t.logs.filter(l => !/favicon|404/.test(l)); ok('no page errors', clean.length === 0, clean)
await t.browser.close(); process.exit(results.fails ? 1 : 0)
