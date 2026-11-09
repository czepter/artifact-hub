import { convertSource, checkImportPath, ImportError } from '../../server/utils/importConvert'
import { BOARDS, boardHtml, doc, savedPage } from '../fixtures/appifact'
let fails = 0
const ok = (n: string, c: any, x: any = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 400)); if (!c) fails++ }
const fails_ = (n: string, f: () => any, re: RegExp) => { try { f(); ok(n, false, 'did not throw') } catch (e: any) { ok(n, e instanceof ImportError && re.test(e.message), e.message) } }

// --- canvas
const c = convertSource(savedPage())
const canvas = JSON.parse(c.files.find(f => f.path === 'canvas.json')!.content)
ok('shell with appifact-doc becomes a canvas', c.kind === 'canvas' && c.boards === 4 && c.notes === 2, c)
ok('title from the document', c.title === 'Rankheld Performance Dashboards' && canvas.title === c.title && canvas.v === 3)
ok('boards keep file names, coordinates, size and title', BOARDS.every(b => { const o = canvas.boards[b.file]; return o && o.x === b.x && o.y === b.y && o.w === b.w && o.h === b.h && o.title === b.title && o.is_interactive === true }), canvas.boards)
ok('order follows artboards', canvas.order.join() === BOARDS.map(b => b.file).join())
ok('annotations become notes keyed by id', canvas.notes.a1.x === 0 && canvas.notes.a1.y === -140 && canvas.notes.a1.w === 560 && canvas.notes.a1.text === 'Context for reviewers' && Object.keys(canvas.notes).join() === 'a1,a2')
ok('launch carried over', canvas.launch.view === 'canvas')
ok('board html is byte-identical, including </script> inside scripts', BOARDS.every(b => c.files.find(f => f.path === b.file)?.content === boardHtml(b.title)))
ok('editor shell is gone', !c.files.some(f => f.content.includes('/* editor */')))
ok('clean source gives no warnings', c.warnings.length === 0, c.warnings)

// --- unknown fields are reported, not lost silently
const w = convertSource(savedPage(doc({ comments: [{ id: 'c1' }], extra: 1 }, { artboards: BOARDS.map(b => ({ ...b, bg: '#fff' })), annotations: [{ id: 'n', x: 1, y: 2, w: 3, text: 't', color: 'red' }], theme: 'x' })))
ok('unknown artboard, annotation, canvas and document fields warn', ['artboards: unknown field "bg" on 4 entries', 'annotations: unknown field "color" on 1 entry', 'canvas.json: unknown field "theme"', 'appifact-doc: unknown field "extra"'].every(m => w.warnings.some(x => x.includes(m))), w.warnings)
ok('comments are counted in a warning', w.warnings.some(x => x.startsWith('1 comment(s) not imported')))
ok('unknown fields are not written into canvas.json', !JSON.stringify(JSON.parse(w.files[0]!.content)).includes('"bg"'))

// --- runtime files and window.claude
const rt = doc(); (rt.content.files as any)['support.js'] = 'class DCLogic{}'; (rt.content.files as any)['vendor/react.production.min.js'] = '/*react*/'
const rtc = convertSource(savedPage(rt))
ok('support.js and vendor/react*.js are dropped and listed', !rtc.files.some(f => /support\.js|react/.test(f.path)) && rtc.dropped.length === 2, rtc.dropped)
const cl = doc(); (cl.content.files as any)['overview.dc.html'] += '<script>window.claude.complete("x")</script>'
ok('window.claude calls warn per file', convertSource(savedPage(cl)).warnings.some(x => x.startsWith('overview.dc.html calls window.claude')))

// --- other shapes
const arr = doc(); arr.content.files = Object.entries(arr.content.files).map(([path, content]) => ({ path, content })) as any
ok('files as a list of {path, content} work too', convertSource(savedPage(arr)).boards === 4)
const plain = convertSource('<!doctype html><html><body><h1>Hi</h1></body></html>', 'https://claude.ai/x')
ok('page without appifact-doc becomes index.html and says so', plain.kind === 'page' && plain.files.length === 1 && plain.files[0]!.path === 'index.html' && plain.title === 'https://claude.ai/x' && plain.warnings.length === 1, plain)
ok('the string "appifact-doc" in a script is not mistaken for the document', convertSource('<html><script>var a="appifact-doc"</script><p>x</p></html>').kind === 'page')
const single = doc(); single.content.files = { 'page.html': '<h1>one</h1>' } as any
ok('document without canvas.json becomes index.html', (() => { const r = convertSource(savedPage(single)); return r.kind === 'page' && r.files[0]!.path === 'index.html' })())

// --- rejected input (this artifact fails, nothing is created)
fails_('empty file', () => convertSource('  '), /empty/)
fails_('invalid JSON', () => convertSource('<script id="appifact-doc" type="application/json">{nope</script>'), /not valid JSON/)
fails_('board without its file', () => { const d = doc(); delete (d.content.files as any)['pages.dc.html']; convertSource(savedPage(d)) }, /pages\.dc\.html.*not in content\.files/)
fails_('path with ..', () => convertSource(savedPage(doc({}, { artboards: [{ ...BOARDS[0], file: '../evil.html' }] }))), /Invalid file path/)
fails_('absolute path', () => checkImportPath('/etc/passwd'), /Absolute/)
fails_('windows drive path', () => checkImportPath('C:\\x.html'), /Absolute/)
fails_('backslash traversal', () => checkImportPath('a\\..\\b.html'), /Invalid file path/)
fails_('path under _shared/', () => { const d = doc(); (d.content.files as any)['_shared/tokens.css'] = 'a{}'; convertSource(savedPage(d)) }, /_shared/)
fails_('board wider than 8000 px', () => convertSource(savedPage(doc({}, { artboards: [{ ...BOARDS[0], w: 8001 }] }))), /out of range/)
fails_('note wider than 8000 px', () => convertSource(savedPage(doc({}, { annotations: [{ id: 'a', x: 0, y: 0, w: 9000, text: 't' }] }))), /out of range/)
fails_('more than 1000 notes', () => convertSource(savedPage(doc({}, { annotations: Array.from({ length: 1001 }, (_, i) => ({ id: `n${i}`, x: 0, y: 0, w: 100, text: 't' })) }))), /1001 notes/)
ok('exactly 1000 notes are fine', convertSource(savedPage(doc({}, { annotations: Array.from({ length: 1000 }, (_, i) => ({ id: `n${i}`, x: 0, y: 0, w: 100, text: 't' })) }))).notes === 1000)
fails_('duplicate note id', () => convertSource(savedPage(doc({}, { annotations: [{ id: 'a', x: 0, y: 0, w: 1, text: 't' }, { id: 'a', x: 0, y: 0, w: 1, text: 't' }] }))), /used twice/)
fails_('non-numeric coordinate', () => convertSource(savedPage(doc({}, { artboards: [{ ...BOARDS[0], x: '0' }] }))), /not a number/)
fails_('duplicate board', () => convertSource(savedPage(doc({}, { artboards: [BOARDS[0], BOARDS[0]] }))), /listed twice/)

// --- nothing from the source runs: a hostile page is only parsed
;(globalThis as any).__pwned = false
convertSource(savedPage(doc({ title: 'x' })).replace('</body>', '<script>globalThis.__pwned = true</script></body>'))
ok('scripts in the page are not executed', (globalThis as any).__pwned === false)
const t0 = Date.now(); convertSource(savedPage(doc(), 2600))
ok('a 2.7 MB page converts quickly', Date.now() - t0 < 3000, Date.now() - t0)

if (fails) process.exit(1)
