import { JSDOM } from 'jsdom'
import { instrumentHtml } from '/home/christian/.t3/scratch/2026-11-06-is-there-an-opensource-alternative-39b4b457/artifact-hub/server/utils/frame'
import { annotate, applyEdits } from '/home/christian/.t3/scratch/2026-11-06-is-there-an-opensource-alternative-39b4b457/artifact-hub/server/utils/htmlEdit'
import { paletteHtml } from '/home/christian/.t3/scratch/2026-11-06-is-there-an-opensource-alternative-39b4b457/artifact-hub/shared/palette'
let fails = 0
const ok = (n: string, c: any, x: any = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 400)); if (!c) fails++ }

const source = `<!doctype html>
<html><head><title>T</title><style>.card{padding:4px}</style></head>
<body>
<h1 id="a" style="color: red; font-size: 20px">Hello</h1>
<div class="card"><p>One <b>bold</b></p><p>Two</p><img src="x.png" alt="x"></div>
<section id="s"><span>keep</span></section>
<div id="empty"></div>
</body></html>`

function open(html: string) {
  const dom = new JSDOM(instrumentHtml(annotate(html)), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/f/t@1/index.html' })
  const w = dom.window as any
  const sent: any[] = []
  w.postMessage = (m: any) => sent.push(m)          // top-level window: parent === window, so capture what would go to the viewer
  const scripts = [...w.document.querySelectorAll('script[data-hub-editor]')].map((s: any) => s.textContent)
  ok('editor script is injected', scripts.length === 1)
  w.eval(scripts[0])
  const send = (data: any) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w }))
  const click = (el: Element) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
  const last = (type: string) => [...sent].reverse().find(m => m.type === type)
  return { w, d: w.document as Document, sent, send, click, last }
}

// normalise a DOM into a comparable tree: attributes (minus editor bookkeeping), computed-ish style map, text
function tree(el: Element): any {
  const style: Record<string, string> = {}
  const st = (el as HTMLElement).style
  for (let i = 0; i < (st?.length ?? 0); i++) style[st[i]!] = st.getPropertyValue(st[i]!)
  const attrs: Record<string, string> = {}
  for (const a of [...el.attributes]) if (!/^(data-hub-|contenteditable|style)/.test(a.name)) attrs[a.name] = a.value
  const kids: any[] = []
  for (const n of [...el.childNodes]) {
    if (n.nodeType === 3) { const t = n.textContent!.replace(/\s+/g, ' ').trim(); if (t) kids.push(t) }
    else if (n.nodeType === 1 && !(n as Element).hasAttribute('data-hub-overlay') && (n as Element).tagName !== 'SCRIPT') kids.push(tree(n as Element))
  }
  return { tag: el.tagName.toLowerCase(), attrs, style, kids }
}

// ---------------- drive the editor
const { w, d, sent, send, click, last } = open(source)
send({ type: 'hub:edit-mode', enabled: true })
send({ type: 'hub:edit-cmd', cmd: 'drag-mode', mode: 'flow' })
const h1 = d.querySelector('h1')!
click(h1)
let info = last('hub:edit-select').info
ok('click selects an element and reports it', info.tag === 'h1' && /^p\d+$/.test(info.id) && info.declared.color === 'red' && info.textEditable === true, info)
ok('computed values are reported', info.c.fontSize === '20px' && /red|rgb\(255, 0, 0\)/.test(info.c.color), info.c)
click(d.querySelector('b')!); info = last('hub:edit-select').info
ok('inline child (b) is selectable and its text is editable', info.tag === 'b', info)
click(d.querySelector('section span')!); const spanId = last('hub:edit-select').info.id

send({ type: 'hub:edit-cmd', cmd: 'select', id: info.parentId }); const pinfo = last('hub:edit-select').info
ok('select parent by id', pinfo.tag === 'p', pinfo)

// style
const h1id = (() => { click(h1); return last('hub:edit-select').info.id })()
send({ type: 'hub:edit-cmd', cmd: 'style', id: h1id, set: { color: 'blue', 'font-weight': '700', 'font-size': null } })
ok('style applied live (set, add, remove)', (h1 as HTMLElement).style.color === 'blue' && (h1 as HTMLElement).style.fontWeight === '700' && (h1 as HTMLElement).style.fontSize === '', h1.getAttribute('style'))
ok('style op emitted', JSON.stringify(last('hub:edit-op').op) === JSON.stringify({ type: 'style', id: h1id, set: { color: 'blue', 'font-weight': '700', 'font-size': null } }))
ok('selection info refreshed after the change', last('hub:edit-select').info.declared['font-weight'] === '700')

