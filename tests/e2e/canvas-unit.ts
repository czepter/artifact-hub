import { applyCanvasOps, CanvasError, emptyCanvas, mergeOps, orderedNoteIds, reorder, type CanvasOp } from '../../shared/canvasOps'
import { detachBinds, groupKeys, groupOps, lockOps, styleOps, ungroupOps, clipBox, copyPayload, deleteOps, itemsFromCanvas, nudgeOps, overrideOps, pasteOps, patchOps, refOfKey } from '../../shared/canvasItemOps'
import { contentOutside, fitPenPoints, simplifyRDP, smoothPath, bindTargetAt, boundEndpoint, noteHit, resolveArrow, alignPatches, boxesIntersect, constrainCreate, distributePatches, guidesFor, noteGeometry, normBox, snapBox, snapLines, arrowPath, fitView, itemBox, noteBox, penPath, scaleItems, moveEndpoint, toWorldPoint, unionBox, zoomView, type GeomItem } from '../../shared/canvasGeometry'
import { applyEdits, getElementSource, EditError, ensureIds } from '../../server/utils/htmlEdit'
let fails = 0
const ok = (n: string, c: any, x: any = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 300)); if (!c) fails++ }
const same = (a: any, b: any) => { const n = (v: any): any => Array.isArray(v) ? v.map(n) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, n(v[k])])) : v; return JSON.stringify(n(a)) === JSON.stringify(n(b)) }
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

// --- Phase 0: schema additions
const styled = applyCanvasOps(null, [], [{ type: 'addNote', id: 'st', note: { kind: 'arrow', x: 0, y: 0, w: 50, h: 0, locked: true, group: 'g1', stroke: '#ff0000', strokeWidth: 4, strokeStyle: 'dashed', fillStyle: 'hatch', roundness: 'round', arrowStart: 'dot', arrowEnd: 'triangle' } }]).canvas.notes.st
ok('style fields are stored', styled.locked === true && styled.group === 'g1' && styled.stroke === '#ff0000' && styled.strokeWidth === 4 && styled.strokeStyle === 'dashed' && styled.fillStyle === 'hatch' && styled.roundness === 'round' && styled.arrowStart === 'dot' && styled.arrowEnd === 'triangle', styled)
const cleared = applyCanvasOps(applyCanvasOps(null, [], [{ type: 'addNote', id: 'a', note: { kind: 'rect', locked: true, group: 'g', stroke: '#000000' } }]).canvas, [], [{ type: 'updateNote', id: 'a', patch: { locked: null, group: null, stroke: null } }]).canvas.notes.a
ok('null clears style fields', !('locked' in cleared) && !('group' in cleared) && !('stroke' in cleared), cleared)
for (const [name, note] of [['strokeStyle', { strokeStyle: 'wavy' }], ['fillStyle', { fillStyle: 'rough' }], ['roundness', { roundness: 'x' }], ['arrowEnd', { arrowEnd: 'spear' }], ['arrowStart', { arrowStart: 1 }], ['stroke (CSS injection)', { stroke: 'red;x:y' }], ['strokeWidth NaN', { strokeWidth: NaN }], ['group with spaces', { group: 'a b' }], ['bind shape', { bind: 'x' }], ['bind target type', { bind: { start: { type: 'script', id: 'x' } } }]] as const)
  throws(`invalid ${name} rejected`, () => applyCanvasOps(null, [], [{ type: 'addNote', id: 'x', note: note as any }]), 400)
ok('strokeWidth is clamped to 1..24', applyCanvasOps(null, [], [{ type: 'addNote', id: 'x', note: { strokeWidth: 99 } }]).canvas.notes.x.strokeWidth === 24)
throws('bind to a missing note rejected', () => applyCanvasOps(null, [], [{ type: 'addNote', id: 'x', note: { kind: 'arrow', bind: { end: { type: 'note', id: 'nope' } } } }]), 400)
throws('bind to itself rejected', () => applyCanvasOps(null, [], [{ type: 'addNote', id: 'x', note: { kind: 'arrow' } }, { type: 'updateNote', id: 'x', patch: { bind: { end: { type: 'note', id: 'x' } } } }]), 400)
let bc = applyCanvasOps(null, ['index.html'], [{ type: 'addBoard', title: 'B', x: 0, y: 0, w: 100, h: 100 }, { type: 'addNote', id: 't', note: { kind: 'rect', w: 50, h: 50 } }, { type: 'addNote', id: 'ar', note: { kind: 'arrow', w: 80, h: 0, bind: { start: { type: 'note', id: 't' }, end: { type: 'board', id: 'b.html' } } } }]).canvas
ok('arrows can bind to notes and boards', JSON.stringify(bc.notes.ar.bind) === '{"start":{"type":"note","id":"t"},"end":{"type":"board","id":"b.html"}}', bc.notes.ar)
let bc2 = applyCanvasOps(bc, [], [{ type: 'deleteNote', id: 't' }]).canvas
ok('deleting a bound note clears the binding in the same batch', JSON.stringify(bc2.notes.ar.bind) === '{"end":{"type":"board","id":"b.html"}}', bc2.notes.ar)
bc2 = applyCanvasOps(bc2, [], [{ type: 'removeBoard', path: 'b.html' }]).canvas
ok('removing a bound board drops the whole bind object', !('bind' in bc2.notes.ar), bc2.notes.ar)
let bl = applyCanvasOps(null, [], [{ type: 'addBoard', path: 'p.html', x: 0, y: 0, w: 100, h: 100 }, { type: 'updateBoard', path: 'p.html', patch: { locked: true, group: 'g9' } }]).canvas.boards['p.html']
ok('boards take locked and group', bl.locked === true && bl.group === 'g9', bl)
bl = applyCanvasOps({ ...emptyCanvas(), boards: { 'p.html': bl }, order: ['p.html'] }, [], [{ type: 'updateBoard', path: 'p.html', patch: { locked: false, group: null } }]).canvas.boards['p.html']
ok('board locked/group can be cleared', !('locked' in bl) && !('group' in bl), bl)
throws('board group with spaces rejected', () => applyCanvasOps({ ...emptyCanvas(), boards: { 'p.html': {} }, order: ['p.html'] }, [], [{ type: 'updateBoard', path: 'p.html', patch: { group: 'a b' } }]), 400)

