// Phase 2: arrow binding, text in shapes, style panel, lock and group, eraser. One gesture = one undo step.
import { open, ok, results, geom, drag, center } from './cvh.mjs'
const t = await open()
const { pg, stage, id } = t
pg.on('dialog', d => d.accept())
const post = async (ops) => fetch(`${process.env.HUB}/api/artifacts/${id}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer devtoken' }, body: JSON.stringify({ baseVersion: await t.version(), ops }) })
await post([
  { type: 'addNote', id: 'ra', note: { kind: 'rect', x: 700, y: 800, w: 200, h: 120, fill: 'yellow' } },
  { type: 'addNote', id: 'ov', note: { kind: 'oval', x: 1100, y: 1000, w: 200, h: 120, fill: 'blue' } },
  { type: 'addNote', id: 'rb', note: { kind: 'rect', x: 700, y: 1250, w: 200, h: 120, fill: 'green' } },
])
await pg.reload(); await pg.waitForSelector('iframe'); await pg.waitForTimeout(1200); await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(600)
const shape = (nid) => pg.locator(`svg.note.shape[data-id="${nid}"]`)
const sbox = async (nid) => shape(nid).boundingBox()
const empty = { x: stage.x + 15, y: stage.y + 300 }
const arrowId = async () => Object.entries((await t.canvas()).notes).find(([, n]) => n.kind === 'arrow')?.[0]
const abox = async (nid) => pg.locator(`svg.note.vec[data-id="${nid}"]`).boundingBox()

// 1. draw an arrow from inside one shape to inside another: both ends bind
await pg.keyboard.press('Escape'); await pg.mouse.click(empty.x, empty.y)
await pg.keyboard.press('l')
const ra0 = await sbox('ra'), ov0 = await sbox('ov')
const v0 = await t.version()
await drag(pg, center(ra0), center(ov0), { steps: 6 }); await t.settle()
const aid = await arrowId()
let c = await t.canvas()
ok('drawing an arrow from one shape to another binds both ends, in one version', aid && c.notes[aid].bind?.start?.id === 'ra' && c.notes[aid].bind?.end?.id === 'ov' && await t.version() === v0 + 1, c.notes[aid])
const ab0 = await abox(aid)
ok('the drawn ends sit on the shapes\' edges (not at the pointer inside them)', ab0.x >= ra0.x + ra0.width - 4 || ab0.y >= ra0.y + ra0.height - 4, [ab0, ra0])

// 2. move the target: the arrow follows without any change to the arrow itself
const aJson = JSON.stringify(c.notes[aid])
const ov1 = await sbox('ov')
await pg.mouse.click(empty.x, empty.y)
await drag(pg, center(ov1), { x: center(ov1).x + 90, y: center(ov1).y + 70 }); await t.settle()
const ab1 = await abox(aid)
c = await t.canvas()
ok('moving the target moves the arrow end with it', Math.abs(ab1.width - ab0.width) > 15 || Math.abs(ab1.height - ab0.height) > 15, [ab0, ab1])
ok('...and the arrow\'s stored data did not change', JSON.stringify(c.notes[aid]) === aJson, c.notes[aid])

// 3. drag the end onto another shape: it is highlighted while over it, and rebinds on release
await pg.locator(`svg.note.vec[data-id="${aid}"] line`).first().click({ force: true })
await pg.waitForTimeout(200)
const hd = pg.locator('.hd')
ok('a selected arrow shows its two end handles', await hd.count() === 2, await hd.count())
const rb0 = await sbox('rb'), endH = center(await hd.nth(1).boundingBox())
await pg.mouse.move(endH.x, endH.y); await pg.mouse.down()
await pg.mouse.move(endH.x - 20, endH.y + 40, { steps: 4 }); await pg.mouse.move(center(rb0).x, center(rb0).y, { steps: 8 })
ok('the shape under the dragged end is highlighted', await pg.locator('.bind-hl').count() === 1)
await pg.mouse.up(); await t.settle()
c = await t.canvas()
ok('releasing on another shape rebinds that end (one version)', c.notes[aid].bind?.end?.id === 'rb' && c.notes[aid].bind?.start?.id === 'ra', c.notes[aid].bind)
// 4. drop on empty canvas: the end comes loose
await pg.locator(`svg.note.vec[data-id="${aid}"] line`).first().click({ force: true }); await pg.waitForTimeout(200)
const endH2 = center(await hd.nth(1).boundingBox())
await drag(pg, endH2, { x: endH2.x + 160, y: endH2.y - 10 }, { steps: 6 }); await t.settle()
c = await t.canvas()
ok('dropping an end on empty canvas unbinds it', !c.notes[aid].bind?.end && c.notes[aid].bind?.start?.id === 'ra', c.notes[aid].bind)
// 5. moving the arrow alone (nudge) detaches the rest
await pg.locator(`svg.note.vec[data-id="${aid}"] line`).first().click({ force: true }); await pg.waitForTimeout(200)
await pg.keyboard.press('ArrowRight'); await t.settle()
c = await t.canvas()
ok('moving an arrow without its targets detaches it', !c.notes[aid].bind, c.notes[aid].bind)
// 6. deleting a target clears the binding in the same version
await pg.keyboard.press('Control+z'); await t.settle(2500)   // bind is back
c = await t.canvas()
ok('undo brings the binding back', c.notes[aid].bind?.start?.id === 'ra', c.notes[aid].bind)
const vD = await t.version()
await pg.mouse.click(center(await sbox('ra')).x, center(await sbox('ra')).y); await pg.keyboard.press('Delete'); await t.settle()
c = await t.canvas()
ok('deleting a target removes the binding in the same version', !c.notes.ra && !c.notes[aid].bind?.start && await t.version() === vD + 1, [c.notes.ra, c.notes[aid].bind])
await pg.mouse.click(empty.x, empty.y); await pg.keyboard.press('Control+z'); await t.settle(2500)
ok('undo restores the shape and the binding', (await t.canvas()).notes.ra && (await t.canvas()).notes[aid].bind?.start?.id === 'ra')

// 7. text inside shapes
const rb1 = await sbox('rb')
await pg.mouse.dblclick(center(rb1).x, center(rb1).y); await pg.waitForTimeout(300)
await pg.keyboard.type('Hello shape'); await pg.mouse.click(empty.x, empty.y); await t.settle()
c = await t.canvas()
ok('double-click edits the text inside a shape', c.notes.rb.text === 'Hello shape' && await pg.locator('.note.label', { hasText: 'Hello shape' }).count() === 1, c.notes.rb)
const ov2 = await sbox('ov'), nBefore = Object.keys(c.notes).length
await pg.mouse.dblclick(center(ov2).x, center(ov2).y); await pg.waitForTimeout(300); await pg.mouse.click(empty.x, empty.y); await t.settle(1800)
ok('an empty shape is not deleted when its text edit ends empty', Object.keys((await t.canvas()).notes).length === nBefore && (await t.canvas()).notes.ov)

// 8. style panel on a multi-selection: one batch
await pg.mouse.click(empty.x, empty.y)
await pg.mouse.click(center(await sbox('rb')).x, center(await sbox('rb')).y)
await pg.keyboard.down('Shift'); await pg.mouse.click(center(await sbox('ov')).x, center(await sbox('ov')).y + 20); await pg.keyboard.up('Shift')
const v8 = await t.version(), g8 = geom(await t.canvas())
await pg.locator('[aria-label="Dashed"]').click(); await t.settle()
c = await t.canvas()
ok('Dashed applies to every selected shape in one version', c.notes.rb.strokeStyle === 'dashed' && c.notes.ov.strokeStyle === 'dashed' && await t.version() === v8 + 1, [c.notes.rb, c.notes.ov])
await pg.locator('[aria-label="Stroke colour (hex)"]').fill('#ff0000'); await pg.keyboard.press('Tab'); await t.settle()
c = await t.canvas()
ok('stroke colour applies to both', c.notes.rb.stroke === '#ff0000' && c.notes.ov.stroke === '#ff0000', [c.notes.rb.stroke, c.notes.ov.stroke])
ok('the stroke is drawn dashed and red', await shape('rb').locator('rect').evaluate(r => r.getAttribute('stroke-dasharray') && r.getAttribute('stroke') === '#ff0000'))
await pg.locator('[aria-label="Bold"]').click(); await t.settle()
ok('width Bold sets strokeWidth 4', (await t.canvas()).notes.rb.strokeWidth === 4)
await pg.mouse.click(empty.x, empty.y); await pg.keyboard.press('Control+z'); await t.settle(2500); await pg.keyboard.press('Control+z'); await t.settle(2500); await pg.keyboard.press('Control+z'); await t.settle(2500)
c = await t.canvas()
ok('three undos remove the three style changes', !c.notes.rb.strokeStyle && !c.notes.rb.stroke && !c.notes.rb.strokeWidth && !c.notes.ov.strokeStyle, [c.notes.rb, c.notes.ov])

// 9. arrowheads: select the arrow, set the start head
await pg.locator(`svg.note.vec[data-id="${aid}"] line`).first().click({ force: true }); await pg.waitForTimeout(200)
await pg.locator('[aria-label="Start arrowhead"]').click(); await pg.locator('[role=option]:has-text("Dot")').click(); await t.settle()
ok('arrowhead at the start can be set', (await t.canvas()).notes[aid].arrowStart === 'dot' && await pg.locator(`svg.note.vec[data-id="${aid}"] circle`).count() === 1)

// 10. lock and group
await pg.mouse.click(empty.x, empty.y)
const rbc = center(await sbox('rb'))
await pg.mouse.click(rbc.x, rbc.y, { button: 'right' }); await pg.waitForTimeout(200)
await pg.locator('[role=menuitem]:has-text("Lock")').click(); await t.settle()
ok('the context menu locks a shape', (await t.canvas()).notes.rb.locked === true)
const vL = await t.version()
await drag(pg, rbc, { x: rbc.x + 60, y: rbc.y + 40 }); await t.settle(1800)
ok('a locked shape cannot be dragged', await t.version() === vL && (await t.canvas()).notes.rb.y === 1250)
await pg.mouse.click(rbc.x, rbc.y, { button: 'right' }); await pg.waitForTimeout(200)
ok('the menu now offers Unlock', await pg.locator('[role=menuitem]:has-text("Unlock")').isVisible())
await pg.locator('[role=menuitem]:has-text("Unlock")').click(); await t.settle()
ok('Unlock frees it', !(await t.canvas()).notes.rb.locked)
await pg.mouse.click(empty.x, empty.y)
await pg.mouse.click(center(await sbox('rb')).x, center(await sbox('rb')).y)
await pg.keyboard.down('Shift'); await pg.mouse.click(center(await sbox('ov')).x, center(await sbox('ov')).y + 20); await pg.keyboard.up('Shift')
await pg.keyboard.press('Control+g'); await t.settle()
c = await t.canvas()
ok('Ctrl+G groups the selection', c.notes.rb.group && c.notes.rb.group === c.notes.ov.group, [c.notes.rb.group, c.notes.ov.group])
await pg.mouse.click(empty.x, empty.y)
await pg.mouse.click(center(await sbox('rb')).x, center(await sbox('rb')).y)
ok('clicking one member selects the whole group', await pg.locator('text=/2 items/').first().isVisible())
await pg.mouse.dblclick(center(await sbox('rb')).x, center(await sbox('rb')).y); await pg.waitForTimeout(300)
ok('double-click selects just that member', !(await pg.locator('text=/2 items/').first().isVisible().catch(() => false)))
await pg.keyboard.press('Escape'); await pg.mouse.click(empty.x, empty.y)
await pg.mouse.click(center(await sbox('rb')).x, center(await sbox('rb')).y); await pg.keyboard.press('Control+Shift+g'); await t.settle()
c = await t.canvas()
ok('Ctrl+Shift+G ungroups', !c.notes.rb.group && !c.notes.ov.group, [c.notes.rb.group, c.notes.ov.group])

// 11. eraser: one stroke, two notes, one version; boards untouched
await pg.mouse.click(empty.x, empty.y); await t.settle(1500)
const boards0 = Object.keys((await t.canvas()).boards).length, vE = await t.version()
await pg.keyboard.press('e')
ok('E picks the eraser', await pg.locator('button[aria-label^="Eraser"][aria-pressed="true"]').count() === 1)
const pa = center(await sbox('rb')), pb = center(await sbox('ov'))
await pg.mouse.move(pa.x - 30, pa.y); await pg.mouse.down(); await pg.mouse.move(pa.x, pa.y, { steps: 3 }); await pg.mouse.move(pb.x, pb.y, { steps: 10 })
ok('notes under the eraser are marked before release', await pg.locator('.note.erasing').count() >= 2, await pg.locator('.note.erasing').count())
await pg.mouse.up(); await t.settle()
c = await t.canvas()
ok('releasing deletes everything it touched in one version', !c.notes.rb && !c.notes.ov && await t.version() === vE + 1, Object.keys(c.notes))
ok('boards are never erased', Object.keys(c.boards).length === boards0)
await pg.keyboard.press('Escape'); await pg.keyboard.press('Control+z'); await t.settle(2500)
ok('one undo restores the erased notes', (await t.canvas()).notes.rb && (await t.canvas()).notes.ov)

// 12. review follow-ups: panel shows what is drawn, copies of bound arrows, groups, locks, eraser cancel, Alt = no binding
await pg.mouse.click(empty.x, empty.y); await t.settle(1500)
await pg.locator(`svg.note.vec[data-id="${aid}"] line`).first().click({ force: true }); await pg.waitForTimeout(250)
ok('the panel shows the drawn width for a note that stores none (Medium) and the drawn head (Arrow at the end)', await pg.locator('[aria-label="Medium"][data-state="on"]').count() === 1 && (await pg.locator('[aria-label="End arrowhead"]').innerText()).includes('Arrow'))
ok('a bound arrow has no stale frame fields', await pg.locator('text=/Attached to/').count() === 1 && await pg.locator('text=ΔX').count() === 0)
// copy a bound arrow after its target moved: the copy appears where the arrow is drawn
const ra5 = await sbox('ra')
await pg.mouse.click(empty.x, empty.y)
await drag(pg, center(ra5), { x: center(ra5).x - 50, y: center(ra5).y + 60 }); await t.settle(1500)
const orig = await abox(aid), kk = (await pg.locator('[data-board][data-path="screens/Login.html"]').boundingBox()).width / 560
await pg.locator(`svg.note.vec[data-id="${aid}"] line`).first().click({ force: true }); await pg.waitForTimeout(250)
const vC = await t.version()
await pg.keyboard.press('Control+d'); await t.settle()
c = await t.canvas()
const copyId = Object.entries(c.notes).find(([k2, n]) => n.kind === 'arrow' && k2 !== aid)?.[0]
const cb = copyId && await abox(copyId)
ok('Ctrl+D on a bound arrow copies it where it is drawn (+24), unbound, in one version', copyId && !c.notes[copyId].bind && await t.version() === vC + 1 && Math.abs((cb.x - orig.x) - 24 * kk) < 2.5 && Math.abs((cb.y - orig.y) - 24 * kk) < 2.5, [orig, cb])
await pg.mouse.click(empty.x, empty.y); await pg.keyboard.press('Control+z'); await t.settle(2500)

// shift-click on a group member selects the whole group
await pg.mouse.click(empty.x, empty.y)
await pg.mouse.click(center(await sbox('rb')).x, center(await sbox('rb')).y)
await pg.keyboard.down('Shift'); await pg.mouse.click(center(await sbox('ov')).x, center(await sbox('ov')).y + 20); await pg.keyboard.up('Shift')
const vG = await t.version()
await pg.keyboard.press('Control+g'); await t.settle()
ok('Ctrl+G is one version', await t.version() === vG + 1)
await pg.keyboard.press('Control+z'); await t.settle(2500)
ok('...and one undo ungroups', !(await t.canvas()).notes.rb.group)
await pg.keyboard.press('Control+g'); await t.settle()
await pg.mouse.click(empty.x, empty.y)
await pg.keyboard.down('Shift'); await pg.mouse.click(center(await sbox('rb')).x, center(await sbox('rb')).y); await pg.keyboard.up('Shift')
ok('shift-click on a group member adds the whole group', await pg.locator('text=/2 items/').first().isVisible())
await pg.keyboard.press('Control+Shift+g'); await t.settle()

// locks: one version, shown in the panel, the panel cannot bypass it, marquee and eraser skip locked notes
await pg.mouse.click(empty.x, empty.y)
await pg.mouse.click(center(await sbox('ra')).x, center(await sbox('ra')).y)
const vLk = await t.version()
await pg.keyboard.press('Control+Shift+l'); await t.settle()
ok('Ctrl+Shift+L locks in one version', (await t.canvas()).notes.ra.locked === true && await t.version() === vLk + 1)
ok('the panel says Locked with an Unlock button, and Delete there is disabled', await pg.locator('.lockbar', { hasText: 'Locked' }).count() === 1 && await pg.locator('fieldset:disabled button:has-text("Delete")').count() === 1)
ok('a lock badge marks the selection', await pg.locator('[aria-label="Locked"]').count() >= 1)
await pg.mouse.click(empty.x, empty.y)
const ra6 = await sbox('ra')
await drag(pg, { x: ra6.x - 25, y: ra6.y - 25 }, { x: ra6.x + ra6.width + 25, y: ra6.y + ra6.height + 25 })
ok('a marquee does not select a locked note (the arrow attached to it may be selected, the note is not)', await pg.locator('[aria-label="Locked"]').count() === 0 && await pg.locator('.lockbar').count() === 0)
await pg.keyboard.press('e')
await drag(pg, { x: center(ra6).x - 40, y: center(ra6).y }, { x: center(ra6).x + 40, y: center(ra6).y }); await t.settle(1800)
ok('the eraser does not touch a locked note', !!(await t.canvas()).notes.ra)
await pg.keyboard.press('Escape')
await pg.mouse.click(center(await sbox('ra')).x, center(await sbox('ra')).y); await pg.keyboard.press('Control+Shift+l'); await t.settle()
ok('Ctrl+Shift+L again unlocks', !(await t.canvas()).notes.ra.locked)

// Escape cancels an eraser stroke in progress
await pg.mouse.click(empty.x, empty.y); await pg.keyboard.press('e')
const ea = center(await sbox('rb')), eb = center(await sbox('ov'))
await pg.mouse.move(ea.x - 30, ea.y); await pg.mouse.down(); await pg.mouse.move(ea.x, ea.y, { steps: 3 })
await pg.keyboard.press('Escape'); await pg.mouse.move(eb.x, eb.y, { steps: 8 }); await pg.mouse.up(); await t.settle(1800)
ok('Escape during an eraser stroke cancels it: nothing is deleted', (await t.canvas()).notes.rb && (await t.canvas()).notes.ov)

// Alt while drawing an arrow: no binding
await pg.mouse.click(empty.x, empty.y); await pg.keyboard.press('l')
await pg.keyboard.down('Alt'); await drag(pg, center(await sbox('rb')), center(await sbox('ov')), { steps: 6 }); await pg.keyboard.up('Alt'); await t.settle()
c = await t.canvas()
const free = Object.entries(c.notes).filter(([k2, n]) => n.kind === 'arrow' && k2 !== aid)
ok('holding Alt while drawing an arrow does not attach it', free.length === 1 && !free[0][1].bind, free)

const clean = t.logs.filter(l => !/favicon|404/.test(l)); ok('no page errors', clean.length === 0, clean)
await t.browser.close(); process.exit(results.fails ? 1 : 0)
