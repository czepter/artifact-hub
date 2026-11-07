// Shared helpers for the canvas browser tests (bt-selection, bt-multiresize, ...).
import { launch, api, B } from './bh.mjs'
export { B }
export const results = { fails: 0 }
export const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400)); if (!c) results.fails++ }
export async function open(opts = {}) {
  const list = await api('/api/artifacts')
  const src = list.find(a => a.title === 'Test canvas')
  const dup = await api(`/api/artifacts/${src.id}/duplicate`, {}, 'POST')
  const id = dup.id
  const { browser, page: pg, logs } = await launch({ viewport: { width: 1500, height: 920 } })
  await pg.goto(`${B}/a/${id}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(900)
  await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(600)
  const stage = await pg.locator('.canvas').boundingBox()
  const view = () => api(`/api/view/${id}`)
  const version = async () => (await view()).artifact.version
  const canvas = async () => (await view()).canvas
  /** Waits until the editor reports saved (the viewer saves 1.2 s after the last change). */
  const settle = async (ms = 3200) => { await pg.waitForTimeout(ms) }
  return { id, browser, pg, logs, stage, view, version, canvas, settle }
}
/** Positions of everything that can move, to compare before/after an undo. */
export const geom = (c) => JSON.stringify({ b: Object.fromEntries(Object.entries(c.boards).map(([k, v]) => [k, [v.x, v.y, v.w, v.h]])), n: Object.fromEntries(Object.entries(c.notes).map(([k, v]) => [k, [v.x, v.y, v.w, v.h, v.points ?? null]])) })
export async function drag(pg, from, to, { steps = 8, mods = [] } = {}) {
  for (const m of mods) await pg.keyboard.down(m)
  await pg.mouse.move(from.x, from.y); await pg.mouse.down()
  await pg.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps }); await pg.mouse.move(to.x, to.y, { steps })
  await pg.mouse.up()
  for (const m of mods) await pg.keyboard.up(m)
}
export const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