// attr on img
const img = d.querySelector('img')!; click(img); const imgId = last('hub:edit-select').info.id
send({ type: 'hub:edit-cmd', cmd: 'attr', id: imgId, name: 'src', value: 'new.png' })
ok('attr applied live', img.getAttribute('src') === 'new.png' && last('hub:edit-op').op.name === 'src')

// insert after h1 (host builds the html from the shared palette)
const op1 = { type: 'insert', kind: 'heading', id: 'nHead1', props: { text: 'New heading' }, target: { id: h1id, position: 'after' } }
send({ type: 'hub:edit-cmd', cmd: 'insert', op: op1, html: paletteHtml('heading', 'nHead1', { text: 'New heading' }) })
ok('insert after: element appears right after the target and is selected', h1.nextElementSibling?.textContent === 'New heading' && last('hub:edit-select').info.id === 'nHead1', h1.nextElementSibling?.outerHTML)
// insert a box inside the card
const card = d.querySelector('.card')!; click(card); const cardId = last('hub:edit-select').info.id
const op2 = { type: 'insert', kind: 'box', id: 'nBox1', target: { id: cardId, position: 'inside' } }
send({ type: 'hub:edit-cmd', cmd: 'insert', op: op2, html: paletteHtml('box', 'nBox1') })
ok('insert inside appends as last child', card.lastElementChild?.getAttribute('data-hub-id') === 'nBox1')
// insert with no selection -> body end
send({ type: 'hub:edit-cmd', cmd: 'deselect' })
const op3 = { type: 'insert', kind: 'divider', id: 'nHr1' }
send({ type: 'hub:edit-cmd', cmd: 'insert', op: op3, html: paletteHtml('divider', 'nHr1') })
ok('insert without target appends to body', d.body.lastElementChild?.getAttribute('data-hub-id') === 'nHr1' || d.body.querySelector('[data-hub-id="nHr1"]') !== null)

// duplicate
const pTwo = [...d.querySelectorAll('p')].find(p => p.textContent === 'Two')!; click(pTwo); const pTwoId = last('hub:edit-select').info.id
send({ type: 'hub:edit-cmd', cmd: 'duplicate', id: pTwoId })
const dupOp = last('hub:edit-op').op
ok('duplicate emits an idMap with fresh ids', dupOp.type === 'duplicate' && Object.keys(dupOp.idMap).includes(pTwoId) && !Object.values(dupOp.idMap).includes(pTwoId), dupOp)
ok('duplicate inserted right after and selected', pTwo.nextElementSibling?.textContent === 'Two' && last('hub:edit-select').info.id === dupOp.idMap[pTwoId])
const allIds = [...d.querySelectorAll('[data-hub-id],[data-hub-pid]')].map(e => e.getAttribute('data-hub-id') ?? 'p' + e.getAttribute('data-hub-pid'))
ok('all ids in the DOM are unique after duplicate', new Set(allIds).size === allIds.length, allIds)

// move
const pOne = [...d.querySelectorAll('p')].find(p => p.textContent!.startsWith('One'))!; click(pOne); const pOneId = last('hub:edit-select').info.id
ok('canDown/canUp reported', last('hub:edit-select').info.canDown === true)
send({ type: 'hub:edit-cmd', cmd: 'move', id: pOneId, dir: 'down' })
ok('move down swaps with next sibling', pOne.previousElementSibling?.textContent === 'Two' && last('hub:edit-op').op.type === 'move')