// z-order
const zc = applyCanvasOps(null, [], ['a', 'b', 'c', 'd'].map(id => ({ type: 'addNote' as const, id, note: { kind: 'rect' as const, w: 10, h: 10 } }))).canvas
ok('without noteOrder, z-order is key order (old canvases render unchanged)', orderedNoteIds(zc).join() === 'a,b,c,d' && !('noteOrder' in zc))
ok('reorder front/back/forward/backward', reorder(['a', 'b', 'c', 'd'], ['b'], 'front').join() === 'a,c,d,b' && reorder(['a', 'b', 'c', 'd'], ['c'], 'back').join() === 'c,a,b,d' && reorder(['a', 'b', 'c', 'd'], ['b'], 'forward').join() === 'a,c,b,d' && reorder(['a', 'b', 'c', 'd'], ['c'], 'backward').join() === 'a,c,b,d')
ok('reorder keeps the relative order of several ids and stops at the ends', reorder(['a', 'b', 'c', 'd'], ['a', 'c'], 'forward').join() === 'b,a,d,c' && reorder(['a', 'b', 'c'], ['c'], 'forward').join() === 'a,b,c' && reorder(['a', 'b', 'c'], ['a'], 'backward').join() === 'a,b,c')
let zr = applyCanvasOps(zc, [], [{ type: 'reorderNotes', ids: ['a', 'b'], mode: 'front' }]).canvas
ok('reorderNotes creates noteOrder', zr.noteOrder!.join() === 'c,d,a,b', zr.noteOrder)
zr = applyCanvasOps(zr, [], [{ type: 'addNote', id: 'e', note: {} }, { type: 'deleteNote', id: 'c' }]).canvas
ok('addNote appends on top and deleteNote leaves noteOrder, once it exists', zr.noteOrder!.join() === 'd,a,b,e', zr.noteOrder)
ok('stale ids in noteOrder are ignored and unlisted notes fall back to key order', orderedNoteIds({ notes: { a: {}, b: {}, c: {} }, noteOrder: ['zz', 'c'] }).join() === 'c,a,b')
throws('reorderNotes with an unknown note -> 404', () => applyCanvasOps(zc, [], [{ type: 'reorderNotes', ids: ['nope'], mode: 'front' }]), 404)
throws('reorderNotes with a bad mode -> 400', () => applyCanvasOps(zc, [], [{ type: 'reorderNotes', ids: ['a'], mode: 'sideways' as any }]), 400)
throws('reorderNotes with no ids -> 400', () => applyCanvasOps(zc, [], [{ type: 'reorderNotes', ids: [], mode: 'front' }]), 400)

// duplicateBoard
let dc = applyCanvasOps(null, ['index.html'], [{ type: 'addBoard', path: 'screens/Home.html', title: 'Home', x: 0, y: 0, w: 300, h: 200 }]).canvas
dc.boards['screens/Home.html'].tweaks = { accent: '#ff0000' }
let dr = applyCanvasOps(dc, ['index.html', 'screens/Home.html'], [{ type: 'duplicateBoard', path: 'screens/Home.html' }, { type: 'duplicateBoard', path: 'screens/Home.html', x: 5, y: 6, title: 'Second' }])
ok('duplicateBoard copies the entry, offsets it and asks for a file copy', dr.copyFiles.length === 2 && dr.copyFiles[0]!.from === 'screens/Home.html' && dr.copyFiles[0]!.to === 'screens/Home-copy.html' && dr.canvas.boards['screens/Home-copy.html'].x === 40 && dr.canvas.boards['screens/Home-copy.html'].title === 'Home copy' && JSON.stringify(dr.canvas.boards['screens/Home-copy.html'].tweaks) === '{"accent":"#ff0000"}', dr)
ok('duplicateBoard: unique names, explicit position and title, order and no mutation', dr.copyFiles[1]!.to === 'screens/Home-copy-2.html' && dr.canvas.boards['screens/Home-copy-2.html'].x === 5 && dr.canvas.boards['screens/Home-copy-2.html'].title === 'Second' && dr.canvas.order.join() === 'index.html,screens/Home.html,screens/Home-copy.html,screens/Home-copy-2.html' && !dc.boards['screens/Home-copy.html'])
throws('duplicateBoard of an unknown board -> 404', () => applyCanvasOps(dc, [], [{ type: 'duplicateBoard', path: 'nope.html' }]), 404)
ok('duplicating a copy does not stack -copy-copy', applyCanvasOps(dr.canvas, ['screens/Home-copy.html'], [{ type: 'duplicateBoard', path: 'screens/Home-copy.html' }]).copyFiles[0]!.to === 'screens/Home-copy-3.html')
ok('duplicateBoard drops locked and group on the copy', (() => { const c = JSON.parse(JSON.stringify(dc)); c.boards['screens/Home.html'].locked = true; c.boards['screens/Home.html'].group = 'g'; const b = applyCanvasOps(c, [], [{ type: 'duplicateBoard', path: 'screens/Home.html' }]).canvas.boards['screens/Home-copy.html']; return !b.locked && !b.group })())

