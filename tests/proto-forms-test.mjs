// Click-dummy runtime, part two: control triggers, conditions, facets, press/focus holds, drawers, popovers and dismissal.
// Run: npx tsx tests/proto-forms-test.mjs
import http from 'node:http'
import { chromium } from 'playwright-core'
import { instrumentHtml } from '../server/utils/frame.ts'

let fails = 0
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 300)); if (!c) fails++ }

const form = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}button,input,select{margin:4px}</style></head><body>
<div id="plan" data-hub-component="Plan" data-hub-state="none">
  <select id="sel" data-hub-change="state:Plan={value}"><option value="none">-</option><option value="free">Free</option><option value="pro">Pro</option></select>
  <span id="proNote" data-hub-show="pro">Pro includes support</span><span id="freeNote" data-hub-show="free">Free is free</span>
</div>
<div id="radios" data-hub-component="Size" data-hub-state="s" data-hub-change="state:Size={value}">
  <label><input type="radio" name="size" value="s" checked>S</label><label><input type="radio" name="size" value="l" id="rl">L</label>
  <b id="isL" data-hub-show="l">large</b>
</div>
<div data-hub-component="Terms" data-hub-state="off"><label><input id="terms" type="checkbox" data-hub-change="state:Terms={value}">agree</label><i id="agreed" data-hub-show="on">thanks</i></div>
<form id="f" data-hub-component="Form" data-hub-state="idle">
  <input id="email" type="email" required placeholder="mail" data-hub-input="state:Form.mail=filled if self:filled; state:Form.mail=empty if self:empty" data-hub-focus="state:Form.focus=on">
  <span id="focusOn" data-hub-show="focus:on" style="position:absolute;right:0;top:0">focused</span>
  <button type="button" id="submit" data-hub-click="state:Form=sent if #email:valid & #terms:checked; state:Form=error unless #email:valid; state:Form=terms if #email:valid & #terms:unchecked">Send</button>
  <span id="sent" data-hub-show="sent">sent!</span><span id="err" data-hub-show="error">bad mail</span><span id="needTerms" data-hub-show="terms">accept the terms</span>
  <span id="filled" data-hub-show="mail:filled">has text</span>
</form>
<div id="tabs" data-hub-component="Tabs" data-hub-state="tab:a menu:closed" data-hub-dismiss="outside escape">
  <button id="tabB" data-hub-click="state:Tabs.tab=b">B</button>
  <button id="dd" data-hub-click="toggle:Tabs.menu=open">More</button>
  <ul id="menuList" data-hub-show="menu:open"><li>x</li></ul>
  <p id="paneA" data-hub-show="tab:a">A</p><p id="paneB" data-hub-show="tab:b">B</p>
