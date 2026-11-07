import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
const support = ['react.production.min.js', 'react-dom.production.min.js', 'dc-runtime.js'].map(f => readFileSync('/home/christian/.t3/scratch/2026-11-06-is-there-an-opensource-alternative-39b4b457/artifact-hub/server/assets/dc/' + f, 'utf8')).join('\n;\n')
const dir = '/tmp/claude-1000/-home-christian--t3-scratch-2026-11-06-is-there-an-opensource-alternative-39b4b457/00602bf4-a546-4128-a40b-6523462d718e/scratchpad/t/dc/'
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1 }
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

async function open(file, rawHtml) {
  const html = (rawHtml ?? readFileSync(dir + file, 'utf8')).replace(/<script src="\.\/support\.js"><\/script>/, '')
  const errors = []
  const dom = new JSDOM(html, { url: 'http://localhost/f/tok@1/' + file, runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  w.fetch = async (u) => { const name = new URL(u).pathname.split('/').pop(); try { const t = readFileSync(dir + name, 'utf8'); return { ok: true, status: 200, text: async () => t } } catch { return { ok: false, status: 404, text: async () => '' } } }
  w.console.error = (...a) => errors.push(a.join(' '))
  w.eval(support)
  await wait(50)
  return { w, d: w.document, errors }
}
const q = (d, s) => d.querySelector(s), qa = (d, s) => [...d.querySelectorAll(s)]

// ---- real board from the user's canvas
{
  const { w, d, errors } = await open('Consent.dc.html')
  ok('Consent: rendered (data-dc-ready)', q(d, 'x-dc').hasAttribute('data-dc-ready'))
  ok('Consent: no raw {{holes}} left in the DOM', !d.body.innerHTML.includes('{{'), d.body.innerHTML.match(/\{\{[^}]*\}\}/)?.[0])
  ok('Consent: heading text', q(d, 'h1').textContent === 'Zugriff erlauben?')
  const lis = qa(d, 'li')
  ok('Consent: sc-for rendered 2 scope rows', lis.length === 2, lis.length)
  ok('Consent: row content', lis[1].textContent.includes('Upstreams verwalten') && lis[1].textContent.includes('mcpwarden:admin'))
  ok('Consent: per-row style hole (border colour)', /a1a1aa|161, 161, 170/i.test(lis[1].getAttribute('style')), lis[1].getAttribute('style'))
  const icon = q(d, 'div[aria-hidden]')
  ok('Consent: accent default via this.props.accent ?? default', /3730a3|55, 48, 163/i.test(icon.getAttribute('style')), icon.getAttribute('style'))
  ok('Consent: helmet <style> moved to <head>', [...d.head.querySelectorAll('style')].some(s => s.textContent.includes('body{margin:0}')))
  ok('Consent: helmet <link> (Google Fonts) moved to <head>', !!d.head.querySelector('link[href*="fonts.googleapis.com"]'))
  ok('Consent: checkbox + 2 buttons', !!q(d, 'input[type=checkbox]') && qa(d, 'button').length === 2)
  ok('Consent: umlauts intact', d.body.textContent.includes('möchte') && d.body.textContent.includes('geprüft'))
  ok('Consent: no runtime errors', errors.length === 0, errors.join('|'))
}

// ---- feature board
{
  const { w, d, errors } = await open('Counter.dc.html')
  const click = async (el) => { el.click(); await wait(40) }
  ok('Counter: initial hole', q(d, 'h1').textContent === 'Count: 0')
  ok('Counter: sc-if true/false branches', !!q(d, '#small') && !q(d, '#big'))
  ok('Counter: boolean attr from hole (disabled)', q(d, '#reset').disabled === true)
  await click(q(d, '#inc')); await click(q(d, '#inc')); await click(q(d, '#inc'))
  ok('Counter: onClick + setState re-render', q(d, 'h1').textContent === 'Count: 3', q(d, 'h1').textContent)
  ok('Counter: sc-if flips', !!q(d, '#big') && !q(d, '#small'))
  ok('Counter: disabled cleared', q(d, '#reset').disabled === false)
  await click(q(d, '#reset')); ok('Counter: reset works', q(d, 'h1').textContent === 'Count: 0')
  const items = qa(d, '#list > li')
  ok('Counter: sc-for + $index', items.length === 2 && items[1].getAttribute('data-i') === '1' && items[1].querySelector('.x').textContent === '1:b', items.map(i => i.textContent).join('|'))
  ok('Counter: loop item style hole', /red/.test(items[0].getAttribute('style')) && /blue/.test(items[1].getAttribute('style')))
  await click(items[1].querySelector('button')); ok('Counter: per-item handler', q(d, '#picked').textContent === 'picked: b')
  ok('Counter: input value hole', q(d, '#name').value === 'Ada' && q(d, '#hello').textContent === 'Hi Ada!')
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set
  setter.call(q(d, '#name'), 'Bob'); q(d, '#name').dispatchEvent(new w.Event('input', { bubbles: true })); await wait(40)
  ok('Counter: onChange -> state -> re-render', q(d, '#hello').textContent === 'Hi Bob!', q(d, '#hello').textContent)
  ok('Counter: link between boards is a plain relative href', q(d, '#link').getAttribute('href') === 'Consent.dc.html')
  await wait(80)
  const pills = qa(d, '#kids .pillc')
  ok('Counter: dc-import mounted children with props', pills.length === 2 && pills[0].textContent === 'a!' && pills[1].textContent === 'b!', pills.map(p => p.outerHTML).join(''))
  ok('Counter: dc-import prop in style hole', /red/.test(pills[0].getAttribute('style')) && /blue/.test(pills[1].getAttribute('style')))
  ok('Counter: child helmet applied once', [...d.head.querySelectorAll('style')].filter(s => s.textContent.includes('.pillc')).length === 1)
  const c = q(d, '#svg circle')
  ok('Counter: svg attrs (stroke-width) survive', c.getAttribute('stroke-width') === '2' && q(d, '#svg').getAttribute('viewBox') === '0 0 10 10', c.outerHTML)
  ok('Counter: no runtime errors', errors.length === 0, errors.join('|'))
}

// ---- failure modes
{
  const { d } = await open('Broken.dc.html', '<!doctype html><html><head></head><body><x-dc><p>{{x}}</p></x-dc><script type="text/x-dc" data-dc-script data-props="{}">const nothing = 1;</script></body></html>')
  ok('Broken: shows a readable error instead of raw template', /could not render/.test(d.body.textContent) && q(d, 'x-dc').hasAttribute('data-dc-ready'))
  const r2 = await open('Throws.dc.html', '<!doctype html><html><head></head><body><x-dc><p>{{x}}</p></x-dc><script type="text/x-dc" data-dc-script data-props="{}">class Component extends DCLogic { renderVals(){ throw new Error("boom") } }</script></body></html>')
  ok('Throwing renderVals: does not leave raw {{x}} visible', !r2.d.body.textContent.includes('{{x}}') || /could not render|boom/.test(r2.d.body.textContent) || r2.d.querySelector('x-dc').getAttribute('data-dc-ready') === null, r2.d.body.textContent)
  const miss = await open('Missing.dc.html', '<!doctype html><html><head></head><body><x-dc><dc-import name="Nope"></dc-import></x-dc><script type="text/x-dc" data-dc-script data-props="{}">class Component extends DCLogic { renderVals(){ return {} } }</script></body></html>')
  await wait(80); ok('dc-import of a missing file shows an inline error', /Nope.*404/.test(miss.d.body.textContent), miss.d.body.textContent)
}