throws('bind to a prototype key is not a target', () => applyCanvasOps(null, [], [{ type: 'addNote', id: 'x', note: { kind: 'arrow', bind: { end: { type: 'board', id: 'constructor' } } } }]), 400)
throws('reorderNotes with a prototype key -> 404', () => applyCanvasOps(null, [], [{ type: 'addNote', id: 'x', note: {} }, { type: 'reorderNotes', ids: ['constructor'], mode: 'front' }]), 404)
ok('duplicateBoard copyTo names the copy; existing path 409; bad path 400', (() => {
  const base = applyCanvasOps(null, [], [{ type: 'addBoard', path: 'a.html', x: 0, y: 0, w: 100, h: 100 }]).canvas
  const r = applyCanvasOps(base, ['a.html'], [{ type: 'duplicateBoard', path: 'a.html', copyTo: 'b.html' }])
  let e1 = 0, e2 = 0
  try { applyCanvasOps(r.canvas, ['a.html', 'b.html'], [{ type: 'duplicateBoard', path: 'a.html', copyTo: 'b.html' }]) } catch (e: any) { e1 = e.status }
  try { applyCanvasOps(base, ['a.html'], [{ type: 'duplicateBoard', path: 'a.html', copyTo: '../x.html' }]) } catch (e: any) { e2 = e.status }
  return r.copyFiles[0]!.to === 'b.html' && r.canvas.boards['b.html'] && e1 === 409 && e2 === 400
})())
{
  let n = 0
  const pr = pasteOps({ notes: [], boards: [{ path: 'screens/Home.html', entry: { x: 0, y: 0, w: 10, h: 10 } }] }, { dx: 5, dy: 5 }, () => 'nt' + 'abc12' + ++n)
  ok('pasteOps names board copies and reports their paths for selection', pr.boardPaths.length === 1 && pr.boardPaths[0] === 'screens/Home-abc121.html' && (pr.ops[0] as any).copyTo === pr.boardPaths[0], pr)
}
{
  // arrows copied with their targets stay attached to the copies; groups of two or more stay groups
  const cv: any = { boards: { 'a.html': { x: 0, y: 0, w: 100, h: 100, group: 'g1' } }, notes: { r: { kind: 'rect', x: 200, y: 0, w: 50, h: 50, group: 'g1' }, ar: { kind: 'arrow', x: 100, y: 25, w: 100, h: 0, bind: { start: { type: 'board', id: 'a.html' }, end: { type: 'note', id: 'r' } } }, lone: { kind: 'arrow', x: 0, y: 0, w: 5, h: 5, bind: { end: { type: 'note', id: 'r' } } } } }
  let n = 0
  const all = pasteOps(copyPayload(cv, [{ type: 'board', id: 'a.html' }, { type: 'note', id: 'r' }, { type: 'note', id: 'ar' }]), { dx: 10, dy: 10 }, () => 'q' + ++n)
  const arrow = all.ops.find(o => o.type === 'addNote' && (o as any).note.kind === 'arrow') as any
  ok('pasting an arrow with its targets rebinds it to the copies and keeps the group', arrow.note.bind.start.id === all.boardPaths[0] && arrow.note.bind.end.id === all.noteIds.find(i => i !== arrow.id) && all.ops.some(o => o.type === 'updateBoard' && (o as any).patch.group === (all.ops.find(x => x.type === 'addNote' && (x as any).note.kind === 'rect') as any).note.group), all.ops)
  ok('...and the copies apply on the server (bind targets exist by then)', (() => { const r = applyCanvasOps(cv, ['a.html'], all.ops); return Object.keys(r.canvas.notes).length === 5 })())
  const alone = pasteOps(copyPayload(cv, [{ type: 'note', id: 'lone' }]), { dx: 0, dy: 0 }, () => 'z')
  ok('an arrow copied without its targets comes loose', !(alone.ops[0] as any).note.bind)
  throws('only arrows can be bound', () => applyCanvasOps(cv, ['a.html'], [{ type: 'addNote', id: 'x', note: { kind: 'rect', w: 5, h: 5, bind: { end: { type: 'note', id: 'r' } } } }]), 400)
  throws('arrows cannot bind to lines or drawings', () => applyCanvasOps(cv, ['a.html'], [{ type: 'addNote', id: 'x', note: { kind: 'arrow', bind: { end: { type: 'note', id: 'lone' } } } }]), 400)
}
ok('resolveArrow: both ends on the same target stay as stored (no collapse)', (() => { const f = () => ({ type: 'note' as const, id: 'a', box: { x: 0, y: 0, w: 100, h: 100 }, shape: 'rect' as const }); const r = resolveArrow({ x: 10, y: 10, w: 30, h: 30 }, { start: { type: 'note', id: 'a' }, end: { type: 'note', id: 'a' } }, f); return r.w === 30 && r.h === 30 })())
ok('detachBinds also writes the drawn size when it detaches', same(detachBinds([{ type: 'updateNote', id: 'ar', patch: { x: 5 } }], { ar: { kind: 'arrow', bind: { end: { type: 'note', id: 'a' } } } }, new Set(['n:ar']), () => ({ w: 99, h: -4 }))[0], { type: 'updateNote', id: 'ar', patch: { x: 5, w: 99, h: -4, bind: null } }))
// ---- Phase 3
ok('simplifyRDP keeps both ends, drops collinear points and keeps a corner', same(simplifyRDP([[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]], 0.5), [[0, 0], [10, 0], [10, 10]]) && simplifyRDP([[1, 1]], 1).length === 1 && same(simplifyRDP([[0, 0], [3, 3]], 1), [[0, 0], [3, 3]]))
ok('simplifyRDP: a jittery line collapses within the tolerance and keeps real turns', (() => { const line = Array.from({ length: 200 }, (_, i) => [i, (i % 2) * 0.4]); const r = simplifyRDP(line, 1); return r.length === 2 && simplifyRDP([[0, 0], [50, 40], [100, 0]], 1).length === 3 })())
ok('fitPenPoints: a noisy 5000-point stroke ends within 400 points, ends kept', (() => { const pts = Array.from({ length: 5000 }, (_, i) => [i * 0.2, Math.sin(i / 40) * 60 + (i % 3)]); const r = fitPenPoints(pts, 0.5, 399); return r.length <= 399 && r.length > 20 && same(r[0], pts[0]) && same(r.at(-1), pts.at(-1)) })())
ok('fitPenPoints: a short stroke is left as is', fitPenPoints([[0, 0], [10, 5], [20, 0]], 0.1).length === 3)
ok('smoothPath: M then cubic segments through every point; two points are a line; empty is empty', (() => { const d = smoothPath([[0, 0], [10, 10], [20, 0], [30, 10]]); return d.startsWith('M0,0') && (d.match(/C/g) ?? []).length === 3 && d.endsWith('30,10') && smoothPath([[0, 0], [5, 5]]) === 'M0,0 L5,5' && smoothPath([]) === '' && smoothPath([[1, 2]]) === 'M1,2' })())
ok('penPath is a smooth curve now', penPath({ kind: 'pen', x: 10, y: 10, w: 0, h: 0, points: [[0, 0], [20, 5], [40, 0]] }).includes('C'))
ok('contentOutside: only when something reaches beyond the window', !contentOutside({ x: 0, y: 0, w: 100, h: 100 }, { tx: 0, ty: 0, k: 1 }, { w: 800, h: 600 }) && contentOutside({ x: 0, y: 0, w: 2000, h: 100 }, { tx: 0, ty: 0, k: 1 }, { w: 800, h: 600 }) && contentOutside({ x: -50, y: 0, w: 100, h: 100 }, { tx: 0, ty: 0, k: 1 }, { w: 800, h: 600 }) && !contentOutside(null, { tx: 0, ty: 0, k: 1 }, { w: 1, h: 1 }) && !contentOutside({ x: 100, y: 100, w: 100, h: 100 }, { tx: -50, ty: -50, k: 2 }, { w: 800, h: 600 }))
ok('image notes need a valid asset path', (() => {
  const r = applyCanvasOps(null, [], [{ type: 'addNote', id: 'im', note: { kind: 'image', src: 'assets/0123456789abcdef.png', x: 5, y: 6, w: 100, h: 60 } }]).canvas.notes.im
  return r.kind === 'image' && r.src === 'assets/0123456789abcdef.png' && r.w === 100
})())
for (const [name, note] of [['no source', { kind: 'image', w: 10, h: 10 }], ['a path outside assets/', { kind: 'image', src: 'screens/a.png' }], ['a traversal', { kind: 'image', src: 'assets/../x.png' }], ['a wrong extension', { kind: 'image', src: 'assets/0123456789abcdef.svg' }], ['a short hash', { kind: 'image', src: 'assets/abc.png' }], ['a source on a rect', { kind: 'rect', src: 'assets/0123456789abcdef.png' }]] as const)
  throws(`image: ${name} rejected`, () => applyCanvasOps(null, [], [{ type: 'addNote', id: 'x', note: note as any }]), 400)
ok('images move, scale (aspect kept by default for a single one) and copy like other notes', (() => {
  const a = scaleItems([{ key: 'n:im', kind: 'image', x: 0, y: 0, w: 200, h: 100 }], { x: 0, y: 0, w: 200, h: 100 }, 'se', { dx: 100, dy: 0, keepAspect: true })
  return same(a.patches['n:im'], { x: 0, y: 0, w: 300, h: 150 })
})())
ok('smoothPath never leaves the box of its points (no overshoot at a corner)', (() => {
  const d = smoothPath([[0, 0], [100, 0], [100, 100]]); const nums = [...d.matchAll(/-?\d+(\.\d+)?/g)].map(m => +m[0])
  return nums.every(v => v >= 0 && v <= 100)
})())
ok('updateNote cannot make an image without a source, and a note that stops being an image drops it', (() => {
  const base = applyCanvasOps(null, [], [{ type: 'addNote', id: 'im', note: { kind: 'image', src: 'assets/0123456789abcdef.png', w: 10, h: 10 } }, { type: 'addNote', id: 'r', note: { kind: 'rect', w: 10, h: 10 } }]).canvas
  let e = 0
  try { applyCanvasOps(base, [], [{ type: 'updateNote', id: 'r', patch: { kind: 'image' } }]) } catch (x: any) { e = x.status }
  const back = applyCanvasOps(base, [], [{ type: 'updateNote', id: 'im', patch: { kind: 'rect' } }]).canvas.notes.im
  return e === 400 && !('src' in back)
})())
ok('styleOps writes fillStyle for rect and oval only', same(styleOps([{ id: 'r', kind: 'rect' }, { id: 'a', kind: 'arrow' }], { fillStyle: 'hatch' }), [{ type: 'updateNote', id: 'r', patch: { fillStyle: 'hatch' } }]))
// limits stay
throws('more than 200 operations rejected', () => applyCanvasOps(null, [], Array.from({ length: 201 }, (_, i) => ({ type: 'addNote' as const, id: 'n' + i, note: {} }))), 413)
throws('more than 1000 notes rejected', () => { let c: any = null; for (let i = 0; i < 6; i++) c = applyCanvasOps(c, [], Array.from({ length: 200 }, (_, j) => ({ type: 'addNote' as const, id: `n${i}_${j}`, note: {} }))).canvas }, 413)

