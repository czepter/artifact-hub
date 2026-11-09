import { readFileSync } from 'node:fs';
import { instrumentHtml } from '../server/utils/frame.ts';

const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

console.log('=== Test 1: instrumentHtml with .dc.html and <x-dc> ===');

const dcBoardHtml = `<x-dc>
<helmet><style>body { background: #fff; }</style></helmet>
<div style="color: {{accent}}"><h1>{{title}}</h1></div>
<script type="text/x-dc" data-dc-script data-props='{"accent":{"editor":"color","default":"#3730a3"},"title":{"editor":"string","default":"Hello"}}'>
class Component extends DCLogic {
  renderVals() {
    return { title: (this.props.title || 'Hello') + ' World' };
  }
}
</script>
</x-dc>`;

const instrumented = instrumentHtml(dcBoardHtml, {
  props: { accent: '#ff0000' },
  path: 'screens/Main.dc.html',
  isDc: true
});

ok('instrumentHtml: wraps into full document', instrumented.includes('<!doctype html>'));
ok('instrumentHtml: injects support.js automatically', instrumented.includes('<script src="./support.js"></script>'));
ok('instrumentHtml: injects window.__dcProps', instrumented.includes('window.__dcProps={"accent":"#ff0000"}'));
ok('instrumentHtml: includes data-hub-bridge', instrumented.includes('data-hub-bridge'));
ok('instrumentHtml: includes editor script with tweak-set', instrumented.includes('tweak-set'));

console.log('\n=== Test 2: dc-runtime.js syntax & logic verification ===');

const dcRuntimeSource = readFileSync('server/assets/dc/dc-runtime.js', 'utf8');

ok('dc-runtime: defines DCLogic', dcRuntimeSource.includes('window.DCLogic = DCLogic'));
ok('dc-runtime: merges this.props with renderVals', dcRuntimeSource.includes('Object.assign({}, this.props, vals)'));
ok('dc-runtime: provides DefaultComponent fallback when script is missing', dcRuntimeSource.includes('DefaultComponent'));
ok('dc-runtime: initialProps merges __dcProps with __dcDefs defaults', dcRuntimeSource.includes('var initialProps = Object.assign({}, Cls.__dcProps || {}, window.__dcProps || {})'));
ok('dc-runtime: exposes window.__dcSetProps for live updates', dcRuntimeSource.includes('window.__dcSetProps = function'));

console.log('\nAll DC runtime Phase 1 & 2 unit checks completed.');

console.log('\n=== Test 3: behaviour in jsdom (live tweaks, imports, worker prefetch) ===');
const { JSDOM } = await import('jsdom');
const dir = 'server/assets/dc/';
const support = ['react.production.min.js', 'react-dom.production.min.js', 'dc-runtime.js'].map(f => readFileSync(dir + f, 'utf8')).join('\n;\n');
const files = {
  'ds/Btn.dc.html': `<x-dc><button style="background:{{tone}}">{{label}}</button><script type="text/x-dc" data-dc-script data-props='{"tone":{"default":"red"}}'></script></x-dc>`,
  'Page.dc.html': `<x-dc><div style="color:{{accent}}" data-nav="Detail.html"><b>{{title}}</b></div><dc-import name="ds/Btn" label="Go"></dc-import>
<script type="text/x-dc" data-dc-script data-props='{"accent":{"default":"#111"},"title":{"default":"Hi"}}'></script></x-dc>`,
};
const dom = new JSDOM(files['Page.dc.html'], { url: 'http://localhost/f/t@1/Page.dc.html', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
const fetched = [];
w.fetch = async (u) => { const n = new URL(u).pathname.replace('/f/t@1/', ''); fetched.push(n); const t = files[n]; return { ok: !!t, status: t ? 200 : 404, text: async () => t }; };
const posted = [];
w.parent.postMessage = (m) => posted.push(m);
w.eval(support);
await new Promise(r => setTimeout(r, 80));
const dd = w.document;
ok('boot: rendered with defaults', dd.querySelector('b')?.textContent === 'Hi');
ok('boot: announced hub:tweaks-ready with defs', posted.some(m => m.type === 'hub:tweaks-ready' && m.defs.accent));
ok('dc-import: folder name resolved, child default applied, prop passed', dd.querySelector('button')?.textContent === 'Go' && /red/.test(dd.querySelector('button').getAttribute('style')));
const div = dd.querySelector('div[data-nav]'), btn = dd.querySelector('button');
w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'hub:tweaks-update', values: { accent: '#ff0000' } } }));
ok('tweaks-update: style patched in place', /ff0000|255, 0, 0/.test(div.getAttribute('style')));
ok('tweaks-update: same nodes (no remount)', dd.querySelector('div[data-nav]') === div && dd.querySelector('button') === btn);
const n = posted.length;
w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'hub:tweaks-update', values: { accent: '#ff0000' } } }));
ok('tweaks-update: unchanged values are a no-op render', w.__dcSetProps({ accent: '#ff0000' }) === false);
ok('tweaks-update: replies with hub:tweaks-ready', posted.length > n && posted.at(-1).values.accent === '#ff0000');
ok('worker: absent in jsdom, falls back to fetch', fetched.includes('ds/Btn.dc.html'));
const frameSrc = readFileSync('server/utils/frame.ts', 'utf8');
ok('bridge: data-nav posts hub:navigate', frameSrc.includes("closest('[data-nav]')"));
ok('runtime: prefetch worker source present', dcRuntimeSource.includes('function workerMain') && dcRuntimeSource.includes('startPrefetch(names)'));
