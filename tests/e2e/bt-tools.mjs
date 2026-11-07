// Phase 1: tool lock, number keys, Shift+1/2, Space-pan, Shift/Alt drawing constraints.
import { open, ok, results, geom, drag, center } from './cvh.mjs'
const t = await open()
const { pg, stage } = t
const g0 = geom(await t.canvas())
const pressed = (label) => pg.locator(`button[aria-label="${label}"][aria-pressed="true"]`).count()
await pg.mouse.click(stage.x + 900, stage.y + 760)

// number keys pick toolbar slots
await pg.keyboard.press('5'); ok('5 picks the 5th tool (Sticky note)', await pressed('Sticky note') === 1)
await pg.keyboard.press('6'); ok('6 picks Rectangle', await pressed('Rectangle') === 1)
await pg.keyboard.press('1'); ok('1 picks Select', await pressed('Select') === 1)

// tool lock: Q, badge, stays after drawing, Escape releases
const drawRect = async (x, y, w, h, mods = []) => drag(pg, { x: stage.x + x, y: stage.y + y }, { x: stage.x + x + w, y: stage.y + y + h }, { mods })
await pg.keyboard.press('r'); await pg.keyboard.press('q')
ok('Q shows the lock badge on the tool', await pg.locator('[aria-label="Tool locked"]').count() === 1)
await drawRect(780, 130, 80, 50); await pg.waitForTimeout(300)
ok('after drawing, the locked tool stays active', await pressed('Rectangle') === 1)
await drawRect(780, 220, 80, 50); await pg.waitForTimeout(300)
ok('a second shape without picking the tool again', await pg.locator('svg.note.shape').count() === 2)
await pg.keyboard.press('Escape'); await pg.waitForTimeout(200)
ok('Escape returns to Select and drops the lock', await pressed('Select') === 1 && await pg.locator('[aria-label="Tool locked"]').count() === 0)
await pg.locator('button[aria-label="Oval"]').dblclick(); await pg.waitForTimeout(200)
ok('double-click on a toolbar item locks it', await pressed('Oval') === 1 && await pg.locator('[aria-label="Tool locked"]').count() === 1)
await pg.locator('button[aria-label="Select"]').click(); await pg.waitForTimeout(200)
ok('choosing Select clears the lock', await pg.locator('[aria-label="Tool locked"]').count() === 0)
await t.settle(); await pg.keyboard.press('Control+z'); await t.settle(2500)

// constraints
const before = Object.keys((await t.canvas()).notes)
await pg.keyboard.press('r'); await drawRect(780, 130, 100, 40, ['Shift']); await t.settle()
let cn = await t.canvas()
let made = Object.entries(cn.notes).filter(([k]) => !before.includes(k)).map(([, n]) => n)
ok('Shift draws a square', made.length === 1 && Math.abs(made[0].w - made[0].h) < 0.2, made)
await pg.keyboard.press('r'); await drawRect(900, 200, 60, 30, ['Alt']); await t.settle()
cn = await t.canvas()
const kk = (await pg.locator('[data-board][data-path="screens/Login.html"]').boundingBox()).width / 560
const alt = Object.values(cn.notes).filter(n => n.kind === 'rect' && Math.abs(n.w - 120 / kk) < 1.5)
ok('Alt draws from the centre (twice the drag, centred on the press point)', alt.length === 1 && Math.abs(alt[0].h - 60 / kk) < 1.5, alt)
await pg.keyboard.press('l'); await drawRect(780, 330, 150, 12, ['Shift']); await t.settle()
cn = await t.canvas()
const arrow = Object.values(cn.notes).find(n => n.kind === 'arrow')
const ang = Math.atan2(arrow.h, arrow.w) * 180 / Math.PI
ok('Shift snaps an arrow to a multiple of 15 degrees', Math.abs(ang / 15 - Math.round(ang / 15)) < 0.02, ang)

// fit and zoom to selection with Shift+digit (by physical key)
const pct = async () => (await pg.locator('.zoom .pct').innerText()).trim()
const fitPct = await pct()
await pg.keyboard.press('+'); await pg.keyboard.press('+'); await pg.waitForTimeout(400)
ok('zoom changed', await pct() !== fitPct)
await pg.keyboard.press('Shift+Digit1'); await pg.waitForTimeout(500)
ok('Shift+1 fits everything again', await pct() === fitPct, [await pct(), fitPct])
const login = await pg.locator('[data-board][data-path="screens/Login.html"]').boundingBox()
await pg.mouse.click(center(login).x, center(login).y); await pg.keyboard.press('Shift+Digit2'); await pg.waitForTimeout(500)
ok('Shift+2 zooms to the selection', parseInt(await pct()) > parseInt(fitPct), [await pct(), fitPct])
await pg.keyboard.press('Shift+Digit1'); await pg.waitForTimeout(500)

// Space pans, even over a board; nothing is moved or saved
const v = await t.version()
const poll = await pg.locator('[data-board][data-path="screens/Poll.html"]').boundingBox()
await pg.keyboard.down('Space')
await drag(pg, { x: center(poll).x, y: poll.y + 200 }, { x: center(poll).x + 80, y: poll.y + 230 })
const poll2 = await pg.locator('[data-board][data-path="screens/Poll.html"]').boundingBox()
await pg.keyboard.up('Space'); await t.settle(1800)
ok('holding Space pans the view', Math.abs(poll2.x - poll.x - 80) < 2 && Math.abs(poll2.y - poll.y - 30) < 2, [poll2.x - poll.x, poll2.y - poll.y])
ok('...without moving the board in the file', await t.version() === v)
await pg.mouse.move(stage.x + 900, stage.y + 760)
const clean = t.logs.filter(l => !/favicon|404/.test(l)); ok('no page errors', clean.length === 0, clean)
await t.browser.close(); process.exit(results.fails ? 1 : 0)