// ---------------- drag and drop
const rect = (el: Element, l: number, t: number, w: number, h: number) => { (el as any).getBoundingClientRect = () => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t }) }
let hit: Element | null = null
;(d as any).elementFromPoint = () => hit
const gid = (el: Element) => el.getAttribute('data-hub-id') ?? 'p' + el.getAttribute('data-hub-pid')
const overlays = () => [...d.querySelectorAll('[data-hub-overlay]')] as HTMLElement[]
const indicator = () => overlays().find(o => o.style.background.includes('59, 130, 246') && o.style.display === 'block' && !o.style.cssText.includes('border:0') && (o.style.height === '3px' || o.style.width === '3px' || o.style.border.includes('dashed')))
const kids = [...card.children].filter(k => k.hasAttribute('data-hub-id') || k.hasAttribute('data-hub-pid'))
kids.forEach((k, i) => rect(k, 0, i * 30, 200, 30)); rect(card, 0, 0, 200, kids.length * 30)
hit = kids[1]!
send({ type: 'hub:edit-cmd', cmd: 'drag-over', x: 10, y: 35 })
ok('drag-over a sibling draws a line indicator', !!indicator() && indicator()!.style.height === '3px', overlays().map(o => o.style.cssText))
send({ type: 'hub:edit-cmd', cmd: 'drag-leave' }); ok('drag-leave hides the indicator', !indicator())
const before1 = sent.filter(m => m.type === 'hub:edit-op').length
send({ type: 'hub:edit-cmd', cmd: 'drag-drop', kind: 'button', id: 'nDrag1', html: paletteHtml('button', 'nDrag1'), x: 10, y: 35 })
const dop = last('hub:edit-op').op
ok('drop on the upper half of an element inserts BEFORE it', dop.type === 'insert' && dop.kind === 'button' && dop.target.id === gid(kids[1]!) && dop.target.position === 'before' && d.querySelector('[data-hub-id="nDrag1"]')!.nextElementSibling === kids[1], dop)
ok('dropped element is selected', last('hub:edit-select').info.id === 'nDrag1')
hit = kids[1]!; const lowerY = 55
send({ type: 'hub:edit-cmd', cmd: 'drag-drop', kind: 'text', id: 'nDrag2', html: paletteHtml('text', 'nDrag2'), x: 10, y: lowerY })
ok('drop on the lower half inserts AFTER', last('hub:edit-op').op.target.position === 'after' && d.querySelector('[data-hub-id="nDrag2"]')!.previousElementSibling === kids[1])
const emptyDiv = d.querySelector('#empty')!; rect(emptyDiv, 0, 300, 200, 40); hit = emptyDiv
send({ type: 'hub:edit-cmd', cmd: 'drag-over', x: 20, y: 310 }); ok('empty container shows a dashed "inside" box', !!indicator() && indicator()!.style.border.includes('dashed'))
send({ type: 'hub:edit-cmd', cmd: 'drag-drop', kind: 'box', id: 'nDrag3', html: paletteHtml('box', 'nDrag3'), x: 20, y: 310 })
ok('drop on an empty container goes INSIDE it', last('hub:edit-op').op.target.position === 'inside' && emptyDiv.firstElementChild?.getAttribute('data-hub-id') === 'nDrag3')
hit = null; const n0 = sent.filter(m => m.type === 'hub:edit-op').length
send({ type: 'hub:edit-cmd', cmd: 'drag-drop', kind: 'text', id: 'nDrag4', html: paletteHtml('text', 'nDrag4'), x: 5, y: 5 })
ok('drop outside any element is refused with a hint', sent.filter(m => m.type === 'hub:edit-op').length === n0 && /Cannot drop/.test(last('hub:edit-note').text) && !d.querySelector('[data-hub-id="nDrag4"]'))

// drag an existing element with the mouse into the empty container
const mouse = (el: Element, type: string, o: any = {}) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...o }))
const headEl = d.querySelector('[data-hub-id="nHead1"]')!
hit = emptyDiv; rect(headEl, 0, 100, 200, 30)
const opsBefore = sent.filter(m => m.type === 'hub:edit-op').length
mouse(headEl, 'mousedown', { clientX: 5, clientY: 105 })
mouse(headEl, 'mousemove', { clientX: 8, clientY: 107, buttons: 1 })
ok('tiny movement does not start a drag (still a click)', !indicator() && sent.filter(m => m.type === 'hub:edit-op').length === opsBefore)
mouse(headEl, 'mousemove', { clientX: 60, clientY: 310, buttons: 1 })
ok('moving past the threshold shows the drop indicator', !!indicator())
mouse(headEl, 'mouseup', { clientX: 60, clientY: 310 })
const mop = last('hub:edit-op').op
ok('releasing re-parents the element (after the Box already in that container) and emits moveTo', mop.type === 'moveTo' && mop.id === 'nHead1' && mop.target.id === 'nDrag3' && mop.target.position === 'after' && headEl.parentElement === emptyDiv && headEl.previousElementSibling?.getAttribute('data-hub-id') === 'nDrag3', mop)
const selCount = sent.filter(m => m.type === 'hub:edit-select').length
mouse(headEl, 'click', { clientX: 60, clientY: 310 })
ok('the click that follows a drag is swallowed (no re-selection)', sent.filter(m => m.type === 'hub:edit-select').length === selCount)
ok('moved element stays selected, indicator gone', last('hub:edit-select').info.id === 'nHead1' && !indicator())
// Esc cancels a drag in progress
const pOneEl = [...d.querySelectorAll('p')].find(p => p.textContent!.startsWith('One'))!
hit = kids[0]!; rect(pOneEl, 0, 0, 200, 30)
const ops2 = sent.filter(m => m.type === 'hub:edit-op').length; const parentBefore = pOneEl.parentElement
mouse(pOneEl, 'mousedown', { clientX: 5, clientY: 5 }); mouse(pOneEl, 'mousemove', { clientX: 70, clientY: 330, buttons: 1 })
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); mouse(pOneEl, 'mouseup', { clientX: 70, clientY: 330 })
ok('Escape cancels a drag: nothing moved, nothing emitted', sent.filter(m => m.type === 'hub:edit-op').length === ops2 && pOneEl.parentElement === parentBefore && !indicator())
// dropping an element onto/into itself is not offered
hit = pOneEl; mouse(pOneEl, 'mousedown', { clientX: 5, clientY: 5 }); mouse(pOneEl, 'mousemove', { clientX: 70, clientY: 20, buttons: 1 }); mouse(pOneEl, 'mouseup', { clientX: 70, clientY: 20 })
ok('dropping on itself does nothing', sent.filter(m => m.type === 'hub:edit-op').length === ops2)

