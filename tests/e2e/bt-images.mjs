// Phase 3: pasted and dropped pictures: shrunk, stored with the save that places them (one undo step), and the server's limits.
import { open, ok, results, geom } from './cvh.mjs'
import { createHash } from 'node:crypto'
const t = await open()
const { pg, stage, id } = t
const empty = { x: stage.x + 15, y: stage.y + 300 }
const mkPng = (w, h) => pg.evaluate(async ([w, h]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#3b82f6'); g.addColorStop(1, '#f97316'); x.fillStyle = g; x.fillRect(0, 0, w, h)
  const b = await new Promise(r => c.toBlob(r, 'image/png')); return Array.from(new Uint8Array(await b.arrayBuffer()))
}, [w, h])
const firePaste = (bytes, type = 'image/png') => pg.evaluate(([bytes, type]) => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], 'p.png', { type })); const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented }, [bytes, type])
const g0 = geom(await t.canvas()), v0 = await t.version()

// not editing the canvas: a stray paste is left alone
const early = await firePaste(await mkPng(40, 40))
ok('a paste before the canvas was clicked is not taken', early === false)
await pg.mouse.click(empty.x, empty.y)
const big = await mkPng(3200, 1800)
ok('pasting a picture is handled', await firePaste(big) === true)
await t.settle(4500)
let c = await t.canvas()
const imgs = Object.entries(c.notes).filter(([, n]) => n.kind === 'image')
ok('one image note, stored in assets/, placed in one version', imgs.length === 1 && /^assets\/[a-f0-9]{16}\.png$/.test(imgs[0][1].src) && await t.version() === v0 + 1, [imgs, await t.version()])
const view = await t.view()
ok('the file is in the artifact', view.files.some(f => f.path === imgs[0][1].src), view.files.map(f => f.path))
const raw = Buffer.from(await (await fetch(`${process.env.HUB}${view.frameBase}${imgs[0][1].src}`, { headers: { authorization: 'Bearer devtoken' } })).arrayBuffer())
ok('it was shrunk to 2048 px on its long side (PNG header)', raw.readUInt32BE(16) === 2048 && raw.readUInt32BE(20) === 1152, [raw.readUInt32BE(16), raw.readUInt32BE(20)])
ok('its name is the hash of its bytes', createHash('sha256').update(raw).digest('hex').slice(0, 16) === imgs[0][1].src.slice(7, 23))
ok('it is drawn on the canvas and loads', await pg.waitForFunction(() => { const i = document.querySelector('.note.image img'); return i && i.complete && i.naturalWidth > 0 }, null, { timeout: 8000 }).then(() => true).catch(() => false))
ok('the picture note is 480 px wide at most, in proportion', imgs[0][1].w <= 480.1 && Math.abs(imgs[0][1].w / imgs[0][1].h - 3200 / 1800) < 0.02, imgs[0][1])
await pg.keyboard.press('Control+z'); await t.settle(2800)
ok('one undo removes the picture note', geom(await t.canvas()) === g0 && Object.values((await t.canvas()).notes).every(n => n.kind !== 'image'))

// drop
await pg.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 200; c.getContext('2d').fillRect(0, 0, 300, 200)
  const b = await new Promise(r => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer(); dt.items.add(new File([b], 'd.png', { type: 'image/png' }))
  const el = document.querySelector('.canvas'); const r = el.getBoundingClientRect()
  el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: r.left + 300, clientY: r.top + 500, bubbles: true, cancelable: true }))
})
await t.settle(4500)
c = await t.canvas()
ok('dropping a picture places it where it was dropped', Object.values(c.notes).filter(n => n.kind === 'image').length === 1)

// text is not a picture
ok('pasting text does nothing', await firePaste([104, 105], 'text/plain') === false)

