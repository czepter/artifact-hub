// Unit tests for native rendering: scene -> svg / xml, text wrapping, escaping, rasterizing. No server needed:
//   npx tsx tests/e2e/render-unit.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { buildScene, sceneToSvg, sceneToXml, wrapText, esc, RenderError, type RenderEnv } from '../../shared/canvasRender'
import { parseFace, measurer } from '../../server/utils/render/font'
import { htmlOutline } from '../../server/utils/render/outline'
import { rasterize } from '../../server/utils/render/raster'

let fails = 0
const ok = (n: string, c: any, x: any = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 300)); if (!c) fails++ }

const FONTS = { regular: 'server/assets/fonts/LiberationSans-Regular.ttf', bold: 'server/assets/fonts/LiberationSans-Bold.ttf' }
const measure = measurer({ regular: parseFace(readFileSync(FONTS.regular)), bold: parseFace(readFileSync(FONTS.bold)) } as any)
const env: RenderEnv = { measure, image: () => null, boardText: () => [{ text: 'Team lunch', size: 32, bold: true }, { text: 'Where should we eat on Friday?', size: 16, bold: false }] }

// --- text measuring uses the real font's metrics
ok('measure: "Hello" at 16px in Liberation Sans is about 36px (Arial metrics)', Math.abs(measure('Hello', 16, false) - 35.6) < 1, measure('Hello', 16, false))
ok('measure: bold is wider than regular', measure('Hello world', 16, true) > measure('Hello world', 16, false))
ok('measure: unknown glyphs still count (CJK is 0.6 em)', measure('日本', 10, false) > 8)

// --- wrapping
const w = wrapText('the quick brown fox jumps over the lazy dog', 100, 16, false, measure)
ok('wrapText breaks at spaces within the width', w.length > 2 && w.every(l => measure(l, 16, false) <= 100.5), w)
ok('wrapText keeps explicit newlines and empty lines', wrapText('a\n\nb', 100, 16, false, measure).join('|') === 'a||b')
ok('wrapText breaks a word wider than the box by character', wrapText('supercalifragilisticexpialidocious', 60, 16, false, measure).length > 1)

