// Multi-resize: a board, a sticky, an arrow and a pen stroke scaled together by one corner handle.
import { open, ok, results, geom, drag, center } from './cvh.mjs'
import { api, B } from './bh.mjs'
const t = await open()
const { pg, stage, id } = t
const post = async (ops) => fetch(`${B}/api/artifacts/${id}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer devtoken' }, body: JSON.stringify({ baseVersion: await t.version(), ops }) })
// reduce the canvas to the four kinds of item
await post([{ type: 'removeBoard', path: 'screens/Settings.html' }, { type: 'deleteNote', id: 't1' }, { type: 'deleteNote', id: 'n1' },
  { type: 'updateBoard', path: 'screens/Poll.html', patch: { x: 0, y: 0, w: 400, h: 300 } }, { type: 'updateBoard', path: 'screens/Login.html', patch: { x: 0, y: 400, w: 300, h: 200 } },
  { type: 'addNote', id: 'st', note: { kind: 'sticky', x: 450, y: 0, w: 200, h: 100, text: 'hi' } },
  { type: 'addNote', id: 'ar', note: { kind: 'arrow', x: 450, y: 250, w: -100, h: 80 } },
  { type: 'addNote', id: 'pn', note: { kind: 'pen', x: 100, y: 350, points: [[0, 0], [60, 40], [120, 0]] } }])
await pg.reload(); await pg.waitForSelector('iframe'); await pg.waitForTimeout(900)
await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(600)
pg.on('dialog', d => d.accept())
const v0 = await t.version(), c0 = await t.canvas(), g0 = geom(c0)
await pg.mouse.click(stage.x + 1000, stage.y + 700); await pg.keyboard.press('Control+a'); await pg.waitForTimeout(200)
ok('all items selected with one box and 8 handles', await pg.locator('.hd').count() === 8, await pg.locator('.hd').count())
// corner handle (se = index 4), drag outwards
const se = center(await pg.locator('.hd').nth(4).boundingBox())
await drag(pg, se, { x: se.x + 120, y: se.y + 90 }, { mods: ['Shift'] })
await t.settle()
const v1 = await t.version(), c1 = await t.canvas()
ok('one gesture, one version', v1 === v0 + 1, [v0, v1])
const b0 = c0.boards['screens/Poll.html'], b1 = c1.boards['screens/Poll.html']
const f = b1.w / b0.w
ok('board scaled', f > 1.05 && Math.abs(b1.h / b0.h - f) < 0.01, [b0, b1])
ok('Shift kept the aspect ratio for every item (same factor)', Math.abs(c1.notes.st.w / c0.notes.st.w - f) < 0.02 && Math.abs(c1.notes.pn.points[2][0] / c0.notes.pn.points[2][0] - f) < 0.02 && Math.abs(c1.notes.pn.points[1][1] / c0.notes.pn.points[1][1] - f) < 0.03, [f, c1.notes])
ok('arrow keeps its direction (negative width) and scales', c1.notes.ar.w < 0 && Math.abs(c1.notes.ar.w / c0.notes.ar.w - f) < 0.02 && Math.abs(c1.notes.ar.h / c0.notes.ar.h - f) < 0.03, c1.notes.ar)
ok('sticky height stays automatic (not written)', c1.notes.st.h === c0.notes.st.h, c1.notes.st)
ok('pen points scaled, stroke width untouched', c1.notes.pn.points.length === 3 && c1.notes.pn.strokeWidth === undefined)
await pg.keyboard.press('Control+z'); await t.settle(2800)
ok('one undo restores board, sticky, arrow and pen', geom(await t.canvas()) === g0)
// shrink past the minimum: the whole selection stops together
await pg.mouse.click(stage.x + 1000, stage.y + 700); await pg.keyboard.press('Control+a')
const se2 = center(await pg.locator('.hd').nth(4).boundingBox())
await drag(pg, se2, { x: se2.x - 2000, y: se2.y - 2000 }); await t.settle()
const c2 = await t.canvas(), b2 = c2.boards['screens/Poll.html']
const l2 = c2.boards['screens/Login.html']
ok('clamped for the whole selection: the smallest board stops at 40, everything else keeps its relative layout', l2.w >= 39.9 && l2.h >= 39.9 && Math.abs(l2.w - 40) < 0.2 && Math.abs(b2.w / 400 - l2.w / 300) < 0.01 && c2.notes.st.w >= 8, [b2, l2, c2.notes.st])
const clean = t.logs.filter(l => !/favicon|404/.test(l)); ok('no page errors', clean.length === 0, clean)
await t.browser.close(); process.exit(results.fails ? 1 : 0)