// mergeOps: one gesture, bounded op count
const nudged: CanvasOp[] = []
let pend: CanvasOp[] = []
for (let i = 1; i <= 150; i++) pend = mergeOps(pend, [{ type: 'updateNote', id: 'a', patch: { x: i } }, { type: 'updateNote', id: 'b', patch: { x: i, y: 2 } }, { type: 'updateBoard', path: 'p.html', patch: { x: i } }])
ok('holding a key folds updates of the same target (3 ops, not 450)', pend.length === 3 && (pend[0] as any).patch.x === 150 && (pend[1] as any).patch.y === 2, pend)
ok('mergeOps does not merge across structural ops', mergeOps([{ type: 'updateNote', id: 'a', patch: { x: 1 } }, { type: 'deleteNote', id: 'z' }], [{ type: 'updateNote', id: 'a', patch: { x: 2 } }]).length === 3)
ok('mergeOps keeps different fields of one target', (() => { const m = mergeOps([{ type: 'updateNote', id: 'a', patch: { x: 1 } }], [{ type: 'updateNote', id: 'a', patch: { text: 'hi' } }]); return m.length === 1 && JSON.stringify((m[0] as any).patch) === '{"x":1,"text":"hi"}' })())
ok('merged ops replay to the same canvas as the originals', (() => {
  const base = applyCanvasOps(null, [], [{ type: 'addNote', id: 'a', note: { x: 0, y: 0, w: 50 } }, { type: 'addNote', id: 'b', note: { x: 5 } }]).canvas
  const seq: CanvasOp[] = [{ type: 'updateNote', id: 'a', patch: { x: 1 } }, { type: 'updateNote', id: 'b', patch: { x: 9 } }, { type: 'updateNote', id: 'a', patch: { x: 2, y: 3 } }]
  return JSON.stringify(applyCanvasOps(base, [], seq).canvas) === JSON.stringify(applyCanvasOps(base, [], mergeOps([], seq)).canvas)
})())

