// Group / ungroup in the real in-frame editor (Chromium), and the server replaying the emitted ops to the same structure.
import { chromium } from 'playwright-core'
import http from 'node:http'
import { instrumentHtml } from '../../server/utils/frame.ts'
import { annotate, applyEdits } from '../../server/utils/htmlEdit.ts'

const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1 }
const source = `<!doctype html><html><head><style>body{margin:0;position:relative;height:400px}.f{position:absolute;width:50px;height:20px;background:#ccc}</style></head><body>
<div id="wrap" style="position:relative;height:300px">
<div class="f" id="a" style="left:10px;top:20px">A</div>
<div class="f" id="b" style="left:80px;top:60px">B</div>
</div>
<p id="p1">one</p><p id="p2">two</p><p id="p3">three</p>
<ul><li id="l1">x</li></ul>
</body></html>`
const board = instrumentHtml(annotate(source))
const host = `<!doctype html><body><iframe id="f" src="/board.html" style="width:600px;height:500px"></iframe><script>
window.ops=[];window.notes=[];window.sels=[];
addEventListener('message',e=>{const d=e.data;if(d.type==='hub:edit-op')ops.push(d.op);if(d.type==='hub:edit-note')notes.push(d.text);if(d.type==='hub:edit-select')sels.push(d.info)});
window.cmd=(c)=>document.getElementById('f').contentWindow.postMessage({type:'hub:edit-cmd',...c},'*');
document.getElementById('f').onload=()=>document.getElementById('f').contentWindow.postMessage({type:'hub:edit-mode',enabled:true},'*');
</script>`
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(q.url.startsWith('/board') ? board : host) }).listen(0)
const b = await chromium.launch()
const pg = await b.newPage()
await pg.goto(`http://localhost:${srv.address().port}/`)
const fr = pg.frameLocator('#f')
await fr.locator('#p1').waitFor()
await pg.waitForTimeout(200)

const click = async (sel, shift = false) => { await fr.locator(sel).click({ modifiers: shift ? ['Shift'] : [], force: true }); await pg.waitForTimeout(80) }
const frame = pg.frames().find(f => f !== pg.mainFrame())
const lastSel = () => pg.evaluate(() => sels.at(-1))

// --- flow siblings: p1 + p3 (p2 between) are grouped with everything in between
await click('#p1'); await click('#p3', true)
ok('multi: info reports 1 extra element and canGroup', (await lastSel()).multi === 1 && (await lastSel()).canGroup === true, JSON.stringify(await lastSel()))
await pg.evaluate(() => cmd({ cmd: 'group' })); await pg.waitForTimeout(120)
const g1 = await frame.evaluate(() => { const w = document.querySelector('#p1').parentElement; return { tag: w.tagName, kids: [...w.children].map(c => c.id), hasId: !!w.getAttribute('data-hub-id') } })
ok('group: wrapper holds p1..p3 in order', g1.tag === 'DIV' && g1.kids.join() === 'p1,p2,p3' && g1.hasId, JSON.stringify(g1))
ok('group: wrapper is selected', (await lastSel()).tag === 'div' && (await lastSel()).groupable === true)
let ops = await pg.evaluate(() => ops)
ok('group: one group op with 2 ids', ops.some(o => o.type === 'group' && o.ids.length === 2), JSON.stringify(ops))
// server replay gives the same structure
const replayed = applyEdits(source, ops).source
ok('server replay: wrapper around p1..p3', /<div data-hub-id="[^"]+">\s*<p [^>]*id="p1"[^>]*>one<\/p>\s*<p [^>]*id="p2"[^>]*>two<\/p>\s*<p [^>]*id="p3"[^>]*>three<\/p>\s*<\/div>/.test(replayed), replayed)

// --- ungroup restores
await pg.evaluate(() => cmd({ cmd: 'ungroup' })); await pg.waitForTimeout(120)
const g2 = await frame.evaluate(() => document.querySelector('#p1').parentElement.tagName)
ok('ungroup: p1 is back under body', g2 === 'BODY')
ops = await pg.evaluate(() => ops)
const back = applyEdits(source, ops).source
ok('server replay after ungroup: no wrapper left', !/<div data-hub-id="n/.test(back) && back.includes('id="p1">one</p>'), back)

// --- free members: group becomes an absolute box and members keep their place
const before = await frame.evaluate(() => ['a', 'b'].map(i => { const r = document.getElementById(i).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)] }))
await click('#a'); await click('#b', true)
await pg.evaluate(() => cmd({ cmd: 'group' })); await pg.waitForTimeout(120)
const afterG = await frame.evaluate(() => ['a', 'b'].map(i => { const r = document.getElementById(i).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)] }))
ok('free group: members do not jump', JSON.stringify(before) === JSON.stringify(afterG), JSON.stringify([before, afterG]))
const gs = await frame.evaluate(() => document.getElementById('a').parentElement.getAttribute('style'))
ok('free group: wrapper is a positioned box', /position: absolute/.test(gs) && /left: 10px/.test(gs) && /top: 20px/.test(gs), gs)
await pg.evaluate(() => cmd({ cmd: 'ungroup' })); await pg.waitForTimeout(120)
const afterU = await frame.evaluate(() => ['a', 'b'].map(i => { const r = document.getElementById(i).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)] }))
ok('free ungroup: members do not jump', JSON.stringify(before) === JSON.stringify(afterU), JSON.stringify([before, afterU]))

// --- guards
await click('#l1'); await pg.evaluate(() => cmd({ cmd: 'group' })); await pg.waitForTimeout(100)
ok('list items refuse to group with a note', (await pg.evaluate(() => notes.at(-1)) ?? '').includes('cannot be grouped'))
await click('#p1'); await click('#a', true)
ok('different parents are refused with a note', (await pg.evaluate(() => notes.at(-1)) ?? '').includes('same parent'))
await b.close(); srv.close()
