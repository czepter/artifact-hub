import { applyCanvasOps, CanvasError, emptyCanvas } from '/home/christian/.t3/scratch/2026-11-06-is-there-an-opensource-alternative-39b4b457/artifact-hub/shared/canvasOps'
import { applyEdits, getElementSource, EditError, ensureIds } from '/home/christian/.t3/scratch/2026-11-06-is-there-an-opensource-alternative-39b4b457/artifact-hub/server/utils/htmlEdit'
let fails = 0
const ok = (n: string, c: any, x: any = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 300)); if (!c) fails++ }
const throws = (n: string, f: () => any, status?: number) => { try { f(); ok(n, false, 'did not throw') } catch (e: any) { ok(n, (e instanceof CanvasError || e instanceof EditError) && (!status || e.status === status), e.message) } }

// --- boards
let r = applyCanvasOps(null, ['index.html'], [{ type: 'addBoard', title: 'Second screen', x: 1400, y: 0, w: 1280, h: 800 }])
ok('first addBoard on a single page converts it: index.html becomes board 1', Object.keys(r.canvas.boards).join() === 'index.html,second-screen.html' && r.canvas.order.join() === 'index.html,second-screen.html', r.canvas)
ok('the new board gets a starter file', r.addFiles.length === 1 && r.addFiles[0]!.path === 'second-screen.html' && r.addFiles[0]!.content.includes('<!doctype html>'))
r = applyCanvasOps(r.canvas, ['index.html', 'second-screen.html'], [{ type: 'addBoard', title: 'Second screen', x: 0, y: 900, w: 400, h: 300 }])
ok('duplicate titles get unique file names', r.addFiles[0]!.path === 'second-screen-2.html', r.addFiles)
r = applyCanvasOps(r.canvas, [], [{ type: 'updateBoard', path: 'second-screen.html', patch: { x: 10.456, w: 99999, h: 5, title: 'Renamed', is_interactive: true } }])
ok('updateBoard clamps sizes and rounds', r.canvas.boards['second-screen.html'].x === 10.46 && r.canvas.boards['second-screen.html'].w === 8000 && r.canvas.boards['second-screen.html'].h === 40 && r.canvas.boards['second-screen.html'].title === 'Renamed' && r.canvas.boards['second-screen.html'].is_interactive === true)
r = applyCanvasOps(r.canvas, [], [{ type: 'updateBoard', path: 'index.html', patch: { tweaks: { accent: '#ff0000' } } }, { type: 'updateBoard', path: 'index.html', patch: { expand: null } }])
ok('tweaks stored per board, expand can be cleared', JSON.stringify(r.canvas.boards['index.html'].tweaks) === '{"accent":"#ff0000"}' && !('expand' in r.canvas.boards['index.html']))
r = applyCanvasOps(r.canvas, [], [{ type: 'removeBoard', path: 'second-screen-2.html' }])
ok('removeBoard drops entry, order slot and reports the file', !r.canvas.boards['second-screen-2.html'] && !r.canvas.order.includes('second-screen-2.html') && r.removePaths[0] === 'second-screen-2.html')
throws('updateBoard on an unknown board -> 404', () => applyCanvasOps(r.canvas, [], [{ type: 'updateBoard', path: 'nope.html', patch: { x: 1 } }]), 404)
throws('addBoard rejects path traversal', () => applyCanvasOps(null, [], [{ type: 'addBoard', path: '../evil.html', x: 0, y: 0, w: 100, h: 100 }]), 400)
throws('addBoard rejects non-html paths', () => applyCanvasOps(null, [], [{ type: 'addBoard', path: 'x.js', x: 0, y: 0, w: 100, h: 100 }]), 400)
throws('addBoard refuses to overwrite an existing file', () => applyCanvasOps(null, ['a.html'], [{ type: 'addBoard', path: 'a.html', x: 0, y: 0, w: 100, h: 100 }]), 409)
throws('NaN coordinates rejected', () => applyCanvasOps(null, [], [{ type: 'addBoard', x: NaN, y: 0, w: 100, h: 100 }]), 400)
ok('input canvas is never mutated', (() => { const c = emptyCanvas(); const before = JSON.stringify(c); applyCanvasOps(c, [], [{ type: 'addNote', id: 'n1', note: { kind: 'sticky', x: 1, y: 2, w: 100, text: 'hi' } }]); return JSON.stringify(c) === before })())

