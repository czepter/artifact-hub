// Phase 1: copy / paste / duplicate (notes and boards), Alt-drag clone, z-order. One gesture = one version.
import { open, ok, results, geom, drag, center } from './cvh.mjs'
import { api } from './bh.mjs'
const t = await open()
const { pg, stage, id } = t
const post = async (ops) => fetch(`${process.env.HUB}/api/artifacts/${id}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer devtoken' }, body: JSON.stringify({ baseVersion: await t.version(), ops }) })
await post([{ type: 'addNote', id: 'ra', note: { kind: 'rect', x: 1000, y: 700, w: 160, h: 100, fill: 'blue' } }, { type: 'addNote', id: 'rb', note: { kind: 'rect', x: 1040, y: 730, w: 160, h: 100, fill: 'red' } }, { type: 'addNote', id: 'rc', note: { kind: 'rect', x: 1080, y: 760, w: 160, h: 100, fill: 'green' } }, { type: 'addNote', id: 'sk', note: { kind: 'sticky', x: 700, y: 760, w: 200, h: 120, text: 'Copy me' } }])
await pg.reload(); await pg.waitForSelector('iframe'); await pg.waitForTimeout(900); await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(600)
pg.on('dialog', d => d.accept())
const stickyBox = () => pg.locator('.note.sticky', { hasText: 'Copy me' }).first().boundingBox()
const g0 = geom(await t.canvas()), v0 = await t.version()

// duplicate a note with Ctrl+D
await pg.mouse.click(center(await stickyBox()).x, center(await stickyBox()).y)
await pg.keyboard.press('Control+d'); await t.settle()
let c = await t.canvas()
const stickies = Object.entries(c.notes).filter(([, n]) => n.text === 'Copy me')
ok('Ctrl+D duplicates the note (offset, same text) in one version', stickies.length === 2 && await t.version() === v0 + 1 && stickies.some(([, n]) => n.x === 724 && n.y === 784), stickies)
ok('the copy is selected', await pg.locator('.selbox').count() === 1)
await pg.keyboard.press('Control+z'); await t.settle(2500)
ok('undo removes the copy', geom(await t.canvas()) === g0)

// copy and paste at the pointer
await pg.mouse.click(center(await stickyBox()).x, center(await stickyBox()).y)
await pg.keyboard.press('Control+c')
const target = { x: stage.x + 700, y: stage.y + 560 }
await pg.mouse.move(target.x, target.y); await pg.keyboard.press('Control+v'); await t.settle()
c = await t.canvas()
const pasted = Object.entries(c.notes).filter(([, n]) => n.text === 'Copy me' && n.x !== 700)
ok('Ctrl+V pastes at the pointer', pasted.length === 1 && Math.abs(pasted[0][1].y - 760) > 50, pasted)
await pg.keyboard.press('Control+z'); await t.settle(2500)

// Alt-drag clones
const v1 = await t.version(), sb = await stickyBox()
await pg.keyboard.down('Alt'); await drag(pg, center(sb), { x: center(sb).x + 120, y: center(sb).y - 60 }); await pg.keyboard.up('Alt'); await t.settle()
c = await t.canvas()
const both = Object.values(c.notes).filter(n => n.text === 'Copy me')
ok('Alt-drag leaves the original and drops a copy where it ended (one version)', both.length === 2 && both.some(n => n.x === 700 && n.y === 760) && both.some(n => n.x > 800) && await t.version() === v1 + 1, both)
await pg.keyboard.press('Control+z'); await t.settle(2500)
ok('undo removes the clone', geom(await t.canvas()) === g0)

// a board: duplicate copies its file
const v2 = await t.version()
const login = await pg.locator('[data-board][data-path="screens/Login.html"]').boundingBox()
await pg.mouse.click(center(login).x, center(login).y); await pg.keyboard.press('Control+d'); await t.settle()
const view = await t.view()
ok('duplicating a board adds an entry and a byte-exact file copy in one version', view.canvas.boards['screens/Login-copy.html'] && view.files.some(f => f.path === 'screens/Login-copy.html') && await t.version() === v2 + 1, Object.keys(view.canvas.boards))
await pg.keyboard.press('Control+z'); await t.settle(3000)
ok('undo removes the board entry', !(await t.canvas()).boards['screens/Login-copy.html'])

// z-order
const order = async () => (await t.canvas()).noteOrder
const domOrder = () => pg.locator('svg.note.shape').evaluateAll(els => els.map(e => e.dataset.id))
ok('without noteOrder the stack is key order', (await domOrder()).join() === 'ra,rb,rc')
const rb = (await pg.locator('svg.note.shape[data-id="rb"] rect').boundingBox())
await pg.mouse.click(rb.x + rb.width - 6, rb.y + 6)   // inside rb only? the top-right corner of rb is covered by nothing
await pg.keyboard.press('Control+BracketRight'); await t.settle()
ok('Ctrl+] brings to front', (await order()).slice(-1)[0] === 'rb' && (await domOrder()).slice(-1)[0] === 'rb', await order())
await pg.keyboard.press('Control+BracketLeft'); await t.settle()
ok('Ctrl+[ sends to back', (await order())[0] === 'rb' && (await domOrder())[0] === 'rb', await order())
await pg.keyboard.press('BracketRight'); await t.settle()
ok('] moves one step forward', (await order()).join() === 'ra,rb,rc,' + (await order()).slice(3).join() || (await order()).indexOf('rb') === 1, await order())
await pg.keyboard.press('BracketLeft'); await t.settle()
ok('[ moves one step back', (await order())[0] === 'rb', await order())
await pg.mouse.click(rb.x + rb.width - 6, rb.y + 6, { button: 'right' })
ok('the context menu offers the same', await pg.locator('[role=menuitem]:has-text("Bring to front")').isVisible() && await pg.locator('[role=menuitem]:has-text("Send to back")').isVisible())
await pg.keyboard.press('Escape')
const clean = t.logs.filter(l => !/favicon|404/.test(l)); ok('no page errors', clean.length === 0, clean)
await t.browser.close(); process.exit(results.fails ? 1 : 0)
