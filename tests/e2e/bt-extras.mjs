// Phase 3: pen smoothing, hatch fill, minimap, command palette, laser pointer.
import { open, ok, results, geom, drag, center } from './cvh.mjs'
const t = await open()
const { pg, stage, id } = t
const post = async (ops) => fetch(`${process.env.HUB}/api/artifacts/${id}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer devtoken' }, body: JSON.stringify({ baseVersion: await t.version(), ops }) })
await post([{ type: 'addNote', id: 'rr', note: { kind: 'rect', x: 700, y: 800, w: 200, h: 120, fill: 'yellow' } }])
await pg.reload(); await pg.waitForSelector('iframe'); await pg.waitForTimeout(1200); await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(600)
const empty = { x: stage.x + 15, y: stage.y + 300 }
await pg.mouse.click(empty.x, empty.y)

// --- pen: a long jittery stroke is simplified, drawn smooth
await pg.keyboard.press('p')
const x0 = stage.x + 700, y0 = stage.y + 120
await pg.mouse.move(x0, y0); await pg.mouse.down()
for (let i = 1; i <= 400; i++) await pg.mouse.move(x0 + i * 0.9, y0 + Math.sin(i / 25) * 40 + (i % 2) * 0.8)
await pg.mouse.up(); await t.settle()
let c = await t.canvas()
const pen = Object.entries(c.notes).find(([, n]) => n.kind === 'pen')
ok('the pen stroke is stored with far fewer points than were sampled, within 400', pen && pen[1].points.length >= 10 && pen[1].points.length < 120, pen && pen[1].points.length)
ok('it is drawn as a smooth curve', (await pg.locator(`svg.note.vec[data-id="${pen[0]}"] path`).first().getAttribute('d')).includes('C'))
ok('the shape is kept: the stroke still spans the drawn width', (() => { const xs = pen[1].points.map(p => p[0]); return Math.max(...xs) - Math.min(...xs) > 300 })())

await pg.keyboard.press('v')
// --- hatch fill from the style panel
await pg.mouse.click(center(await pg.locator('svg.note.shape[data-id="rr"]').boundingBox()).x, center(await pg.locator('svg.note.shape[data-id="rr"]').boundingBox()).y)
await pg.locator('[aria-label="Hatch fill"]').click(); await t.settle()
ok('Hatch is stored on the shape', (await t.canvas()).notes.rr.fillStyle === 'hatch')
ok('the fill is an svg pattern', await pg.locator('svg.note.shape[data-id="rr"] pattern').count() === 1 && (await pg.locator('svg.note.shape[data-id="rr"] rect').first().getAttribute('fill')).startsWith('url(#hatch-'))
await pg.locator('[aria-label="Cross-hatch fill"]').click(); await t.settle()
ok('Cross-hatch adds the second set of lines', await pg.locator('svg.note.shape[data-id="rr"] pattern line').count() === 2)
await pg.locator('[aria-label="Solid fill"]').click(); await t.settle()
ok('Solid goes back to a plain fill', await pg.locator('svg.note.shape[data-id="rr"] pattern').count() === 0)

// --- minimap: hidden when everything is in view, shown when zoomed in, click to jump
await pg.mouse.click(empty.x, empty.y); await pg.keyboard.press('Shift+Digit1'); await pg.waitForTimeout(500)
ok('no minimap while everything is in view', await pg.locator('[data-minimap]').count() === 0)
await pg.keyboard.press('+'); await pg.keyboard.press('+'); await pg.keyboard.press('+'); await pg.waitForTimeout(500)
ok('the minimap appears once the content reaches outside the window', await pg.locator('[data-minimap]').count() === 1)
const poll0 = await pg.locator('[data-board][data-path="screens/Poll.html"]').boundingBox()
const mm = await pg.locator('[data-minimap]').boundingBox()
ok('the minimap is a real map (about 168 x 112), not a pill', mm.width > 150 && mm.height > 100, [mm.width, mm.height])
const svgb = await pg.locator('[data-minimap] svg').boundingBox()
ok('its drawing fills the button', Math.abs(svgb.width - 168) < 2 && Math.abs(svgb.height - 112) < 2, svgb)
await pg.mouse.click(mm.x + mm.width - 14, mm.y + mm.height - 14); await pg.waitForTimeout(700)
const poll1 = await pg.locator('[data-board][data-path="screens/Poll.html"]').boundingBox()
ok('clicking the minimap moves the view there', Math.abs(poll1.x - poll0.x) > 40 || Math.abs(poll1.y - poll0.y) > 40, [poll0.x, poll1.x])
await pg.keyboard.press('Shift+Digit1')

// --- command palette
await pg.mouse.click(empty.x, empty.y)
await pg.keyboard.press('Control+k'); await pg.waitForTimeout(400)
ok('Ctrl+K on the canvas opens the palette', await pg.locator('[role=dialog] [cmdk-input], [role=dialog] input').first().isVisible())
await pg.keyboard.type('rect'); await pg.waitForTimeout(200)
ok('typing filters the commands', await pg.locator('[role=option]').count() >= 1 && await pg.locator('[role=option]', { hasText: 'Rectangle' }).count() === 1)
await pg.keyboard.press('Enter'); await pg.waitForTimeout(500)
ok('Enter runs it: the Rectangle tool is active and the palette is closed', await pg.locator('button[aria-label="Rectangle"][aria-pressed="true"]').count() === 1 && await pg.locator('[role=dialog]').count() === 0)
await pg.keyboard.press('Escape')
const b0 = Object.keys((await t.canvas()).boards).length
await pg.locator('button[aria-label="Command palette"]').click(); await pg.waitForTimeout(300)
await pg.keyboard.type('add a board'); await pg.keyboard.press('Enter'); await t.settle(3500)
ok('the zoom pill opens it too; "Add a board" adds one', Object.keys((await t.canvas()).boards).length === b0 + 1)
await pg.keyboard.press('Control+k'); await pg.waitForTimeout(300); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300)
ok('Escape closes the palette', await pg.locator('[role=dialog]').count() === 0)

// --- laser pointer: only while presenting
await pg.locator('button:has-text("Done")').first().click(); await pg.waitForTimeout(800)
await pg.locator('button[aria-label="Present"]').last().click(); await pg.waitForTimeout(1200)
ok('presenting offers the laser pointer', await pg.locator('button[aria-label^="Laser pointer"]').count() === 1)
await pg.locator('button[aria-label^="Laser pointer"]').click(); await pg.waitForTimeout(300)
ok('turning it on puts an overlay above the page', await pg.locator('[data-laser]').count() === 1)
const lb = await pg.locator('[data-laser]').boundingBox()
await pg.mouse.move(lb.x + 100, lb.y + 100); await pg.mouse.move(lb.x + 220, lb.y + 160, { steps: 8 })
const ink = await pg.evaluate(() => { const c = document.querySelector('[data-laser]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n })
ok('a trail is drawn while the pointer moves', ink > 50, ink)
await pg.waitForTimeout(1300)
const ink2 = await pg.evaluate(() => { const c = document.querySelector('[data-laser]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n })
ok('and it fades away', ink2 < ink / 4 + 1, [ink, ink2])
await pg.keyboard.press('Escape'); await pg.waitForTimeout(700)
ok('leaving the presentation removes it', await pg.locator('[data-laser]').count() === 0 && await pg.locator('button[aria-label^="Laser pointer"]').count() === 0)
const clean = t.logs.filter(l => !/favicon|404/.test(l)); ok('no page errors', clean.length === 0, clean)
await t.browser.close(); process.exit(results.fails ? 1 : 0)