</div>
<button id="press" data-hub-component="Btn" data-hub-state="rest" data-hub-press="state:self=down"><span id="down" data-hub-show="down">down</span><span id="rest" data-hub-show="rest">rest</span></button>
<button id="openDrawer" data-hub-click="open:#drawer">drawer</button>
<aside id="drawer" data-hub-modal="drawer-right" style="width:300px"><button id="dclose" data-hub-click="close">x</button></aside>
<button id="openPop" data-hub-click="open:#pop">pop</button>
<div id="pop" data-hub-modal="popover"><a id="popItem">item</a></div>
<button id="openFree" data-hub-click="open:#free">free</button>
<div id="free" data-hub-modal="free" data-hub-dismiss="outside" style="position:fixed;right:0;top:0">panel</div>
<button id="openSheet" data-hub-click="open:#sheet">sheet</button>
<div id="sheet" data-hub-modal="sheet" data-hub-dismiss="none">sheet</div>
<p id="plain" style="margin-top:300px">out</p>
<input id="name" data-hub-change="go:Next.html if self:filled">
</body></html>`
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html')
  if (req.url === '/') { res.end('<!doctype html><iframe id="f" src="/Form.html" style="width:900px;height:900px;border:0"></iframe><script>window.msgs=[];addEventListener("message",e=>{if(e.data&&e.data.type==="hub:navigate")msgs.push(e.data)})</script>'); return }
  if (req.url.startsWith('/Form.html')) { res.end(instrumentHtml(form)); return }
  res.statusCode = 404; res.end()
})
await new Promise(r => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1000, height: 1000 } })
pg.on('pageerror', e => { console.log('PAGEERR', e.message); fails++ })
await pg.goto(base + '/'); await pg.waitForTimeout(300)
const f = pg.frameLocator('#f')
const vis = (s) => f.locator(s).isVisible()

// select / radio / checkbox drive states
ok('select starts at none', !(await vis('#proNote')) && !(await vis('#freeNote')))
await f.locator('#sel').selectOption('pro')
ok('select sets the state to its value', await vis('#proNote') && !(await vis('#freeNote')))
await f.locator('#sel').selectOption('free')
ok('select switches again', await vis('#freeNote') && !(await vis('#proNote')))
ok('radios start on the first option', !(await vis('#isL')))
await f.locator('#rl').check()
ok('radio change sets the state, even from a wrapper', await vis('#isL'))
await f.locator('#terms').check()
ok('checkbox gives on', await vis('#agreed'))
await f.locator('#terms').uncheck()
ok('checkbox gives off', !(await vis('#agreed')))

// conditions
await f.locator('#submit').click()
ok('invalid email: unless branch runs', await vis('#err') && !(await vis('#sent')) && !(await vis('#needTerms')))
await f.locator('#email').fill('a@b.co')
ok('input trigger with conditions (filled facet)', await vis('#filled'))
await f.locator('#submit').click()
ok('valid email but terms unchecked', await vis('#needTerms') && !(await vis('#sent')) && !(await vis('#err')))
await f.locator('#terms').check()
await f.locator('#submit').click()
ok('both conditions met', await vis('#sent') && !(await vis('#needTerms')))
await f.locator('#email').fill('')
ok('empty branch of the same input trigger', !(await vis('#filled')))
await pg.evaluate(() => { window.msgs.length = 0 })
await f.locator('#name').fill(''); await f.locator('#name').dispatchEvent('change'); await pg.waitForTimeout(100)
ok('a go that fails its condition does nothing', (await pg.evaluate(() => window.msgs)).length === 0)
await f.locator('#name').fill('x'); await f.locator('#name').dispatchEvent('change'); await pg.waitForTimeout(100)
ok('and goes when it holds', (await pg.evaluate(() => window.msgs)).length === 1)

// focus is a hold
await f.locator('#email').focus()
ok('focus applies while focused', await vis('#focusOn'))
await f.locator('#plain').click()
ok('focus state reverts on blur', !(await vis('#focusOn')))

// facets are independent
ok('two facets in one component', await vis('#paneA') && !(await vis('#paneB')) && !(await vis('#menuList')))
await f.locator('#tabB').click()
ok('changing one facet keeps the other', await vis('#paneB') && !(await vis('#paneA')) && !(await vis('#menuList')))
await f.locator('#dd').click()
ok('the other facet toggles on its own', await vis('#menuList') && await vis('#paneB'))
await f.locator('#plain').click()
ok('dismiss outside resets the component to its start', !(await vis('#menuList')) && await vis('#paneA') && !(await vis('#paneB')))
await f.locator('#dd').click()
ok('open again', await vis('#menuList'))
await pg.keyboard.press('Escape')
ok('Escape resets it too', !(await vis('#menuList')))
await f.locator('#dd').click(); await f.locator('#dd').click()
ok('toggle closes it again', !(await vis('#menuList')))

// pressed state
const box = await f.locator('#press').boundingBox()
await pg.mouse.move(box.x + 5, box.y + 5); await pg.mouse.down()
ok('press holds while the button is down', await vis('#down') && !(await vis('#rest')))
await pg.mouse.up()
ok('press reverts on release', await vis('#rest') && !(await vis('#down')))

// drawer
await f.locator('#openDrawer').click(); await pg.waitForTimeout(450)
const d = await f.locator('#drawer').boundingBox()
ok('drawer sits at the right edge, full height', Math.abs(d.x + d.width - 908) < 2 && d.y === 8 && d.height >= 899, d)
await f.locator('#plain').click({ position: { x: 5, y: 5 } })
ok('click outside closes the drawer', !(await vis('#drawer')))
await f.locator('#openDrawer').click(); await pg.keyboard.press('Escape')
ok('Escape closes the drawer', !(await vis('#drawer')))

// popover anchored to its opener
await f.locator('#openPop').click()
const pb = await f.locator('#pop').boundingBox(), ob = await f.locator('#openPop').boundingBox()
ok('popover opens under the element that opened it', Math.abs(pb.x - ob.x) < 3 && pb.y >= ob.y + ob.height && pb.y < ob.y + ob.height + 12, [pb, ob])
await f.locator('#popItem').click()
ok('clicks inside keep it open', await vis('#pop'))
await f.locator('#openPop').click()
ok('the opener toggles it closed', !(await vis('#pop')))
await f.locator('#openPop').click(); await f.locator('#plain').click()
ok('click outside closes the popover', !(await vis('#pop')))

// free and sheet
await f.locator('#openFree').click()
ok('free overlay opens', await vis('#free'))
await f.locator('#plain').click()
ok('free overlay closes on outside click when asked', !(await vis('#free')))
await f.locator('#openSheet').click()
await f.locator('#plain').click({ force: true })
ok('dismiss none keeps a sheet open', await vis('#sheet'))
await pg.keyboard.press('Escape')
ok('and so does Escape, when dismiss is none', await vis('#sheet'))

await browser.close(); server.close()
process.exit(fails ? 1 : 0)
