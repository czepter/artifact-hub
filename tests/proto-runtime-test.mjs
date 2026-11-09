// Click-dummy runtime in a real browser: hotspots, component states, hover, overlays, timers, messages to the viewer.
// Run: npx tsx tests/proto-runtime-test.mjs
import http from 'node:http'
import { chromium } from 'playwright-core'
import { instrumentHtml } from '../server/utils/frame.ts'

let fails = 0
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 300)); if (!c) fails++ }

const pages = {
  '/Home.html': `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}.box{width:200px;height:60px;background:#eee}</style></head><body>
  <div id="menu" data-hub-component="Menu" data-hub-state="closed">
    <button id="burger" data-hub-click="toggle:Menu=open">Menu</button>
    <ul id="items" data-hub-show="open"><li>One</li></ul>
    <span id="closedHint" data-hub-hide="open">tap the menu</span>
  </div>
  <button id="go" data-hub-click="go:Detail.html|slide-left">Go</button>
  <button id="back" data-hub-click="back">Back</button>
  <button id="openModal" data-hub-click="open:#dlg">Open</button>
  <div id="dlg" data-hub-modal><div id="card"><button id="closeBtn" data-hub-click="close">Close</button></div></div>
  <button id="openBoard" data-hub-click="open:Sheet.html">Sheet</button>
  <div id="hov" class="box" data-hub-component="Card" data-hub-state="rest" data-hub-hover="state:self=hover"><span id="label" data-hub-show="rest">rest</span><span id="hlabel" data-hub-show="hover">hover</span></div>
  <div id="splash" data-hub-after="400 go:Detail.html|none">splash</div>
  <p id="plain">nothing here</p>
  </body></html>`,
  '/Detail.html': '<!doctype html><html><body>detail</body></html>',
  '/Sheet.html': '<!doctype html><html><body style="background:transparent"><button id="sheetClose" data-hub-click="close" style="position:fixed;left:10px;top:10px">x</button><button id="sheetGo" data-hub-click="go:Detail.html|fade" style="position:fixed;left:10px;top:60px">y</button></body></html>',
}
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><iframe id="f" src="/Home.html" style="width:800px;height:600px;border:0"></iframe><script>window.msgs=[];addEventListener("message",e=>{if(e.data&&String(e.data.type).startsWith("hub:navigate")||e.data&&e.data.type==="hub:back")msgs.push(e.data)});window.send=m=>document.getElementById("f").contentWindow.postMessage(m,"*")</script>'); return }
  const p = pages[req.url.split('?')[0]]
  if (!p) { res.statusCode = 404; res.end(); return }
  res.setHeader('content-type', 'text/html'); res.end(instrumentHtml(p))
})
await new Promise(r => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch()
const pg = await browser.newPage()
pg.on('pageerror', e => { console.log('PAGEERR', e.message); fails++ })
await pg.goto(base + '/')
const f = pg.frameLocator('#f')
await pg.waitForTimeout(300)
const vis = async (sel) => f.locator(sel).isVisible()

// component states
ok('closed menu: items hidden, hint shown', !(await vis('#items')) && await vis('#closedHint'))
await f.locator('#burger').click()
ok('toggle opens the menu', await vis('#items') && !(await vis('#closedHint')))
await f.locator('#burger').click()
ok('toggle again returns to the initial state', !(await vis('#items')) && await vis('#closedHint'))

// hover reverts on leave
await f.locator('#hov').hover()
ok('hover state applies', await vis('#hlabel') && !(await vis('#label')))
await pg.mouse.move(700, 500)
ok('hover state reverts when the pointer leaves', await vis('#label') && !(await vis('#hlabel')))

// modal element
await f.locator('#openModal').click()
ok('modal element opens as an overlay', await vis('#card'))
await f.locator('#closeBtn').click()
ok('close hides it', !(await vis('#card')))
await f.locator('#openModal').click()
await pg.keyboard.press('Escape')
ok('Escape closes it', !(await vis('#card')))
await f.locator('#openModal').click()
await f.locator('#dlg').click({ position: { x: 5, y: 5 } })
ok('a click on the backdrop closes it', !(await vis('#card')))

// board overlay in a frame
await f.locator('#openBoard').click()
await pg.waitForTimeout(300)
const sheet = f.frameLocator('iframe[name=hub-overlay]')
ok('another board opens as an overlay frame', await f.locator('iframe[name=hub-overlay]').count() === 1 && await sheet.locator('#sheetClose').isVisible())
await sheet.locator('#sheetClose').click()
await pg.waitForTimeout(150)
ok('close inside the overlay removes the frame', await f.locator('iframe[name=hub-overlay]').count() === 0)
await f.locator('#openBoard').click(); await pg.waitForTimeout(300)
await pg.evaluate(() => { window.msgs.length = 0 })
await sheet.locator('#sheetGo').click(); await pg.waitForTimeout(200)
const m1 = await pg.evaluate(() => window.msgs)
ok('go inside an overlay closes it and navigates the viewer', await f.locator('iframe[name=hub-overlay]').count() === 0 && m1.length === 1 && m1[0].type === 'hub:navigate' && m1[0].href === base + '/Detail.html' && m1[0].transition === 'fade', m1)

// navigation messages
await pg.evaluate(() => { window.msgs.length = 0 })
await f.locator('#go').click(); await pg.waitForTimeout(100)
const m2 = await pg.evaluate(() => window.msgs)
ok('go posts the resolved address and transition', m2.length === 1 && m2[0].href === base + '/Detail.html' && m2[0].transition === 'slide-left', m2)
await pg.evaluate(() => { window.msgs.length = 0 })
await f.locator('#back').click(); await pg.waitForTimeout(100)
ok('back asks the viewer', (await pg.evaluate(() => window.msgs)).some(m => m.type === 'hub:back'))

// timers: standalone pages play; in a viewer they wait for hub:proto-play
await pg.waitForTimeout(500)
ok('inside a viewer the timer waits to be played', !(await pg.evaluate(() => window.msgs)).some(m => m.transition === 'none'))
await pg.evaluate(() => { window.msgs.length = 0; window.send({ type: 'hub:proto-play', enabled: true }) })
await pg.waitForTimeout(700)
ok('once played, data-hub-after fires', (await pg.evaluate(() => window.msgs)).some(m => m.href === base + '/Detail.html' && m.transition === 'none'))

// edit and comment mode switch it off
await pg.evaluate(() => { window.msgs.length = 0; window.send({ type: 'hub:comment-mode', enabled: true }) })
await f.locator('#go').click({ force: true }); await pg.waitForTimeout(100)
ok('hotspots are inert while commenting', (await pg.evaluate(() => window.msgs)).length === 0)
await pg.evaluate(() => window.send({ type: 'hub:comment-mode', enabled: false }))
await pg.evaluate(() => window.send({ type: 'hub:edit-mode', enabled: true }))
await pg.waitForTimeout(100)
ok('while editing everything is visible (states and modals are not applied)', await vis('#items') && await vis('#card'))
await pg.evaluate(() => window.send({ type: 'hub:edit-mode', enabled: false }))

// hotspot hint
await pg.evaluate(() => window.send({ type: 'hub:proto-play', enabled: true }))
await f.locator('#plain').click()
ok('a click on nothing flashes the hotspots', await f.locator('[data-hub-flash]').count() > 0)

await browser.close(); server.close()
process.exit(fails ? 1 : 0)
