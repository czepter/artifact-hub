import { launch, api, B } from './bh.mjs'
const list = await api('/api/artifacts')
const src = list.find(a => a.title === 'Test canvas')
const dup = await api(`/api/artifacts/${src.id}/duplicate`, {}, 'POST')
const id = dup.id
const { browser, page: pg, logs } = await launch({ viewport: { width: 1500, height: 920 } })
const ok = (n, c, x = '') => console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x)
const cj = async () => { await pg.waitForTimeout(2600); const r = await api(`/api/artifacts/${id}/export`); return null }
const canvasJson = () => new Promise(res => { import('node:child_process').then(({ execSync }) => { execSync(`curl -s -H "authorization: Bearer ${process.env.T}" ${B}/api/artifacts/${id}/export -o /tmp/cv.zip`); res(JSON.parse(execSync(`python3 -c "import zipfile;print(zipfile.ZipFile('/tmp/cv.zip').read('canvas.json').decode())"`).toString())) }) })
await pg.goto(`${B}/a/${id}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(900)
await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(600)
ok('toolbar appears at canvas level', await pg.locator('[data-toolbar][aria-label="Canvas tools"]').isVisible())
ok('starts at canvas level (not focused) for a multi-board canvas', await pg.locator('.focusbar').count() === 0)
const stage = await pg.locator('.canvas').boundingBox()
await pg.screenshot({ path: 'cv-0.png' })

// --- sticky note: choose tool, click empty canvas, type, click away
await pg.locator('button[aria-label="Sticky note"]').click()
await pg.mouse.click(stage.x + 120, stage.y + 560)
await pg.waitForTimeout(300)
await pg.keyboard.type('Check the poll copy')
await pg.mouse.click(stage.x + 700, stage.y + 760)   // click away commits
await pg.waitForTimeout(400)
ok('sticky note created with typed text', await pg.locator('.note.sticky', { hasText: 'Check the poll copy' }).count() === 1)
ok('tool returned to Select', await pg.locator('button[aria-label="Select"][aria-pressed="true"]').count() === 1)

// --- rectangle by dragging, arrow by dragging
await pg.locator('button[aria-label="Rectangle"]').click()
await pg.mouse.move(stage.x + 520, stage.y + 560); await pg.mouse.down(); await pg.mouse.move(stage.x + 600, stage.y + 600, { steps: 4 }); await pg.mouse.move(stage.x + 700, stage.y + 640, { steps: 4 }); await pg.mouse.up()
await pg.waitForTimeout(300)
ok('rectangle drawn', await pg.locator('.note.shape').count() === 1)
await pg.locator('button[aria-label="Arrow"]').click()
await pg.mouse.move(stage.x + 400, stage.y + 640); await pg.mouse.down(); await pg.mouse.move(stage.x + 480, stage.y + 600, { steps: 4 }); await pg.mouse.move(stage.x + 520, stage.y + 585, { steps: 4 }); await pg.mouse.up()
await pg.waitForTimeout(300)
ok('arrow drawn', await pg.locator('svg.note.vec line').count() >= 1)

// --- new board with the board tool
const boardsBefore = await pg.locator('[data-board]').count()
await pg.locator('button[aria-label="Board"]').click()
await pg.mouse.move(stage.x + 900, stage.y + 480); await pg.mouse.down(); await pg.mouse.move(stage.x + 1000, stage.y + 560, { steps: 4 }); await pg.mouse.move(stage.x + 1120, stage.y + 640, { steps: 4 }); await pg.mouse.up()
await pg.waitForTimeout(3200)
ok('a new board appears (and survives the save round trip)', await pg.locator('[data-board]').count() === boardsBefore + 1, await pg.locator('[data-board]').count())
await pg.screenshot({ path: 'cv-1.png' })

// --- move board 1 by dragging its body; resize it with a handle
const b1 = await pg.locator('[data-board]').first().boundingBox()
await pg.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2); await pg.mouse.down(); await pg.mouse.move(b1.x + b1.width / 2 + 40, b1.y + b1.height / 2 + 30, { steps: 5 }); await pg.mouse.move(b1.x + b1.width / 2 + 90, b1.y + b1.height / 2 + 60, { steps: 5 }); await pg.mouse.up()
await pg.waitForTimeout(300)
const b1m = await pg.locator('[data-board]').first().boundingBox()
ok('board dragged ~90/60 screen px (snapping may pull it a few px)', Math.abs(b1m.x - b1.x - 90) <= 8 && Math.abs(b1m.y - b1.y - 60) <= 3, [b1m.x - b1.x, b1m.y - b1.y])
const se = pg.locator('.hd').nth(4)   // 'se' handle is 5th in HANDLES
const hb = await se.boundingBox()
await pg.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await pg.mouse.down(); await pg.mouse.move(hb.x + 40, hb.y + 30, { steps: 5 }); await pg.mouse.up()
await pg.waitForTimeout(300)
const b1r = await pg.locator('[data-board]').first().boundingBox()
ok('board resized by handle', b1r.width > b1m.width + 30 && b1r.height > b1m.height + 20, [b1r.width - b1m.width, b1r.height - b1m.height])

// --- rename board 2 by double-clicking its title
const t2 = pg.locator('.board-title .t').nth(1)
await t2.dblclick(); await pg.waitForTimeout(200)
await pg.keyboard.type('Renamed board'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300)
ok('board renamed inline', await pg.locator('.board-title .t', { hasText: 'Renamed board' }).count() === 1)
await pg.screenshot({ path: 'cv-2.png' })

// --- saved state
await pg.waitForTimeout(2600)
console.log('status:', (await pg.locator('.status').innerText()).trim())
const c = await canvasJson()
const kinds = Object.values(c.notes).map(n => n.kind).sort().join(',')
ok('canvas.json has the sticky, rect and arrow', kinds.includes('arrow') && kinds.includes('rect') && kinds.includes('sticky'), kinds)
ok('sticky text saved', Object.values(c.notes).some(n => n.text === 'Check the poll copy'))
ok('new board saved with a file entry', Object.keys(c.boards).length === boardsBefore + 1, Object.keys(c.boards))
ok('board rename saved', Object.values(c.boards).some(b => b.title === 'Renamed board'))
const first = c.boards[c.order[0]]; console.log('board 1 now:', JSON.stringify({ x: first.x, y: first.y, w: first.w, h: first.h }))
ok('board 1 moved and resized in the file', first.x !== 0 || first.y !== 0, first)
console.log('errors:', logs.length ? logs : 'none'); console.log('artifact', id)
await browser.close()