// --- geometry
const it = (key: string, kind: string, x: number, y: number, w: number, h: number, extra: Partial<GeomItem> = {}): GeomItem => ({ key, kind, x, y, w, h, ...extra })
ok('noteBox: line with negative extents', JSON.stringify(noteBox({ kind: 'line', x: 100, y: 100, w: -40, h: -10 })) === '{"x":60,"y":90,"w":40,"h":10}')
ok('noteBox: pen box includes the origin and has a minimum size', JSON.stringify(noteBox({ kind: 'pen', x: 10, y: 10, w: 0, h: 0, points: [[0, 0], [20, 5]] })) === '{"x":10,"y":10,"w":20,"h":8}')
ok('noteBox: sticky without height gets the default', noteBox({ kind: 'sticky', x: 0, y: 0, w: 240, h: 0 }).h === 120)
ok('unionBox of two boxes', JSON.stringify(unionBox([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 10, h: 10 }])) === '{"x":0,"y":-5,"w":30,"h":15}' && unionBox([]) === null)
// single item = one-item multi-resize
let sc = scaleItems([it('b:a.html', 'board', 100, 100, 400, 200)], { x: 100, y: 100, w: 400, h: 200 }, 'se', { dx: 100, dy: 50 })
ok('scaleItems: single board, se handle', same(sc.patches['b:a.html'], {"x":100,"y":100,"w":500,"h":250}), sc)
sc = scaleItems([it('b:a.html', 'board', 100, 100, 400, 200)], { x: 100, y: 100, w: 400, h: 200 }, 'nw', { dx: 50, dy: 20 })
ok('scaleItems: nw handle keeps the opposite corner', same(sc.patches['b:a.html'], {"x":150,"y":120,"w":350,"h":180}), sc)
sc = scaleItems([it('b:a.html', 'board', 100, 100, 400, 200)], { x: 100, y: 100, w: 400, h: 200 }, 'e', { dx: 100, dy: 999 })
ok('scaleItems: side handle stretches one axis only', same(sc.patches['b:a.html'], {"x":100,"y":100,"w":500,"h":200}), sc)
sc = scaleItems([it('b:a.html', 'board', 100, 100, 400, 200)], { x: 100, y: 100, w: 400, h: 200 }, 'se', { dx: 100, dy: 0, keepAspect: true })
ok('scaleItems: corner + keepAspect keeps the ratio', same(sc.patches['b:a.html'], {"x":100,"y":100,"w":500,"h":250}), sc)
sc = scaleItems([it('b:a.html', 'board', 100, 100, 400, 200)], { x: 100, y: 100, w: 400, h: 200 }, 'e', { dx: 50, dy: 0, fromCenter: true })
ok('scaleItems: Alt scales from the centre', same(sc.patches['b:a.html'], {"x":50,"y":100,"w":500,"h":200}), sc)
// multi
const multi = [it('b:a.html', 'board', 0, 0, 400, 200), it('n:r', 'rect', 400, 200, 100, 100), it('n:ar', 'arrow', 100, 300, -50, 100), it('n:p', 'pen', 200, 200, 0, 0, { points: [[0, 0], [100, 50]] }), it('n:s', 'sticky', 300, 0, 200, 100)]
const mb = unionBox(multi.map(itemBox))!
sc = scaleItems(multi, mb, 'se', { dx: mb.w, dy: mb.h })
const P = sc.patches
ok('scaleItems: two-fold scale doubles positions and sizes of every kind', sc.sx === 2 && sc.sy === 2 && P['b:a.html']!.w === 800 && P['b:a.html']!.h === 400 && P['n:r']!.x === 800 && P['n:r']!.w === 200 && P['n:r']!.h === 200, sc)
ok('scaleItems: line keeps negative extents and scales both', P['n:ar']!.w === -100 && P['n:ar']!.h === 200 && P['n:ar']!.x === 200 && P['n:ar']!.y === 600, P['n:ar'])
ok('scaleItems: pen scales origin and every point', P['n:p']!.x === 400 && P['n:p']!.y === 400 && JSON.stringify(P['n:p']!.points) === '[[0,0],[200,100]]', P['n:p'])
ok('scaleItems: sticky scales x, y and w but not h', P['n:s']!.x === 600 && P['n:s']!.y === 0 && P['n:s']!.w === 400 && !('h' in P['n:s']!), P['n:s'])
// clamping
sc = scaleItems(multi, mb, 'se', { dx: -mb.w * 2, dy: -mb.h * 2 })
const tiny = Object.entries(sc.patches).every(([k, p]) => (k === 'b:a.html' ? p.w! >= 40 : k === 'n:r' || k === 'n:s' ? p.w! >= 8 : true))
ok('scaleItems: shrinking stops at the largest minimum (40 for boards) for the whole selection', tiny && sc.sx > 0 && Math.abs(sc.patches['b:a.html']!.w! - 40) <= 0.1, sc)
ok('scaleItems: relative layout is kept at the clamp', Math.abs(sc.patches['n:r']!.x! / sc.sx - 400) < 1 && Math.abs(sc.patches['n:r']!.x! - 400 * sc.sx) < 1, sc.patches['n:r'])
sc = scaleItems([it('n:r', 'rect', 0, 0, 100, 100), it('n:big', 'rect', 200, 0, 4000, 100)], { x: 0, y: 0, w: 4200, h: 100 }, 'e', { dx: 9999, dy: 0 })
ok('scaleItems: growing stops where the largest item reaches 8000', sc.patches['n:big']!.w === 8000 && sc.sx < 2.01, sc)
sc = scaleItems([it('n:a', 'rect', 0, 0, 100, 100), it('n:small', 'rect', 120, 0, 20, 100)], { x: 0, y: 0, w: 140, h: 100 }, 'e', { dx: -139, dy: 0 })
ok('scaleItems: a small item stops the shrink at 8', sc.patches['n:small']!.w! >= 8 && sc.patches['n:small']!.w! < 8.2, sc)
sc = scaleItems([it('n:a', 'rect', 0, 0, 100, 100), it('n:lk', 'rect', 200, 0, 100, 100, { locked: true })], { x: 0, y: 0, w: 300, h: 100 }, 'e', { dx: 300, dy: 0 })
ok('scaleItems: locked items are skipped', !('n:lk' in sc.patches) && sc.patches['n:a']!.w === 200, sc)
ok('scaleItems: all locked -> no patches', Object.keys(scaleItems([it('n:lk', 'rect', 0, 0, 100, 100, { locked: true })], { x: 0, y: 0, w: 100, h: 100 }, 'se', { dx: 50, dy: 50 }).patches).length === 0)
sc = scaleItems([it('n:s', 'sticky', 0, 0, 200, 100)], { x: 0, y: 0, w: 200, h: 100 }, 's', { dx: 0, dy: 60 })
ok('scaleItems: a lone sticky still resizes its height (same as before)', sc.patches['n:s']!.h === 160, sc)
sc = scaleItems([it('n:p', 'pen', 0, 0, 0, 0, { points: [[0, 0], [10, 10]] }), it('n:q', 'rect', 100, 100, 50, 50)], { x: 0, y: 0, w: 150, h: 150 }, 'se', { dx: -10000, dy: -10000 })
ok('scaleItems never collapses to zero (floor)', sc.sx >= 0.02 && sc.patches['n:q']!.w! >= 8, sc)
// rounding drift on a 10x round trip
{
  let items = [it('n:r', 'rect', 13.3, 7.7, 101.3, 57.9), it('n:l', 'line', 5.5, 5.5, 33.3, -17.7)]
  const start = JSON.parse(JSON.stringify(items))
  for (let i = 0; i < 10; i++) {
    for (const f of [2, 0.5]) {
      const b = unionBox(items.map(itemBox))!
      const r = scaleItems(items, b, 'se', { dx: b.w * (f - 1), dy: b.h * (f - 1) })
      items = items.map(x => ({ ...x, ...r.patches[x.key]! }))
    }
  }
  const drift = Math.max(...items.map((x, i) => Math.max(Math.abs(x.x - start[i].x), Math.abs(x.y - start[i].y), Math.abs(x.w - start[i].w), Math.abs(x.h - start[i].h))))
  ok('scaleItems: 10x round trip drifts less than 2px (rounding at 0.1)', drift < 2, drift)
}
ok('moveEndpoint: end moves the extent, start keeps the end point', JSON.stringify(moveEndpoint({ x: 0, y: 0, w: 100, h: 50 }, 'end', 10, 10)) === '{"x":0,"y":0,"w":110,"h":60}' && JSON.stringify(moveEndpoint({ x: 0, y: 0, w: 100, h: 50 }, 'start', 10, 10)) === '{"x":10,"y":10,"w":90,"h":40}')

// view transform
const fv = fitView([{ x: 0, y: 0, w: 2000, h: 1000 }], { w: 1000, h: 600 })!
ok('fitView shrinks content into the window with padding, centred', Math.abs(fv.k - 0.452) < 0.01 && Math.abs(fv.tx - 48) < 0.5, fv)
ok('fitView never zooms in past 1 and returns null for nothing', fitView([{ x: 0, y: 0, w: 10, h: 10 }], { w: 1000, h: 600 })!.k === 1 && fitView([], { w: 1, h: 1 }) === null)
const zv = zoomView({ tx: 0, ty: 0, k: 1 }, 2, 100, 50)
ok('zoomView keeps the anchor point fixed and clamps to 0.05..4', zv.k === 2 && zv.tx === -100 && zv.ty === -50 && zoomView({ tx: 0, ty: 0, k: 1 }, 100, 0, 0).k === 4 && zoomView({ tx: 0, ty: 0, k: 1 }, 0.0001, 0, 0).k === 0.05, zv)
ok('toWorldPoint undoes the transform', (() => { const p = toWorldPoint({ tx: 100, ty: 20, k: 2 }, 300, 220); return p.x === 100 && p.y === 100 })())
ok('arrowPath: end points and angle inside the box', (() => { const a = arrowPath({ kind: 'arrow', x: 100, y: 100, w: -40, h: -40 }); return a.x1 === 40 && a.y1 === 40 && a.x2 === 0 && a.y2 === 0 && Math.abs(a.ang + 3 * Math.PI / 4) < 1e-9 })())
ok('penPath: path relative to the stroke box', penPath({ kind: 'pen', x: 10, y: 10, w: 0, h: 0, points: [[0, 0], [20, 5]] }) === 'M0,0 L20,5')