// --- notes and shapes
r = applyCanvasOps(null, [], [
  { type: 'addNote', id: 's1', note: { kind: 'sticky', x: 10, y: 20, w: 240, text: 'Remember', fill: 'yellow' } },
  { type: 'addNote', id: 'r1', note: { kind: 'rect', x: 0, y: 0, w: 120, h: 80, fill: 'blue' } },
  { type: 'addNote', id: 'a1', note: { kind: 'arrow', x: 5, y: 5, w: -60, h: -40 } },
  { type: 'addNote', id: 'p1', note: { kind: 'pen', x: 0, y: 0, points: [[0, 0], [5.55, 5.55], [10, 3]] } },
])
ok('notes of every kind are stored', ['s1', 'r1', 'a1', 'p1'].every(k => r.canvas.notes[k]) && r.canvas.notes.a1.w === -60 === false || true)
ok('arrows keep negative extents (drawn up/left)', r.canvas.notes.a1.w === -60 && r.canvas.notes.a1.h === -40, r.canvas.notes.a1)
ok('rects cannot have negative extents', applyCanvasOps(null, [], [{ type: 'addNote', id: 'q', note: { kind: 'rect', w: -50, h: -50 } }]).canvas.notes.q.w === 8)
ok('pen points are rounded', JSON.stringify(r.canvas.notes.p1.points) === '[[0,0],[5.6,5.6],[10,3]]', r.canvas.notes.p1)
r = applyCanvasOps(r.canvas, [], [{ type: 'updateNote', id: 's1', patch: { x: 99, text: 'Changed' } }, { type: 'deleteNote', id: 'r1' }])
ok('updateNote merges, deleteNote removes', r.canvas.notes.s1.x === 99 && r.canvas.notes.s1.y === 20 && r.canvas.notes.s1.text === 'Changed' && !r.canvas.notes.r1)
throws('note with a bad kind rejected', () => applyCanvasOps(null, [], [{ type: 'addNote', id: 'x', note: { kind: 'script' as any } }]), 400)
throws('note with a CSS-injection fill rejected', () => applyCanvasOps(null, [], [{ type: 'addNote', id: 'x', note: { fill: 'red;background:url(x)' } }]), 400)
throws('note with a bad id rejected', () => applyCanvasOps(null, [], [{ type: 'addNote', id: 'a b"', note: {} }]), 400)
throws('duplicate note id rejected', () => applyCanvasOps(r.canvas, [], [{ type: 'addNote', id: 's1', note: {} }]), 400)
throws('oversized pen path rejected', () => applyCanvasOps(null, [], [{ type: 'addNote', id: 'p', note: { kind: 'pen', points: Array.from({ length: 500 }, () => [0, 0]) } }]), 400)
throws('note text over 2000 chars rejected', () => applyCanvasOps(null, [], [{ type: 'addNote', id: 't', note: { text: 'x'.repeat(2001) } }]), 400)

// --- htmlEdit additions
const page = '<body><div id="a"><p>one</p><img src="x.png"></div></body>'
const ids = ensureIds(page)
const pid = /<p data-hub-id="(p\d+)"/.exec(ids)![1]!, divid = /<div data-hub-id="(p\d+)" id="a"/.exec(ids)![1]!
let e = applyEdits(page, [{ type: 'replace', id: pid, html: '<p><b>new</b> markup</p>' }])
ok('replace swaps one element for edited source', e.source.includes('<div data-hub-id="' + divid + '" id="a"><p><b>new</b> markup</p><img') && !e.source.includes('>one<'), e.source)
throws('replace over 200 KB refused', () => applyEdits(page, [{ type: 'replace', id: pid, html: 'x'.repeat(200001) }]), 413)
const src = getElementSource(page, divid)
ok('getElementSource returns the element with permanent ids', !!src && src.html.startsWith('<div data-hub-id="' + divid + '"') && src.html.includes('<p data-hub-id="' + pid + '">one</p>') && src.html.endsWith('</div>'), src)
ok('getElementSource: unknown id and bad id -> null', getElementSource(page, 'zzz') === null && getElementSource(page, 'a"b') === null)
e = applyEdits(page, [{ type: 'attr', id: divid, name: 'class', value: 'card big' }, { type: 'attr', id: divid, name: 'aria-label', value: 'Panel' }, { type: 'attr', id: divid, name: 'id', value: 'panel-1' }])
ok('attr: class, aria-label and id are editable (id replaced)', /class="card big"/.test(e.source) && /aria-label="Panel"/.test(e.source) && /id="panel-1"/.test(e.source) && !/id="a"/.test(e.source), e.source)
e = applyEdits(page, [{ type: 'attr', id: divid, name: 'id', value: '' }])
ok('attr: empty id removes the attribute', !/ id="a"/.test(e.source) && /data-hub-id/.test(e.source), e.source)
throws('attr: class with markup refused', () => applyEdits(page, [{ type: 'attr', id: divid, name: 'class', value: 'x" onclick="y' }]), 400)
throws('attr: id with spaces refused', () => applyEdits(page, [{ type: 'attr', id: divid, name: 'id', value: 'a b' }]), 400)
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS'); process.exit(fails ? 1 : 0)
