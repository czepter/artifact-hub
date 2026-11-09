// Template panel for code-driven elements (loops, holes) against a running hub: HUB=http://127.0.0.1:3456 node tests/e2e/bt-template.mjs
import { launch, api, B, TOKEN } from './bh.mjs'
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 300)); if (!c) process.exitCode = 1 }
const board = `<x-dc><helmet><style>body{font:14px system-ui}</style></helmet>
<ul style="list-style:none;padding:0;margin:0"><sc-for list="{{rows}}" as="r"><li style="padding:8px"><span>{{r.name}}</span> <b class="rate">{{r.rate}} %</b></li></sc-for></ul>
<script type="text/x-dc" data-dc-script data-props='{"accent":{"editor":"color","default":"#3730a3"}}'>
class Component extends DCLogic { renderVals(){ return { rows: [{name:'A',rate:'1.5'},{name:'B',rate:'2.5'},{name:'C',rate:'3.5'}] } } }
</script></x-dc>`
const canvas = { v: 3, title: 'Rates', boards: { 'Rates.dc.html': { x: 0, y: 0, w: 600, h: 400, title: 'Rates' } }, order: ['Rates.dc.html'], notes: {} }
const mcp = async (name, args) => { const r = await fetch(`${B}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); const t = await r.text(); const j = JSON.parse(t.includes('data:') ? t.split('data:').pop() : t); return JSON.parse(j.result.content[0].text) }
const a = await mcp('create_artifact', { title: 'Rates', files: [{ path: 'canvas.json', content: JSON.stringify(canvas) }, { path: 'Rates.dc.html', content: board }] })
const ID = a.id
const stored = async () => (await api(`/api/artifacts/${ID}/source?path=Rates.dc.html`)).source
const { browser, page: pg, logs } = await launch({ viewport: { width: 1500, height: 900 } })
await pg.goto(`${B}/a/${ID}`); await pg.waitForSelector('iframe'); await pg.waitForTimeout(2000)
const fr = () => pg.frameLocator('iframe').first()
ok('board renders three rows', await fr().locator('li').count() === 3)
await pg.click('button:has-text("Edit")'); await pg.waitForTimeout(600)
await pg.locator('[data-board]').first().locator('.board-shield').dblclick(); await pg.waitForTimeout(1200)
await fr().locator('b.rate').first().click({ force: true }); await pg.waitForTimeout(900)
const panel = pg.locator('section[aria-label="Template"]')
ok('Template panel appears for a code-driven element', await panel.count() === 1)
ok('banner counts the repeated copies', (await panel.innerText()).includes('These 3 elements are rendered from one template node'), await panel.innerText())
ok('loop is listed with its list and variable', await panel.locator('input[value="{{rows}}"]').count() === 1 && await panel.locator('input[value="r"]').count() === 1)

// text with holes
const ta = panel.locator('textarea[aria-label="Template text"]')
ok('template text keeps its hole', (await ta.inputValue()) === '{{r.rate}} %', await ta.inputValue())
await ta.fill('{{r.rate}} % p.a.')
await panel.locator('button:has-text("Apply text")').click(); await pg.waitForTimeout(2500)
ok('the source holds the new text with its hole', (await stored()).includes('{{r.rate}} % p.a.</b>'), await stored())
ok('every row shows the new text after the reload', (await fr().locator('b.rate').allInnerTexts()).every(t => t.includes('p.a.')))

// edit the loop variable name via the panel
await fr().locator('b.rate').first().click({ force: true }); await pg.waitForTimeout(900)
const loopList = panel.locator('input[value="{{rows}}"]')
await loopList.fill('{{rows}}'); // unchanged: no save
await pg.waitForTimeout(300)
// attribute with a hole
await panel.locator('input[aria-label="New attribute name"]').fill('title')
await panel.locator('input[aria-label="New attribute value"]').fill('{{r.name}}')
await panel.locator('button[aria-label="Add attribute"]').click(); await pg.waitForTimeout(2500)
ok('attribute with a hole is saved on the template node', /<b[^>]*title="\{\{r\.name\}\}"/.test(await stored()), await stored())
ok('rows resolve the hole per item', (await fr().locator('b.rate').evaluateAll(els => els.map(e => e.title))).join() === 'A,B,C')

// make it conditional, then remove the condition
await fr().locator('b.rate').first().click({ force: true }); await pg.waitForTimeout(900)
await panel.locator('button:has-text("Show only if")').click()
await panel.locator('input[placeholder="{{show}}"]').fill('{{accent}}')
await panel.locator('button:has-text("Wrap element")').click(); await pg.waitForTimeout(2500)
ok('sc-if wraps the element in the source', /<sc-if value="\{\{accent\}\}">\s*<b/.test(await stored()), await stored())
await fr().locator('b.rate').first().click({ force: true }); await pg.waitForTimeout(900)
ok('condition is listed', await panel.locator('input[value="{{accent}}"]').count() === 1)
await panel.locator('button[aria-label="Remove sc-if"]').click(); await pg.waitForTimeout(2500)
ok('removing the condition keeps the content', !(await stored()).includes('sc-if') && (await stored()).includes('class="rate"'))

// loop list edit
await fr().locator('b.rate').first().click({ force: true }); await pg.waitForTimeout(900)
await panel.locator('input[value="{{rows}}"]').fill('{{items}}'); await panel.locator('input[value="{{items}}"]').press('Tab'); await pg.waitForTimeout(2500)
ok('loop list changes in the source', (await stored()).includes('<sc-for list="{{items}}" as="r">'), await stored())
await pg.screenshot({ path: process.env.SHOT || 'bt-template.png' })
ok('no console errors', logs.length === 0, logs)
await browser.close()
await api(`/api/artifacts/${ID}`, undefined, 'DELETE')
