import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { instrumentHtml } from '/home/christian/.t3/scratch/2026-11-06-is-there-an-opensource-alternative-39b4b457/artifact-hub/server/utils/frame'
import { annotate, applyEdits } from '/home/christian/.t3/scratch/2026-11-06-is-there-an-opensource-alternative-39b4b457/artifact-hub/server/utils/htmlEdit'
import { paletteHtml } from '/home/christian/.t3/scratch/2026-11-06-is-there-an-opensource-alternative-39b4b457/artifact-hub/shared/palette'
let fails = 0
const ok = (n: string, c: any, x: any = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 500)); if (!c) fails++ }
const wait = (ms = 40) => new Promise(r => setTimeout(r, ms))
const A = '/home/christian/.t3/scratch/2026-11-06-is-there-an-opensource-alternative-39b4b457/artifact-hub/server/assets/dc/'
const support = ['react.production.min.js', 'react-dom.production.min.js', 'dc-runtime.js'].map(f => readFileSync(A + f, 'utf8')).join('\n;\n')
const source = readFileSync('/tmp/claude-1000/-home-christian--t3-scratch-2026-11-06-is-there-an-opensource-alternative-39b4b457/00602bf4-a546-4128-a40b-6523462d718e/scratchpad/t/dc/Consent.dc.html', 'utf8')

async function open(src: string) {
  const html = instrumentHtml(annotate(src)).replace(/<script src="\.\/support\.js"><\/script>/, '')
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/f/t@1/Consent.dc.html' })
  const w = dom.window as any
  const sent: any[] = []; w.postMessage = (m: any) => sent.push(m)
  const errors: string[] = []; w.console.error = (...a: any[]) => errors.push(a.join(' '))
  w.eval(support)
  await wait(60)
  w.eval([...w.document.querySelectorAll('script[data-hub-editor]')][0].textContent)
  return { w, d: w.document as Document, sent, errors,
    send: (data: any) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w })),
    click: (el: Element) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })),
    last: (t: string) => [...sent].reverse().find(m => m.type === t) }
}
function tree(el: Element): any {
  const style: Record<string, string> = {}; const st = (el as HTMLElement).style
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

const { d, sent, errors, send, click, last } = await open(source)
ok('DC board still renders when annotated', d.querySelector('x-dc')!.hasAttribute('data-dc-ready') && d.querySelector('h1')!.textContent === 'Zugriff erlauben?', errors)
ok('annotated attributes survive React rendering', d.querySelector('h1')!.hasAttribute('data-hub-pid'))
ok('rows from <sc-for> carry the template node id', [...d.querySelectorAll('li')].length === 2 && [...d.querySelectorAll('li')].every(li => li.getAttribute('data-hub-pid') === d.querySelector('li')!.getAttribute('data-hub-pid')))
send({ type: 'hub:edit-mode', enabled: true })

const h1 = d.querySelector('h1')!; click(h1); let info = last('hub:edit-select').info
ok('select the rendered heading', info.tag === 'h1' && info.textEditable === true && info.c.fontSize === '18px', info)
const boundSpan = d.querySelector('li span')!; click(boundSpan); info = last('hub:edit-select').info
ok('text bound to {{s.title}} is reported as bound / not retypeable', info.bound === true && info.textEditable === false, info)
boundSpan.dispatchEvent(new (d.defaultView as any).MouseEvent('dblclick', { bubbles: true, cancelable: true }))
ok('dblclick on bound text explains instead of editing', !boundSpan.hasAttribute('contenteditable') && /template data/.test(last('hub:edit-note')?.text ?? ''))

click(h1); const hid = last('hub:edit-select').info.id
send({ type: 'hub:edit-cmd', cmd: 'style', id: hid, set: { color: '#c8553d', 'font-size': '24px' } })
const warn = d.querySelector('[role=alert]')!; click(warn); const wid = last('hub:edit-select').info.id
send({ type: 'hub:edit-cmd', cmd: 'style', id: wid, set: { 'border-radius': '16px' } })
// retype the (static) paragraph at the bottom, via dblclick + Enter
const foot = [...d.querySelectorAll('div')].find(x => x.textContent?.startsWith('Du kannst den Zugriff'))! as HTMLElement
foot.dispatchEvent(new (d.defaultView as any).MouseEvent('dblclick', { bubbles: true, cancelable: true }))
ok('static text in a template is retypeable', foot.getAttribute('contenteditable') === 'true')
foot.textContent = 'Neuer Hinweis: jederzeit widerrufbar.'
foot.dispatchEvent(new (d.defaultView as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
// add a heading after the h1
send({ type: 'hub:edit-cmd', cmd: 'insert', op: { type: 'insert', kind: 'text', id: 'nNote1', props: {}, target: { id: hid, position: 'after' } }, html: paletteHtml('text', 'nNote1') })
// delete the checkbox label
const lab = d.querySelector('label')!; click(lab); send({ type: 'hub:edit-cmd', cmd: 'delete', id: last('hub:edit-select').info.id })

const ops = sent.filter(m => m.type === 'hub:edit-op').map(m => m.op)
console.log('  ops:', ops.map(o => o.type + (o.id ? ':' + o.id : '')).join(', '))
const res = applyEdits(source, ops)
ok('all ops replay on the template source', res.applied === ops.length && !res.warnings.length, res.warnings)
ok('template holes and untouched markup are intact', res.source.includes('{{s.title}}') && res.source.includes('background: {{accent}}') && res.source.includes('<sc-for list="{{scopes}}"') && res.source.includes('class Component extends DCLogic'))
const saved = await open(res.source)
ok('saved board renders without errors', saved.errors.length === 0 && saved.d.querySelector('x-dc')!.hasAttribute('data-dc-ready'), saved.errors)
const live = tree(d.body), again = tree(saved.d.body)
const same = JSON.stringify(live) === JSON.stringify(again)
ok('REOPENED .dc.html RENDERS EXACTLY WHAT THE USER SAW (incl. loop rows, holes, styles)', same)
if (!same) { const a = JSON.stringify(live), b = JSON.stringify(again); let i = 0; while (a[i] === b[i]) i++; console.log('first difference at', i, '\nLIVE :', a.slice(Math.max(0, i - 120), i + 200), '\nSAVED:', b.slice(Math.max(0, i - 120), i + 200)) }
console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0)