// inline text edit: dblclick -> type -> Enter
const ed = d.querySelector('[data-hub-id="nHead1"]') as HTMLElement
ed.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, cancelable: true }))
ok('dblclick starts inline editing (contenteditable)', ed.getAttribute('contenteditable') === 'true')
ed.innerHTML = 'Retyped <b>title</b> <script>x</script>'
ed.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
const textOp = last('hub:edit-op').op
ok('Enter commits: text op carries the typed html, contenteditable removed', textOp.type === 'text' && textOp.id === 'nHead1' && textOp.html.includes('Retyped') && !ed.hasAttribute('contenteditable'), textOp)
// escape cancels
const sec = d.querySelector('section span') as HTMLElement; sec.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, cancelable: true }))
sec.textContent = 'changed'; sec.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
ok('Escape cancels and restores the text', sec.textContent === 'keep' && !sec.hasAttribute('contenteditable'))
const before = sent.filter(m => m.type === 'hub:edit-op').length
// delete via keyboard
click(d.querySelector('section span')!)
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
ok('Delete key removes the selected element and emits a delete op', !d.querySelector('section span') && last('hub:edit-op').op.type === 'delete' && sent.filter(m => m.type === 'hub:edit-op').length === before + 1)
ok('after deleting, the parent becomes the selection', last('hub:edit-select').info?.tag === 'section', last('hub:edit-select'))
// undo shortcut is forwarded
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); ok('Ctrl+Z is forwarded to the viewer', last('hub:key')?.key === 'undo')

// script-generated node (no ids) is not directly editable; clicking it selects the nearest identified ancestor
const gen = d.createElement('em'); gen.textContent = 'generated'; d.querySelector('section')!.appendChild(gen)
click(gen); ok('script-generated element resolves to its identified ancestor', last('hub:edit-select').info?.tag === 'section')
// switching edit mode off clears everything
send({ type: 'hub:edit-mode', enabled: false }); const nb = sent.length; click(h1); ok('edit mode off: clicks no longer select', sent.length === nb)

// ---------------- replay on the server's source editor and compare with what the user saw
const ops = sent.filter(m => m.type === 'hub:edit-op').map(m => m.op)
const res = applyEdits(source, ops)
console.log('  ops replayed:', ops.map(o => o.type).join(', '), '| applied', res.applied, '| warnings', JSON.stringify(res.warnings))
ok('every operation replayed without warnings', res.applied === ops.length && res.warnings.length === 0, res.warnings)
const saved = open(res.source)
const liveTree = tree(d.body), savedTree = tree(saved.d.body)
// the generated <em> and overlays were never saved, by design
const strip = (t: any): any => ({ ...t, kids: t.kids.filter((k: any) => !(typeof k === 'object' && k.tag === 'em')).map((k: any) => typeof k === 'object' ? strip(k) : k) })
const same = JSON.stringify(strip(liveTree)) === JSON.stringify(strip(savedTree))
ok('SAVED SOURCE RENDERS EXACTLY WHAT THE USER SAW (structure, text, attributes, styles)', same)
if (!same) { console.log('LIVE :', JSON.stringify(strip(liveTree))); console.log('SAVED:', JSON.stringify(strip(savedTree))) }
ok('nothing outside the edits changed (head/style untouched)', res.source.includes('<style>.card{padding:4px}</style>') && res.source.includes('<title>T</title>'))
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS'); process.exit(fails ? 1 : 0)
