import { flowLines, flowOf, parseActions, parseAfter, resolveBoardPath } from '../../shared/protoFlow'
import { instrumentHtml } from '../../server/utils/frame'
let fails = 0
const ok = (n: string, c: any, x: any = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 400)); if (!c) fails++ }

// --- grammar
ok('go with transition', JSON.stringify(parseActions('go:screens/Detail.html|slide-left')) === JSON.stringify([{ verb: 'go', target: 'screens/Detail.html', transition: 'slide-left' }]))
ok('go defaults to fade, unknown transition too', parseActions('go:a.html')[0]!.verb === 'go' && (parseActions('go:a.html|zoom')[0] as any).transition === 'fade')
ok('several actions, junk dropped', parseActions('state:menu=open; nonsense ;close;back;toggle:#m=on;open:#dlg;go:').map(a => a.verb).join() === 'state,close,back,toggle,open')
ok('state target and value', JSON.stringify(parseActions('state:=open')) === JSON.stringify([{ verb: 'state', target: '', value: 'open' }]))
ok('after needs a delay', parseAfter('1500 go:b.html')?.ms === 1500 && parseAfter('go:b.html') === null)

// --- conditions
const cond = parseActions('go:Cart.html if #email:valid & #terms:checked; state:Form=error unless #email:valid; back; close if self:filled')
ok('conditions attach to their own action', cond.length === 4 && JSON.stringify(cond[0]!.when) === JSON.stringify({ negate: false, tests: '#email:valid & #terms:checked' }) && cond[1]!.when?.negate === true && cond[2]!.when === undefined && cond[3]!.when?.tests === 'self:filled', cond)
ok('a malformed action keeps no stray condition', parseActions('nonsense if #a:valid; go:b.html').length === 1 && parseActions('nonsense if #a:valid; go:b.html')[0]!.when === undefined)
ok('facet targets and {value} survive parsing', JSON.stringify(parseActions('state:Menu.tab={value}')) === JSON.stringify([{ verb: 'state', target: 'Menu.tab', value: '{value}' }]))

// --- paths
ok('relative paths resolve against the board folder', resolveBoardPath('screens/Home.html', 'Detail.html') === 'screens/Detail.html' && resolveBoardPath('screens/Home.html', '../index.html') === 'index.html')
ok('escaping, external and anchors are rejected', resolveBoardPath('a.html', '../x.html') === null && resolveBoardPath('a.html', 'https://x.test/b.html') === null && resolveBoardPath('a.html', '#top') === null && resolveBoardPath('a.html', '//x.test/b.html') === null)

// --- flow
const boards = new Set(['Home.html', 'Detail.html', 'Modal.html', 'Cart.html'])
const home = `<a href="Detail.html">x</a><button data-hub-click="go:Cart.html|fade; open:Modal.html">b</button><div data-nav="Detail.html"></div>
  <div data-hub-after="2000 go:Cart.html"></div><a href="https://example.test/Cart.html">ext</a><a href="Missing.html">m</a><span data-hub-click="go:Home.html">self</span>
  <div data-hub-hover='open:Modal.html'></div><p href="Detail.html"></p><!-- <a href="Cart.html"> -->`
const edges = flowOf('Home.html', home, boards)
const has = (to: string, kind: string, trigger: string) => edges.some(e => e.to === to && e.kind === kind && e.trigger === trigger)
ok('link, hotspot, overlay, nav and timer edges', has('Detail.html', 'link', 'link') && has('Cart.html', 'go', 'click') && has('Modal.html', 'open', 'click') && has('Detail.html', 'link', 'click') && has('Cart.html', 'go', 'after') && has('Modal.html', 'open', 'hover'), edges)
ok('external, unknown, self and non-anchor hrefs are ignored', !edges.some(e => e.to === 'Missing.html' || e.to === 'Home.html') && edges.length === 7, edges)
ok('edges are unique', flowOf('Home.html', home + home, boards).length === edges.length)

const edges2 = flowOf('Home.html', `<button data-hub-press="go:Cart.html"></button><select data-hub-change="go:Detail.html if self:filled"></select><input data-hub-blur="open:Modal.html if #a:valid" data-hub-focus="state:x=y" data-hub-input="go:Cart.html">`, boards)
ok('new triggers show up in the flow, conditions do not hide them', edges2.some(e => e.trigger === 'press' && e.to === 'Cart.html') && edges2.some(e => e.trigger === 'change' && e.to === 'Detail.html') && edges2.some(e => e.trigger === 'blur' && e.kind === 'open') && edges2.some(e => e.trigger === 'input') && edges2.length === 4, edges2)

const lines = flowLines(edges, new Map([['Home.html', { x: 0, y: 0, w: 400, h: 300 }], ['Detail.html', { x: 600, y: 0, w: 400, h: 300 }], ['Modal.html', { x: 0, y: 500, w: 400, h: 300 }], ['Cart.html', { x: 600, y: 500, w: 400, h: 300 }]]))
ok('one line per pair, strongest kind wins', lines.length === 3 && lines.find(l => l.to === 'Cart.html')!.kind === 'go' && lines.find(l => l.to === 'Modal.html')!.kind === 'open' && lines.find(l => l.to === 'Detail.html')!.kind === 'link', lines)
ok('side by side boards connect left to right', lines.find(l => l.to === 'Detail.html')!.d.startsWith('M400,150'), lines)
ok('boards above and below connect bottom to top', lines.find(l => l.to === 'Modal.html')!.d.startsWith('M200,300'), lines)
const back = flowLines([{ from: 'A', to: 'B', kind: 'go', trigger: 'click' }, { from: 'B', to: 'A', kind: 'go', trigger: 'click' }], new Map([['A', { x: 0, y: 0, w: 100, h: 100 }], ['B', { x: 300, y: 0, w: 100, h: 100 }]]))
ok('mutual links do not overlap', back.length === 2 && back[0]!.d.split(' ')[0] !== back[1]!.d.split(' ')[0], back)

// --- injection
const html = instrumentHtml('<!doctype html><html><head></head><body><button data-hub-click="close">x</button></body></html>')
ok('runtime is injected once, after the bridge and before the editor', html.split('data-hub-proto').length === 2 && html.indexOf('data-hub-bridge') < html.indexOf('data-hub-proto') && html.indexOf('data-hub-proto') < html.indexOf('data-hub-editor'))
process.exit(fails ? 1 : 0)
