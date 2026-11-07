// Light and dark: the canvas chrome (canvas background, side panel, toolbar, new controls) renders readable in both themes.
import { open, ok, results, center } from './cvh.mjs'
const t = await open()
const { pg, stage, id } = t
const post = async (ops) => fetch(`${process.env.HUB}/api/artifacts/${id}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer devtoken' }, body: JSON.stringify({ baseVersion: await t.version(), ops }) })
await post([{ type: 'addNote', id: 'rr', note: { kind: 'rect', x: 700, y: 800, w: 200, h: 120, fill: 'yellow', text: 'Label' } }, { type: 'addNote', id: 'ar', note: { kind: 'arrow', x: 950, y: 860, w: 200, h: 40 } }])
await pg.reload(); await pg.waitForSelector('iframe'); await pg.waitForTimeout(1200); await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(600)
const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const probe = () => pg.evaluate(() => {
  const css = (el, p) => el && getComputedStyle(el)[p]
  const canvas = document.querySelector('.canvas'), panel = document.querySelector('.panel'), tb = document.querySelector('[data-toolbar]')
  const txt = [...document.querySelectorAll('.panel h3, .panel label, .panel .hint')].slice(0, 4)
  return { canvasBg: css(canvas, 'backgroundColor'), panelBg: css(panel, 'backgroundColor') === 'rgba(0, 0, 0, 0)' ? css(panel.parentElement, 'backgroundColor') : css(panel, 'backgroundColor'), panelText: txt.map(e => css(e, 'color')), toolbarBg: css(tb, 'backgroundColor'), toolbarIcon: css(tb?.querySelector('svg'), 'color') }
})
const out = {}
for (const theme of ['light', 'dark']) {
  await pg.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme); await pg.waitForTimeout(500)
  await pg.mouse.click(center(await pg.locator('svg.note.shape[data-id="rr"]').boundingBox()).x, center(await pg.locator('svg.note.shape[data-id="rr"]').boundingBox()).y); await pg.waitForTimeout(300)
  out[theme] = await probe()
  await pg.screenshot({ path: `theme-${theme}.png` })
  ok(`${theme}: the style panel is on screen`, await pg.locator('[aria-label="Stroke colour"]').first().isVisible())
  ok(`${theme}: panel text has at least 4.5:1 contrast with the panel`, out[theme].panelText.every(c => ratio(c, out[theme].panelBg) >= 4.5), [out[theme].panelText, out[theme].panelBg])
  ok(`${theme}: toolbar icons have at least 3:1 contrast with the toolbar`, ratio(out[theme].toolbarIcon, out[theme].toolbarBg) >= 3, [out[theme].toolbarIcon, out[theme].toolbarBg])
  // the selection overlay, guides and lock badge use colours that read on the canvas background
  const sel = await pg.evaluate(() => { const s = document.querySelector('.selbox'); return s ? getComputedStyle(s).borderTopColor : null })
  ok(`${theme}: a selection frame is drawn`, !!sel)
  ok(`${theme}: the selection frame has at least 3:1 contrast with the canvas`, sel && ratio(sel, out[theme].canvasBg) >= 3, [sel, out[theme].canvasBg])
  // an arrow with no stored colour follows the theme's ink and shows on this canvas
  const arrowStroke = await pg.locator('svg.note.vec[data-id="ar"] line').first().evaluate(e => getComputedStyle(e).stroke)
  ok(`${theme}: a default arrow is visible on the canvas (3:1)`, ratio(arrowStroke, out[theme].canvasBg) >= 3, [arrowStroke, out[theme].canvasBg])
  const row = await pg.evaluate(() => { const r = document.querySelector('.row.sel'); if (!r) return null; const cs = getComputedStyle(r); return { fg: cs.color, bg: cs.backgroundColor, panel: getComputedStyle(document.querySelector('.panel')).backgroundColor } })
  const over = (fg, bgc, base) => { const [r, g, b, a = 1] = bgc.match(/[\d.]+/g).map(Number), p = base.match(/[\d.]+/g).map(Number); return `rgb(${[0, 1, 2].map(i => Math.round([r, g, b][i] * a + p[i] * (1 - a))).join(', ')})` }
  ok(`${theme}: the selected layer row is readable (4.5:1)`, row && ratio(row.fg, over(row.fg, row.bg, out[theme].panelBg)) >= 4.5, row)
  const lbl = await pg.locator('.note.label').first().evaluate(e => getComputedStyle(e).color)
  ok(`${theme}: text inside a shape reads on its fill (dark text on the yellow fill)`, ratio(lbl, 'rgb(254, 243, 199)') >= 4.5, lbl)
}
ok('the canvas background differs between light and dark', out.light.canvasBg !== out.dark.canvasBg, [out.light.canvasBg, out.dark.canvasBg])
ok('the side panel differs between light and dark', out.light.panelBg !== out.dark.panelBg, [out.light.panelBg, out.dark.panelBg])
const clean = t.logs.filter(l => !/favicon|404/.test(l)); ok('no page errors', clean.length === 0, clean)
await t.browser.close(); process.exit(results.fails ? 1 : 0)