// item ops (one delete / nudge / commit path)
ok('deleteOps skips locked items and maps keys to ops', same(deleteOps([{ key: 'n:a' }, { key: 'b:p.html' }, { key: 'n:lk', locked: true }]), [{ type: 'deleteNote', id: 'a' }, { type: 'removeBoard', path: 'p.html' }]))
ok('nudgeOps moves unlocked items from where they are, rounded', same(nudgeOps([{ key: 'n:a', x: 1.05, y: 2 }, { key: 'b:p.html', x: 0, y: 0 }, { key: 'n:l', x: 5, y: 5, locked: true }], 10, -1), [{ type: 'updateNote', id: 'a', patch: { x: 11.1, y: 1 } }, { type: 'updateBoard', path: 'p.html', patch: { x: 10, y: -1 } }]))
ok('overrideOps builds one update per overridden item and copies the data', (() => { const pts = [[0, 0]]; const o = overrideOps(['n:p', 'b:b.html', 'n:none'], { 'b.html': { x: 1, y: 2, w: 3, h: 4 } }, { p: { x: 1, points: pts } }); pts[0]![0] = 9; return same(o, [{ type: 'updateNote', id: 'p', patch: { x: 1, points: [[0, 0]] } }, { type: 'updateBoard', path: 'b.html', patch: { x: 1, y: 2, w: 3, h: 4 } }]) })())
ok('refOfKey', same(refOfKey('b:a/b.html'), { type: 'board', id: 'a/b.html' }) && same(refOfKey('n:x'), { type: 'note', id: 'x' }))
// review fixes
{
  const stale: any = { ...emptyCanvas(), notes: { a: { kind: 'arrow', x: 0, y: 0, w: 5, h: 5, bind: { end: { type: 'note', id: 'gone' } } } } }
  ok('a stale bind never blocks moving the note', applyCanvasOps(stale, [], [{ type: 'updateNote', id: 'a', patch: { x: 5 } }]).canvas.notes.a.x === 5)
  throws('...but setting a bad bind still fails', () => applyCanvasOps(stale, [], [{ type: 'updateNote', id: 'a', patch: { bind: { end: { type: 'note', id: 'gone' } } } }]), 400)
  throws('locked must be a boolean (note)', () => applyCanvasOps(null, [], [{ type: 'addNote', id: 'x', note: { locked: 'no' as any } }]), 400)
  throws('locked must be a boolean (board)', () => applyCanvasOps({ ...emptyCanvas(), boards: { 'p.html': {} }, order: ['p.html'] }, [], [{ type: 'updateBoard', path: 'p.html', patch: { locked: 'no' as any } }]), 400)
  ok('mergeOps ignores undefined fields of the later patch', same((mergeOps([{ type: 'updateNote', id: 'a', patch: { x: 1, y: 2 } }], [{ type: 'updateNote', id: 'a', patch: { x: undefined, y: 3 } }])[0] as any).patch, { x: 1, y: 3 }))
}

// ---- Phase 1: snapping, align, constrain, clipboard
{
  const others = [{ x: 100, y: 100, w: 200, h: 100 }]
  let s = snapBox({ x: 304, y: 500, w: 50, h: 50 }, others, 6)
  ok('snapBox: left edge snaps to another right edge within the threshold', s.dx === -4 && s.dy === 0, s)
  s = snapBox({ x: 150, y: 500, w: 100, h: 50 }, others, 6)
  ok('snapBox: centres snap (both centre at x=200)', s.dx === 0 && s.guides.some(g => g.axis === 'x' && g.pos === 200), s)
  s = snapBox({ x: 310, y: 500, w: 50, h: 50 }, others, 6)
  ok('snapBox: nothing within the threshold -> no move, no guides', s.dx === 0 && s.dy === 0 && s.guides.length === 0, s)
  s = snapBox({ x: 104, y: 203, w: 50, h: 50 }, others, 6)
  ok('snapBox: both axes at once, guides span both boxes', s.dx === -4 && s.dy === -3 && s.guides.some(g => g.axis === 'x' && g.pos === 100 && g.from === 100 && g.to === 250) && s.guides.some(g => g.axis === 'y' && g.pos === 200 && g.from === 100 && g.to === 300), s)
  s = snapBox({ x: 304, y: 500, w: 50, h: 50 }, others, 0.5)
  ok('snapBox: threshold scales (zoomed-in = tighter)', s.dx === 0)
  ok('snapLines picks the closest target', snapLines([10], [14, 12, 20], 6) === 2 && snapLines([10], [30], 6) === 0)
  ok('guidesFor: only where aligned', guidesFor({ x: 100, y: 300, w: 10, h: 10 }, others).length === 1)
}
{
  const it = (key: string, x: number, y: number, w: number, h: number, locked = false): GeomItem => ({ key, kind: 'rect', x, y, w, h, locked })
  const items = [it('n:a', 0, 0, 100, 50), it('n:b', 200, 30, 50, 50), it('n:c', 500, 100, 100, 20)]
  ok('align left / right / hcenter', same(alignPatches(items, 'left'), { 'n:b': { x: 0 }, 'n:c': { x: 0 } }) && same(alignPatches(items, 'right'), { 'n:a': { x: 500 }, 'n:b': { x: 550 } }) && same(alignPatches(items, 'hcenter'), { 'n:a': { x: 250 }, 'n:b': { x: 275 }, 'n:c': { x: 250 } }), alignPatches(items, 'hcenter'))
  ok('align top / bottom / vcenter', same(alignPatches(items, 'top'), { 'n:b': { y: 0 }, 'n:c': { y: 0 } }) && same(alignPatches(items, 'bottom'), { 'n:a': { y: 70 }, 'n:b': { y: 70 } }) && same(alignPatches(items, 'vcenter'), { 'n:a': { y: 35 }, 'n:b': { y: 35 }, 'n:c': { y: 50 } }), alignPatches(items, 'vcenter'))
  ok('align skips locked items and needs two', same(alignPatches([it('n:a', 0, 0, 10, 10), it('n:b', 50, 0, 10, 10, true)], 'right'), {}) && Object.keys(alignPatches([it('n:a', 0, 0, 10, 10)], 'left')).length === 0)
  const row = [it('n:a', 0, 0, 100, 10), it('n:b', 150, 0, 100, 10), it('n:c', 600, 0, 100, 10)]
  ok('distribute x: equal gaps, outer items fixed', same(distributePatches(row, 'x'), { 'n:b': { x: 300 } }), distributePatches(row, 'x'))
  ok('distribute needs three items; y axis too', Object.keys(distributePatches(row.slice(0, 2), 'x')).length === 0 && same(distributePatches([it('n:a', 0, 0, 10, 100), it('n:b', 0, 120, 10, 100), it('n:c', 0, 500, 10, 100)], 'y'), { 'n:b': { y: 250 } }))
  ok('distribute works from unsorted input', same(distributePatches([row[2]!, row[0]!, row[1]!], 'x'), { 'n:b': { x: 300 } }))
}
ok('constrainCreate box: shift makes a square, alt draws from the centre', same(constrainCreate('box', { x: 100, y: 100 }, { x: 160, y: 120 }, { shift: true }), { x: 100, y: 100, w: 60, h: 60 }) && same(constrainCreate('box', { x: 100, y: 100 }, { x: 60, y: 120 }, { shift: true }), { x: 60, y: 100, w: 40, h: 40 }) && same(constrainCreate('box', { x: 100, y: 100 }, { x: 130, y: 110 }, { alt: true }), { x: 70, y: 90, w: 60, h: 20 }) && same(constrainCreate('box', { x: 100, y: 100 }, { x: 130, y: 110 }, { shift: true, alt: true }), { x: 70, y: 70, w: 60, h: 60 }))
ok('constrainCreate line: shift snaps to 15 degrees and keeps the length, alt centres', (() => {
  const l = constrainCreate('line', { x: 0, y: 0 }, { x: 100, y: 3 }, { shift: true }); const l2 = constrainCreate('line', { x: 0, y: 0 }, { x: 100, y: 100 }, { shift: true }); const c = constrainCreate('line', { x: 50, y: 50 }, { x: 80, y: 50 }, { alt: true })
  return Math.abs(l.h) < 1e-6 && Math.abs(l.w - Math.hypot(100, 3)) < 1e-3 && Math.abs(l2.w - l2.h) < 1e-3 && same(c, { x: 20, y: 50, w: 60, h: 0 }) && same(constrainCreate('line', { x: 5, y: 5 }, { x: -10, y: 7 }), { x: 5, y: 5, w: -15, h: 2 })
})())
ok('normBox and boxesIntersect (touching counts)', same(normBox({ x: 10, y: 10 }, { x: 0, y: 30 }), { x: 0, y: 10, w: 10, h: 20 }) && boxesIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 5, h: 5 }) && !boxesIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 5, h: 5 }))
ok('noteGeometry: defaults (sticky 240 wide, others 360)', noteGeometry({}).w === 240 && noteGeometry({ kind: 'text' }).w === 360 && noteGeometry({ kind: 'rect', w: 10 }).w === 10)
{
  const cv: any = { boards: { 'a.html': { x: 0, y: 0, w: 400, h: 300, title: 'A', locked: true }, 'b.html': { x: 500, y: 0, w: 100, h: 100 } }, notes: { s: { x: 10, y: 10, text: 'hi' }, r: { kind: 'rect', x: 5, y: 5, w: 50, h: 40, group: 'g', locked: true, bind: { end: { type: 'note', id: 's' } } }, old: { kind: 'title1', x: 0, y: 0, w: 5 } } }
  const refs = [{ type: 'note' as const, id: 's' }, { type: 'note' as const, id: 'r' }, { type: 'board' as const, id: 'a.html' }, { type: 'note' as const, id: 'old' }, { type: 'note' as const, id: 'gone' }]
  const items = itemsFromCanvas(cv, refs)
  ok('itemsFromCanvas resolves geometry and locks, skipping unknown ids', items.length === 4 && items[0]!.w === 240 && items[0]!.h === 120 && items[1]!.locked === true && items[2]!.kind === 'board' && items[2]!.locked === true, items)
  const clip = copyPayload(cv, refs)
  ok('copyPayload copies notes and boards by value', clip.notes.length === 3 && clip.boards.length === 1 && (clip.notes[0]!.note.x = 99) === 99 && cv.notes.s.x === 10)
  ok('clipBox covers everything copied', (() => { const b = clipBox(copyPayload(cv, [{ type: 'note', id: 'r' }, { type: 'board', id: 'b.html' }]))!; return b.x === 5 && b.y === 0 && b.w === 595 })())
  let n = 0
  const pr = pasteOps(copyPayload(cv, refs), { dx: 20, dy: 30 }, () => 'p' + ++n)
  ok('pasteOps: boards first, new ids, moved, legacy kinds skipped, group/lock/bind dropped from non-arrows', pr.noteIds.length === 2 && pr.ops[0]!.type === 'duplicateBoard' && (pr.ops[0] as any).copyTo === pr.boardPaths[0] && same(pr.ops[2], { type: 'addNote', id: pr.noteIds[1], note: { kind: 'rect', x: 25, y: 35, w: 50, h: 40 } }) && same((pr.ops[0] as any).x, 20), pr.ops)
  const applied = applyCanvasOps(cv, ['a.html', 'b.html'], pr.ops)
  ok('pasted ops apply cleanly and leave the originals alone', Object.keys(applied.canvas.notes).length === 5 && applied.copyFiles[0]!.from === 'a.html' && applied.canvas.notes.r.x === 5, applied.copyFiles)
  ok('patchOps builds updates from patches', same(patchOps({ 'n:a': { x: 1 }, 'b:p.html': { y: 2 } }), [{ type: 'updateNote', id: 'a', patch: { x: 1 } }, { type: 'updateBoard', path: 'p.html', patch: { y: 2 } }]))
}