// Ctrl+C on the canvas, then a picture on the system clipboard: the picture wins; a plain Ctrl+V pastes the copied note
const dropped = Object.entries((await t.canvas()).notes).find(([, n]) => n.kind === 'image')
const ib = await pg.locator(`.note.image[data-id="${dropped[0]}"]`).boundingBox()
await pg.mouse.click(ib.x + ib.width / 2, ib.y + ib.height / 2)
await pg.keyboard.press('Control+c')
await pg.mouse.move(empty.x + 200, empty.y)
const vP = await t.version()
ok('a picture on the clipboard is pasted even after Ctrl+C on the canvas', await firePaste(await mkPng(500, 300)) === true)
await t.settle(4000)
const cc = await t.canvas()
ok('...as a new picture, in one version', Object.values(cc.notes).filter(n => n.kind === 'image').length === 2 && await t.version() === vP + 1)
await pg.mouse.click(empty.x, empty.y); await pg.mouse.move(empty.x + 200, empty.y + 40)
await pg.keyboard.press('Control+v'); await t.settle(3500)
ok('Ctrl+V without a picture on the clipboard pastes the copied note', Object.values((await t.canvas()).notes).filter(n => n.kind === 'image').length === 3)


// the server's limits
const api = (body) => fetch(`${process.env.HUB}/api/artifacts/${id}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer devtoken' }, body: JSON.stringify(body) })
const png = Buffer.from(Uint8Array.from(await mkPng(20, 20)))
const name = 'assets/' + createHash('sha256').update(png).digest('hex').slice(0, 16) + '.png'
const op = (src) => ({ type: 'addNote', id: 'srv' + Math.random().toString(36).slice(2, 6), note: { kind: 'image', src, x: 0, y: 0, w: 20, h: 20 } })
let r = await api({ baseVersion: await t.version(), ops: [op('assets/0000000000000000.png')] })
ok('an image note whose file was not uploaded is refused', r.status === 400, r.status)
r = await api({ baseVersion: await t.version(), ops: [op(name)], files: [{ path: name, content: png.toString('base64') }] })
ok('with the upload it is accepted', r.status === 200, r.status)
r = await api({ baseVersion: await t.version(), ops: [op(name)], files: [{ path: 'assets/1111111111111111.png', content: png.toString('base64') }] })
ok('a name that does not match the content is refused', r.status === 400, r.status)
r = await api({ baseVersion: await t.version(), ops: [op('assets/2222222222222222.png')], files: [{ path: 'assets/2222222222222222.png', content: Buffer.from('not an image at all').toString('base64') }] })
ok('bytes that are not an image are refused', r.status === 400, r.status)
const huge = Buffer.concat([Buffer.from('89504e47', 'hex'), Buffer.alloc(5 * 1024 * 1024 + 10, 1)])
const hname = 'assets/' + createHash('sha256').update(huge).digest('hex').slice(0, 16) + '.png'
r = await api({ baseVersion: await t.version(), ops: [op(hname)], files: [{ path: hname, content: huge.toString('base64') }] })
ok('a picture over 5 MB is refused', r.status === 413, r.status)
r = await api({ baseVersion: await t.version(), ops: [op(name)], files: Array.from({ length: 6 }, () => ({ path: name, content: png.toString('base64') })) })
ok('more than 5 pictures in one edit is refused', r.status === 400, r.status)
r = await api({ baseVersion: await t.version(), ops: [op(name)], files: [{ path: 'screens/evil.html', content: Buffer.from('<script>').toString('base64') }] })
ok('only assets/<hash>.<image> paths may be uploaded', r.status === 400, r.status)
// an older image note whose file is missing can still be moved
{
  const v = await t.version()
  const base = (await t.canvas())
  const r0 = await api({ baseVersion: v, ops: [{ type: 'updateNote', id: Object.keys(base.notes).find(k => base.notes[k].kind === 'image'), patch: { x: 7 } }] })
  ok('moving an existing image note is a plain update', r0.status === 200, r0.status)
}
const clean = t.logs.filter(l => !/favicon|404/.test(l)); ok('no page errors', clean.length === 0, clean)
await t.browser.close(); process.exit(results.fails ? 1 : 0)