// --- a scene
const canvas = {
  title: 'Demo <&> "x"',
  boards: { 'a.html': { x: 0, y: 0, w: 400, h: 300, title: 'Board <b>A</b>' }, 'b.html': { x: 600, y: 0, w: 300, h: 300 } },
  order: ['a.html', 'b.html'],
  notes: {
    s: { kind: 'sticky', x: 0, y: -200, w: 200, text: 'Hello <script>alert(1)</script> & "quotes"', fill: 'blue' },
    t: { kind: 'text', x: 250, y: -200, w: 300, text: 'Heading', size: 'xl', bold: true, color: '#aa0000' },
    r: { kind: 'rect', x: 0, y: 400, w: 160, h: 80, text: 'Label', fill: 'green', fillStyle: 'hatch' },
    o: { kind: 'oval', x: 200, y: 400, w: 160, h: 80, fill: '#ff8800' },
    a: { kind: 'arrow', x: 0, y: 0, w: 1, h: 1, bind: { start: { type: 'board', id: 'a.html' }, end: { type: 'board', id: 'b.html' } } },
    l: { kind: 'line', x: 400, y: 400, w: -100, h: 60, strokeStyle: 'dashed' },
    p: { kind: 'pen', x: 500, y: 400, points: [[0, 0], [10, 20], [30, 5]] },
    i: { kind: 'image', x: 700, y: -200, w: 100, h: 60, src: 'assets/0123456789abcdef.png' },
  },
  noteOrder: ['s', 't', 'r', 'o', 'a', 'l', 'p', 'i'],
}
const scene = buildScene(canvas, env, {})
ok('scene: both boards and all notes', scene.boards.length === 2 && scene.notes.length === 8, [scene.boards.length, scene.notes.length])
ok('scene: no browser -> boards are outlines with the page text', scene.boards.every(b => b.render === 'outline') && scene.boards[0]!.outline[0]!.text === 'Team lunch')
const arrow = scene.notes.find(n => n.id === 'a')!
ok('scene: a bound arrow runs from the edge of one board to the edge of the other', arrow.x > 400 && arrow.x < 420 && arrow.x + arrow.w > 580 && arrow.x + arrow.w < 600, arrow)
ok('scene: the view covers boards, notes and titles with padding', scene.view.x <= -48 && scene.view.y <= -250 && scene.view.x + scene.view.w >= 900 + 48, scene.view)
const svg = sceneToSvg(scene, { scale: 2 })
ok('svg: well-formed header, viewBox and doubled pixel size', /^<\?xml[^>]*\?>\s*<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+" viewBox="-5\d/.test(svg), svg.slice(0, 200))
ok('svg: text is escaped, never markup', !svg.includes('<script') && svg.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && svg.includes('&amp; &quot;quotes&quot;'), svg.match(/<tspan[^>]*>[^<]*<\/tspan>/g)?.slice(0, 3))
ok('svg: no scripts, event handlers, foreignObject or external references', !/<script|foreignObject|\son[a-z]+=|href="https?:|xlink:href|url\(http/i.test(svg))
ok('svg: titles with markup are escaped', svg.includes('Board &lt;b&gt;A&lt;/b&gt;') && svg.includes('<title>Demo &lt;&amp;&gt; &quot;x&quot;</title>'))
ok('svg: hatch pattern defined once and used', (svg.match(/<pattern /g) ?? []).length === 1 && svg.includes('fill="url(#hatch-0)"'))
ok('svg: missing image draws a placeholder, not a broken reference', svg.includes('image missing') && !svg.includes('0123456789abcdef'))
ok('svg: default ink follows the theme (dark)', sceneToSvg(buildScene({ boards: {}, notes: { x: { kind: 'text', x: 0, y: 0, w: 100, text: 'hi' } } }, env, { theme: 'dark' })).includes('fill="#f2f2f2"'))
ok('svg: transparent background draws no backdrop rect', !sceneToSvg(buildScene(canvas, env, { background: 'transparent' })).includes(`fill="#e6e6e6"`) && sceneToSvg(scene).includes('fill="#e6e6e6"'))

// --- hostile input
const evil = buildScene({
  title: '\u0000\u0001<\uD800>', boards: { 'x"><script>.html': { x: 'NaN', y: Infinity, w: 1e12, h: -5, title: '"><svg onload=alert(1)>' } },
  notes: { '"><script>': { kind: 'sticky', text: '\u0007bell 😀 emoji \uDC00', x: 1e99, y: 'abc', fill: 'url(javascript:1)', color: 'red;}</style><script>', stroke: 'javascript:x' }, ok: { kind: 'rect', x: 0, y: 0, w: 50, h: 50, stroke: 'expression(1)', fill: '#12345' } },
}, env, {})
const esvg = sceneToSvg(evil), exml = sceneToXml(evil)
const tagsOk = (m: string) => !/<(?!\/?(svg|title|rect|g|text|tspan|ellipse|line|path|polygon|circle|image|defs|pattern|scene|board|note|outline|text|points|p|bind)\b|\?xml)/.test(m) && !/\son[a-z]+\s*=\s*["']/i.test(m) && !/javascript:|expression\(/i.test(m.replace(/&lt;[^&]*&gt;/g, ''))
ok('hostile: ids, titles, colours and numbers cannot break out of attributes', tagsOk(esvg) && tagsOk(exml), esvg.slice(0, 600))
ok('hostile: control characters and lone surrogates are dropped; real emoji kept', !/[\u0000-\u0008]/.test(esvg + exml) && esvg.includes('😀') && !/\uDC00(?<![\uD800-\uDBFF]\uDC00)/.test(esvg))
ok('hostile: sizes are clamped', evil.boards[0]!.w === 8000 && evil.boards[0]!.h === 1 && Number.isFinite(evil.view.w))
ok('esc: every xml special', esc(`<>&"'`) === '&lt;&gt;&amp;&quot;&apos;')

// --- xml
const xml = sceneToXml(scene, { artifact: 'abc', version: 3 })
ok('xml: root with namespace, version and size', /<scene xmlns="urn:artifact-hub:scene:1" version="1" artifact="abc" artifactVersion="3"/.test(xml) && /width="\d/.test(xml))
ok('xml: boards, notes and bindings in order', xml.indexOf('<board path="a.html"') < xml.indexOf('<board path="b.html"') && xml.indexOf('<note id="s"') < xml.indexOf('<note id="i"') && /<bind end="start" type="board" target="a.html"\/>/.test(xml), xml.slice(0, 600))
ok('xml: outline text for boards without a picture', /<outline>\s*<line size="32" bold="true">Team lunch<\/line>/.test(xml))
ok('xml: text content escaped', xml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))

// --- single board and page
const one = buildScene(canvas, env, { board: 'b.html' })
ok('board: view is exactly the board, no notes, no title', one.view.w === 300 && one.view.h === 300 && one.notes.length === 0 && !one.titles)
let threw = 0; try { buildScene(canvas, env, { board: 'nope.html' }) } catch (e) { threw = e instanceof RenderError ? e.status : -1 }
ok('board: unknown board -> RenderError 404', threw === 404)
const page = buildScene(null, env, { page: { w: 1000, h: 700 } })
ok('page artifact: one board at the page size, no padding', page.boards.length === 1 && page.view.w === 1000 && page.view.h === 700)
ok('empty canvas: a placeholder, not an error', buildScene({ boards: {}, notes: {} }, env, {}).empty && sceneToSvg(buildScene({ boards: {}, notes: {} }, env, {})).includes('Empty canvas'))

// --- html outline
const ol = htmlOutline('<html><head><style>x{}</style><title>t</title></head><body><h1>Title</h1><script>boom()</script><div>loose <b>bold</b> text<p>Para <a href=#>link</a></p></div><img alt="logo"></body></html>')
ok('outline: headings, paragraphs and images in order; scripts/styles skipped', ol.map(l => l.text).join('|') === 'Title|loose|bold|text|Para link|[image: logo]' && ol[0]!.size === 32 && !JSON.stringify(ol).includes('boom'), ol)

// --- rasterizing: real pixels
const dir = process.env.RENDER_OUT || ''
if (dir) mkdirSync(dir, { recursive: true })
const png = await rasterize(svg, { format: 'png', scale: 1, background: 'canvas', quality: 85 }, scene.view.w, scene.view.h, FONTS)
ok('png: valid signature, size follows scale', png.body.readUInt32BE(0) === 0x89504e47 && png.width === Math.round(scene.view.w) && png.height === Math.round(scene.view.h), [png.width, png.height])
const { Resvg } = await import('@resvg/resvg-js')
const px = new Resvg(png.body.length ? svg : svg, { fitTo: { mode: 'width', value: 400 }, font: { fontFiles: [FONTS.regular, FONTS.bold], loadSystemFonts: false } }).render()
const at = (x: number, y: number) => { const i = (y * px.width + x) * 4; return [...px.pixels.slice(i, i + 4)] }
const st = scene.notes.find(n => n.id === 's')!, sx = Math.round((st.x + st.w - 12 - scene.view.x) / scene.view.w * px.width), sy = Math.round((st.y + st.h - 12 - scene.view.y) / scene.view.w * px.width)
ok('png pixels: the blue sticky is blue where it should be, the canvas is grey elsewhere', (() => { const c = at(sx, sy); return c[2]! > c[0]! && c[2]! > 200 })() && at(2, 2).join() === '230,230,230,255', [at(sx, sy), at(2, 2)])
const tiny = await rasterize(svg, { format: 'png', scale: 4, max: 300, background: 'canvas', quality: 85 }, scene.view.w, scene.view.h, FONTS)
ok('png: max lowers the scale to fit the longest edge', Math.max(tiny.width, tiny.height) <= 300 && tiny.scale < 4, [tiny.width, tiny.height, tiny.scale])
const huge = await rasterize(`<svg xmlns="http://www.w3.org/2000/svg" width="40000" height="40000" viewBox="0 0 40000 40000"><rect width="40000" height="40000" fill="red"/></svg>`, { format: 'png', scale: 4, background: 'canvas', quality: 50 }, 40000, 40000, FONTS)
ok('png: huge canvases are capped (edge and pixel count)', huge.width <= 8192 && huge.height <= 8192 && huge.width * huge.height <= 36_000_000, [huge.width, huge.height])
const webp = await rasterize(svg, { format: 'webp', scale: 1, background: 'canvas', quality: 80 }, scene.view.w, scene.view.h, FONTS)
ok('webp: RIFF/WEBP container', webp.body.toString('latin1', 0, 4) === 'RIFF' && webp.body.toString('latin1', 8, 12) === 'WEBP' && webp.body.length < png.body.length * 2, webp.body.length)
const jpg = await rasterize(svg, { format: 'jpeg', scale: 0.5, background: 'transparent', quality: 80 }, scene.view.w, scene.view.h, FONTS)
ok('jpeg: JPEG signature', jpg.body[0] === 0xff && jpg.body[1] === 0xd8)
if (dir) { writeFileSync(`${dir}/scene.svg`, svg); writeFileSync(`${dir}/scene.png`, png.body); writeFileSync(`${dir}/scene.webp`, webp.body); writeFileSync(`${dir}/scene.xml`, xml); writeFileSync(`${dir}/scene.jpg`, jpg.body) }

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS'); process.exit(fails ? 1 : 0)