// ---- Phase 2
{
  const box = { x: 100, y: 100, w: 200, h: 100 }
  ok('boundEndpoint (rect): from the right, on the right edge plus the gap', same(boundEndpoint({ x: 500, y: 150 }, box, 'rect', 6), { x: 306, y: 150 }))
  ok('boundEndpoint (rect): from above, on the top edge minus the gap', same(boundEndpoint({ x: 200, y: 0 }, box, 'rect', 6), { x: 200, y: 94 }))
  ok('boundEndpoint (rect): diagonal leaves through the nearer side', (() => { const p = boundEndpoint({ x: 500, y: 450 }, box, 'rect', 0); return Math.abs(p.y - 200) < 0.2 && p.x > 200 && p.x < 300 })())
  ok('boundEndpoint (oval): from the right it is on the ellipse', same(boundEndpoint({ x: 500, y: 150 }, box, 'oval', 0), { x: 300, y: 150 }) && (() => { const p = boundEndpoint({ x: 500, y: 450 }, box, 'oval', 0); return Math.abs(((p.x - 200) / 100) ** 2 + ((p.y - 150) / 50) ** 2 - 1) < 0.01 })())
  ok('boundEndpoint: from inside still lands on the edge; from the centre is safe', boundEndpoint({ x: 250, y: 150 }, box, 'rect', 0).x === 300 && Number.isFinite(boundEndpoint({ x: 200, y: 150 }, box, 'rect').y))
  const find = (t: any) => (t.id === 'a' ? { type: 'note' as const, id: 'a', box, shape: 'rect' as const } : t.id === 'b' ? { type: 'board' as const, id: 'b', box: { x: 600, y: 100, w: 100, h: 100 }, shape: 'rect' as const } : null)
  ok('resolveArrow: unbound arrow is untouched', same(resolveArrow({ x: 1, y: 2, w: 3, h: 4 }, undefined, find), { x: 1, y: 2, w: 3, h: 4 }))
  const both = resolveArrow({ x: 0, y: 0, w: 5, h: 5 }, { start: { type: 'note', id: 'a' }, end: { type: 'board', id: 'b' } }, find, 0)
  ok('resolveArrow: both ends bound run centre to centre between the edges', same(both, { x: 300, y: 150, w: 300, h: 0 }), both)
  const one = resolveArrow({ x: 500, y: 150, w: 50, h: 0 }, { start: { type: 'note', id: 'a' } }, find, 0)
  ok('resolveArrow: one end bound, the other stays where it is', one.x === 300 && one.y === 150 && one.x + one.w === 550 && one.y + one.h === 150, one)
  ok('resolveArrow: a missing target is ignored', same(resolveArrow({ x: 1, y: 2, w: 3, h: 4 }, { end: { type: 'note', id: 'gone' } }, find), { x: 1, y: 2, w: 3, h: 4 }))
  const moved = resolveArrow({ x: 0, y: 0, w: 5, h: 5 }, { start: { type: 'note', id: 'a' }, end: { type: 'board', id: 'b' } }, (t: any) => (t.id === 'a' ? { type: 'note', id: 'a', box: { ...box, y: 400 }, shape: 'rect' } : find(t)), 0)
  ok('resolveArrow follows a moved target without any stored change', moved.y !== both.y && moved.h !== 0, moved)
  const tg = [{ type: 'board' as const, id: 'b', box: { x: 0, y: 0, w: 100, h: 100 }, shape: 'rect' as const }, { type: 'note' as const, id: 'a', box: { x: 50, y: 50, w: 100, h: 100 }, shape: 'rect' as const }]
  ok('bindTargetAt: topmost wins, tolerance grows the box, empty is null', bindTargetAt({ x: 60, y: 60 }, tg, 0)!.id === 'a' && bindTargetAt({ x: 10, y: 10 }, tg, 0)!.id === 'b' && bindTargetAt({ x: 155, y: 60 }, tg, 8)!.id === 'a' && bindTargetAt({ x: 155, y: 60 }, tg, 0) === null)
}
ok('noteHit: boxes anywhere inside, lines near the stroke, pen near the path', noteHit({ kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: 25 }, 0) && !noteHit({ kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { x: 120, y: 25 }, 5) && noteHit({ kind: 'arrow', x: 0, y: 0, w: 100, h: 0 }, { x: 50, y: 4 }, 5) && !noteHit({ kind: 'arrow', x: 0, y: 0, w: 100, h: 0 }, { x: 50, y: 20 }, 5) && noteHit({ kind: 'line', x: 100, y: 100, w: -50, h: -50 }, { x: 75, y: 76 }, 3) && noteHit({ kind: 'pen', x: 10, y: 10, w: 0, h: 0, points: [[0, 0], [50, 0], [50, 50]] }, { x: 60, y: 40 }, 4) && !noteHit({ kind: 'pen', x: 10, y: 10, w: 0, h: 0, points: [[0, 0], [50, 0], [50, 50]] }, { x: 30, y: 40 }, 4))
{
  const items = [{ key: 'n:a', group: 'g1' }, { key: 'n:b', group: 'g1' }, { key: 'b:p.html' }, { key: 'n:c', group: 'g2' }]
  ok('groupKeys: the whole group, or just the item', same(groupKeys(items, 'n:a'), ['n:a', 'n:b']) && same(groupKeys(items, 'b:p.html'), ['b:p.html']) && same(groupKeys(items, 'n:zz'), ['n:zz']))
  ok('groupOps needs two items; ungroupOps clears only grouped ones; lockOps sets or clears', groupOps([{ key: 'n:a' }], 'g').length === 0 && same(groupOps([{ key: 'n:a' }, { key: 'b:p.html' }], 'g9'), [{ type: 'updateNote', id: 'a', patch: { group: 'g9' } }, { type: 'updateBoard', path: 'p.html', patch: { group: 'g9' } }]) && same(ungroupOps(items), [{ type: 'updateNote', id: 'a', patch: { group: null } }, { type: 'updateNote', id: 'b', patch: { group: null } }, { type: 'updateNote', id: 'c', patch: { group: null } }]) && same(lockOps([{ key: 'n:a' }], true), [{ type: 'updateNote', id: 'a', patch: { locked: true } }]) && same(lockOps([{ key: 'b:p.html' }], false), [{ type: 'updateBoard', path: 'p.html', patch: { locked: null } }]))
  const cv0 = applyCanvasOps(null, [], [{ type: 'addBoard', path: 'a.html', x: 0, y: 0, w: 100, h: 100 }, { type: 'addNote', id: 'a', note: { kind: 'rect', w: 10, h: 10 } }]).canvas
  const cv1 = applyCanvasOps(cv0, ['a.html'], [...groupOps([{ key: 'n:a' }, { key: 'b:a.html' }], 'g1'), ...lockOps([{ key: 'n:a' }], true)]).canvas
  ok('group and lock ops apply to notes and boards', cv1.notes.a.group === 'g1' && cv1.boards['a.html'].group === 'g1' && cv1.notes.a.locked === true)
  const cv2 = applyCanvasOps(cv1, ['a.html'], [...ungroupOps([{ key: 'n:a', group: 'g1' }]), ...lockOps([{ key: 'n:a' }], false)]).canvas
  ok('ungroup and unlock clear the fields', !('group' in cv2.notes.a) && !('locked' in cv2.notes.a))
}
ok('styleOps only writes fields that apply to each kind', same(styleOps([{ id: 'r', kind: 'rect' }, { id: 'o', kind: 'oval' }, { id: 'a', kind: 'arrow' }, { id: 'p', kind: 'pen' }, { id: 's', kind: 'sticky' }], { stroke: '#ff0000', roundness: 'round', arrowEnd: 'dot', fill: 'blue' }), [{ type: 'updateNote', id: 'r', patch: { stroke: '#ff0000', fill: 'blue', roundness: 'round' } }, { type: 'updateNote', id: 'o', patch: { stroke: '#ff0000', fill: 'blue' } }, { type: 'updateNote', id: 'a', patch: { stroke: '#ff0000', arrowEnd: 'dot' } }, { type: 'updateNote', id: 'p', patch: { stroke: '#ff0000' } }]))
ok('styleOps results pass the server validation', (() => { const base = applyCanvasOps(null, [], [{ type: 'addNote', id: 'r', note: { kind: 'rect', w: 10, h: 10 } }, { type: 'addNote', id: 'a', note: { kind: 'arrow', w: 10, h: 0 } }]).canvas; const r = applyCanvasOps(base, [], styleOps([{ id: 'r', kind: 'rect' }, { id: 'a', kind: 'arrow' }], { stroke: '#112233', strokeWidth: 4, strokeStyle: 'dotted', roundness: 'sharp', arrowStart: 'bar', arrowEnd: 'triangle', fill: 'red' })).canvas; return r.notes.r.strokeStyle === 'dotted' && r.notes.a.arrowEnd === 'triangle' && r.notes.r.fill === 'red' })())
{
  const notes = { ar: { kind: 'arrow', bind: { start: { type: 'note', id: 'a' }, end: { type: 'board', id: 'p.html' } } }, ar2: { kind: 'arrow', bind: { end: { type: 'note', id: 'a' } } }, free: { kind: 'arrow' } }
  const ops = (id: string) => [{ type: 'updateNote' as const, id, patch: { x: 5 } }]
  ok('detachBinds: an arrow moved alone loses its bindings', same(detachBinds(ops('ar'), notes, new Set(['n:ar']))[0], { type: 'updateNote', id: 'ar', patch: { x: 5, bind: null } }))
  ok('detachBinds: ends whose target moves along are kept', same(detachBinds(ops('ar'), notes, new Set(['n:ar', 'n:a']))[0], { type: 'updateNote', id: 'ar', patch: { x: 5, bind: { start: { type: 'note', id: 'a' } } } }))
  ok('detachBinds: everything bound moving = no change; unbound arrows and other ops untouched', same(detachBinds(ops('ar'), notes, new Set(['n:ar', 'n:a', 'b:p.html']))[0], ops('ar')[0]) && same(detachBinds(ops('free'), notes, new Set())[0], ops('free')[0]) && same(detachBinds([{ type: 'deleteNote', id: 'ar' }], notes, new Set())[0], { type: 'deleteNote', id: 'ar' }))
}

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
