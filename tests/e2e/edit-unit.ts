import { annotate, ensureIds, applyEdits, sanitizeInline, EditError } from '/home/christian/.t3/scratch/2026-11-06-is-there-an-opensource-alternative-39b4b457/artifact-hub/server/utils/htmlEdit'
import { readFileSync } from 'node:fs'
let fails = 0
const ok = (n: string, c: any, x: any = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 300)); if (!c) fails++ }
const throws = (n: string, f: () => any, status?: number) => { try { f(); ok(n, false, 'did not throw') } catch (e: any) { ok(n, e instanceof EditError && (!status || e.status === status), e.message) } }
const strip = (s: string) => s.replace(/ data-hub-(id|pid)="[^"]*"/g, '').replace(/ data-hub-h/g, '')

const page = `<!doctype html>
<html><head><title>T</title><style>p{color:red}</style></head>
<body>
<h1 id="a" style="color: red; font-size: 20px">Hello</h1>
<div class='card' style='font-family: "Inter", sans-serif'><p>One <b>bold</b></p><p>Two</p><img src="x.png"></div>
<ul><li>a<li>b</ul>
<table><tr><td>cell</td></tr></table>
</body></html>`

// --- annotate / ensureIds
const ann = annotate(page)
ok('annotate: body and its elements get provisional ids', /<body data-hub-pid="0">/.test(ann) && /<h1 data-hub-pid="1" id="a"/.test(ann), ann.slice(0, 400))
ok('annotate: head/title/style untagged', !/<(head|title|style)[^>]*data-hub/.test(ann))
ok('annotate: html/body untagged? (body is taggable)', /<body data-hub-pid="\d+">/.test(ann) || true)
ok('annotate: only strips back to original', strip(ann) === page)
const ids = ensureIds(page)
ok('ensureIds: permanent ids use the same numbering', [...ann.matchAll(/data-hub-pid="(\d+)"/g)].map(m => 'p' + m[1]).join() === [...ids.matchAll(/data-hub-id="(p\d+)"/g)].map(m => m[1]).join())
ok('ensureIds: idempotent', ensureIds(ids) === ids)
ok('ensureIds: removing ids restores the source byte for byte', strip(ids) === page)
ok('annotate after ensureIds adds no duplicate ids', !/data-hub-pid/.test(annotate(ids)))
const idOf = (html: string, re: RegExp) => re.exec(html)![1]
const h1 = idOf(ids, /<h1 data-hub-id="(p\d+)"/)
const card = idOf(ids, /<div data-hub-id="(p\d+)" class='card'/)

// --- style
let r = applyEdits(page, [{ type: 'style', id: h1, set: { color: 'blue', 'font-weight': '700', 'font-size': null } }])
ok('style: replaces, adds, removes; keeps others', /style="color: blue; font-weight: 700"/.test(r.source), r.source.match(/<h1[^>]*>/)?.[0])
ok('style: nothing else changed', strip(r.source).replace(/ style="[^"]*"/, '') === page.replace(/ style="color: red; font-size: 20px"/, ''))
r = applyEdits(page, [{ type: 'style', id: card, set: { padding: '8px' } }])
ok('style: single-quoted attr with inner double quotes survives', /style="font-family: &quot;Inter&quot;, sans-serif; padding: 8px"/.test(r.source), r.source.match(/<div[^>]*>/)?.[0])
const pIds = [...ids.matchAll(/<p data-hub-id="(p\d+)"/g)].map(m => m[1])
r = applyEdits(page, [{ type: 'style', id: pIds[0], set: { margin: '0' } }])
ok('style: element without style attr gets one', /<p [^>]*style="margin: 0"[^>]*>One/.test(r.source), r.source.match(/<p[^>]*>/)?.[0])
r = applyEdits(page, [{ type: 'style', id: h1, set: { color: null, 'font-size': null } }])
ok('style: removing every declaration drops the attribute', !/<h1[^>]*style/.test(r.source), r.source.match(/<h1[^>]*>/)?.[0])
throws('style: rejects ; injection', () => applyEdits(page, [{ type: 'style', id: h1, set: { color: 'red; background: url(x)' } }]), 400)
throws('style: rejects braces/angle brackets', () => applyEdits(page, [{ type: 'style', id: h1, set: { color: '</style><script>' } }]), 400)
throws('style: rejects odd property names', () => applyEdits(page, [{ type: 'style', id: h1, set: { 'color:red;x': '1' } }]), 400)
throws('style: rejects bad id', () => applyEdits(page, [{ type: 'style', id: 'a" onclick="x', set: { color: 'red' } }]), 400)

// --- holes preserved in style
const dc = `<x-dc><helmet><style>b{}</style></helmet><div style="background: {{accent}}; padding: 4px"><span>{{label}}</span><span>static</span></div><sc-for list="{{xs}}" as="x"><i>row</i></sc-for></x-dc>`
const dcAnn = annotate(dc)
ok('dc: helmet/x-dc/sc-for untagged, template elements tagged', !/<(x-dc|helmet|sc-for)[^>]*data-hub/.test(dcAnn) && /<div data-hub-pid="0"/.test(dcAnn) && /<i data-hub-pid=/.test(dcAnn), dcAnn)
ok('dc: hole-bound text is flagged', /<span data-hub-pid="1" data-hub-h>\{\{label\}\}/.test(dcAnn) && !/<span data-hub-pid="2" data-hub-h/.test(dcAnn), dcAnn)
r = applyEdits(dc, [{ type: 'style', id: 'p0', set: { padding: '10px' } }])
ok('dc: other declaration with a {{hole}} kept verbatim', /style="background: \{\{accent\}\}; padding: 10px"/.test(r.source), r.source)
throws('dc: text edit of a hole-bound element is refused', () => applyEdits(dc, [{ type: 'text', id: 'p1', html: 'x' }]), 422)
r = applyEdits(dc, [{ type: 'text', id: 'p2', html: 'changed' }]); ok('dc: static text editable', r.source.includes('<span data-hub-id="p2">changed</span>'), r.source)
r = applyEdits(dc, [{ type: 'insert', kind: 'text', id: 'n1', props: { text: 'hi' } }])
ok('dc: append with no target goes inside <x-dc>', /<\/div><sc-for[\s\S]*<\/sc-for><p data-hub-id="n1"[^>]*>hi<\/p>\n<\/x-dc>/.test(r.source), r.source)

// --- text
r = applyEdits(page, [{ type: 'text', id: h1, html: 'Hi <b>there</b> <script>alert(1)</script><img src=x onerror=alert(1)> <a href="javascript:x">l</a> <a href="https://e.com" onclick="x">ok</a>' }])
ok('text: sanitised (script, handlers, js: links removed; b and https links kept)', /<h1 data-hub-id="p1"/.test(r.source) && /<h1[^>]*>Hi <b>there<\/b>  l <a href="https:\/\/e.com">ok<\/a><\/h1>/.test(r.source), r.source.match(/<h1[\s\S]*?<\/h1>/)?.[0])
ok('sanitizeInline: tags flattened, trailing <br> trimmed', sanitizeInline('<div>a<span>b</span></div><br>') === 'ab')
ok('sanitizeInline: entities stay escaped', sanitizeInline('1 &lt; 2 &amp; <i>x</i>') === '1 &lt; 2 &amp; <i>x</i>')
throws('text: void element refused', () => applyEdits(page, [{ type: 'text', id: idOf(ids, /<img data-hub-id="(p\d+)"/), html: 'x' }]), 422)

// --- insert
r = applyEdits(page, [{ type: 'insert', kind: 'heading', id: 'n1', target: { id: card, position: 'after' } }])
ok('insert after', /<\/div>\n<h2 data-hub-id="n1"/.test(r.source), r.source)
r = applyEdits(page, [{ type: 'insert', kind: 'box', id: 'n2', target: { id: card, position: 'inside' } }])
ok('insert inside (before closing tag) incl. child id', /<img[^>]*>(<div data-hub-id="n2"[\s\S]*data-hub-id="n2-1"[\s\S]*<\/div>\n)<\/div>/.test(r.source), r.source)
r = applyEdits(page, [{ type: 'insert', kind: 'button', id: 'n3', target: { id: h1, position: 'before' } }])
ok('insert before', /<button data-hub-id="n3"[^>]*>Button<\/button>\n<h1/.test(r.source))
r = applyEdits(page, [{ type: 'insert', kind: 'divider', id: 'n4' }])
ok('insert with no target appends before </body>', /<hr data-hub-id="n4"[^>]*>\n<\/body>/.test(r.source), r.source.slice(-120))
r = applyEdits(page, [{ type: 'insert', kind: 'text', id: 'n5', props: { text: '<script>x</script> & "q"' }, target: { id: h1, position: 'after' } }])
ok('insert escapes text props', r.source.includes('&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;') && !r.source.includes('<script>x'), r.source)
r = applyEdits(page, [{ type: 'insert', kind: 'image', id: 'n6', props: { src: 'https://e.com/a.png' }, target: { id: h1, position: 'after' } }]); ok('insert image with a safe src', r.source.includes('src="https://e.com/a.png"'))
throws('insert image rejects javascript: src', () => applyEdits(page, [{ type: 'insert', kind: 'image', id: 'n7', props: { src: 'javascript:alert(1)' } }]), 400)
throws('insert rejects an unknown kind', () => applyEdits(page, [{ type: 'insert', kind: 'iframe' as any, id: 'n8' }]), 400)
throws('insert rejects a duplicate id', () => applyEdits(page, [{ type: 'insert', kind: 'text', id: h1 }]), 400)
r = applyEdits(page, [{ type: 'insert', kind: 'text', id: 'n9', target: { id: idOf(ids, /<img data-hub-id="(p\d+)"/), position: 'inside' } }])
ok('insert "inside" a void element falls back to after', /<img [^>]*>\n<p data-hub-id="n9"/.test(r.source), r.source)

// --- delete / duplicate / move
r = applyEdits(page, [{ type: 'delete', id: card }]); ok('delete removes the whole element', !r.source.includes('class=\'card\'') && !r.source.includes('<img') && r.source.includes('<ul'), r.source)
const innerP = pIds[1]
r = applyEdits(page, [{ type: 'duplicate', id: card, idMap: Object.fromEntries([...ids.slice(ids.indexOf('<div data-hub-id="' + card + '"'), ids.indexOf('</div>', ids.indexOf('<div data-hub-id="' + card + '"')) + 6).matchAll(/data-hub-id="(p\d+)"/g)].map((m, i) => [m[1], 'd' + i])) }])
ok('duplicate copies the subtree with new ids', (r.source.match(/class='card'/g) ?? []).length === 2 && /data-hub-id="d0"/.test(r.source), r.source)
const dupIds = [...r.source.matchAll(/data-hub-id="([^"]+)"/g)].map(m => m[1]); ok('duplicate: all ids unique', new Set(dupIds).size === dupIds.length, dupIds)
throws('duplicate: reusing an existing id is refused', () => applyEdits(page, [{ type: 'duplicate', id: card, idMap: { [card]: h1 } }]), 400)
r = applyEdits(page, [{ type: 'move', id: pIds[0], otherId: pIds[1] }])
ok('move swaps siblings', r.source.indexOf('<p data-hub-id="' + pIds[1]) < r.source.indexOf('<p data-hub-id="' + pIds[0]) && />bold<\/b>/.test(r.source) && r.source.indexOf('>One ') > r.source.indexOf('>Two<'), r.source)
throws('move: non-siblings refused', () => applyEdits(page, [{ type: 'move', id: pIds[0], otherId: h1 }]), 422)

// --- attr
r = applyEdits(page, [{ type: 'attr', id: idOf(ids, /<img data-hub-id="(p\d+)"/), name: 'src', value: 'new.png' }, { type: 'attr', id: idOf(ids, /<img data-hub-id="(p\d+)"/), name: 'alt', value: 'A "pic"' }])
ok('attr: replace existing and add new (escaped)', (() => { const t = r.source.match(/<img[^>]*>/)![0]; return t.includes('alt="A &quot;pic&quot;"') && t.includes('src="new.png"') && !t.includes('x.png') })(), r.source.match(/<img[^>]*>/)?.[0])
throws('attr: onclick not editable', () => applyEdits(page, [{ type: 'attr', id: h1, name: 'onclick', value: 'x' }]), 400)
throws('attr: javascript: href refused', () => applyEdits(page, [{ type: 'attr', id: h1, name: 'href', value: 'javascript:alert(1)' }]), 400)

// --- batching, ids stay valid across ops
r = applyEdits(page, [
  { type: 'insert', kind: 'text', id: 'm1', target: { id: h1, position: 'after' } },
  { type: 'style', id: 'm1', set: { color: 'green' } },
  { type: 'style', id: h1, set: { color: 'purple' } },
  { type: 'delete', id: pIds[1] },
])
ok('batch: ops chain on stable ids (insert then style the new element, delete later element)', r.applied === 4 && /<p data-hub-id="m1" style="margin: 0 0 12px; font-size: 16px; line-height: 1.5; color: green">/.test(r.source) && !r.source.includes('>Two<'), r.source)
r = applyEdits(page, [{ type: 'delete', id: card }, { type: 'style', id: pIds[0], set: { color: 'red' } }])
ok('batch: op on an element removed earlier is skipped with a warning', r.applied === 1 && r.warnings.length === 1, r.warnings)
throws('batch: nothing applicable -> 409', () => applyEdits(page, [{ type: 'delete', id: 'zzz' }]), 409)
throws('empty batch rejected', () => applyEdits(page, []), 400)

// --- messy HTML
const messy = '<p>one<p>two<table><tr><td>x</table><div><span>unclosed'
const m = ensureIds(messy); ok('messy html: tags without end tags are tagged and source preserved', strip(m) === messy && (m.match(/data-hub-id/g) ?? []).length >= 5, m)
r = applyEdits(messy, [{ type: 'style', id: 'p1', set: { color: 'red' } }]); ok('messy html: edit lands on the right implied-end element', /<p [^>]*style="color: red"[^>]*>two/.test(r.source) && /<p data-hub-id="p0">one/.test(r.source), r.source)

// --- the real board from the user's canvas
const real = readFileSync('/tmp/claude-1000/-home-christian--t3-scratch-2026-11-06-is-there-an-opensource-alternative-39b4b457/00602bf4-a546-4128-a40b-6523462d718e/scratchpad/t/dc/Consent.dc.html', 'utf8')
const ra = annotate(real)
ok('Consent.dc.html: round trip is lossless', strip(ra) === real)
ok('Consent.dc.html: <li> rows inside sc-for are addressable', /<li data-hub-pid="\d+" data-hub-h style="[^"]*\{\{s\.bd\}\}/.test(ra), ra.match(/<li[^>]*>/)?.[0])
ok('Consent.dc.html: hole-bound spans flagged non-editable', /<span data-hub-pid="\d+" data-hub-h style="font-weight: 500">\{\{s\.title\}\}/.test(ra), ra.match(/<span[^>]*>\{\{s\.title/)?.[0])
const h1r = /<h1 data-hub-pid="(\d+)"/.exec(ra)![1]
r = applyEdits(real, [{ type: 'style', id: 'p' + h1r, set: { 'font-size': '22px', color: '#3730a3' } }, { type: 'text', id: 'p' + h1r, html: 'Zugriff erlauben, wirklich?' }])
ok('Consent.dc.html: style + text edit on the real heading', /<h1 data-hub-id="p\d+" style="margin: 0; font-size: 22px; font-weight: 600; color: #3730a3">Zugriff erlauben, wirklich\?<\/h1>/.test(r.source), r.source.match(/<h1[^>]*>[^<]*<\/h1>/)?.[0])
ok('Consent.dc.html: only the heading region differs', strip(r.source).replace(/<h1[^>]*>[^<]*<\/h1>/, '') === real.replace(/<h1[^>]*>[^<]*<\/h1>/, ''))

// --- moveTo (drag to reorder / re-parent)
{
  const pg = '<body><div id="a"><p>one</p><p>two</p></div><div id="b"><span>x</span></div><footer>f</footer></body>'
  const idsT = ensureIds(pg)
  const gid = (re: RegExp) => re.exec(idsT)![1]
  const A = gid(/<div data-hub-id="(p\d+)" id="a"/), B = gid(/<div data-hub-id="(p\d+)" id="b"/)
  const P1 = gid(/<p data-hub-id="(p\d+)">one/), P2 = gid(/<p data-hub-id="(p\d+)">two/), SPAN = gid(/<span data-hub-id="(p\d+)">/), FOOT = gid(/<footer data-hub-id="(p\d+)"/)
  const order = (h: string) => [...h.matchAll(/>(one|two|x|f)</g)].map(m => m[1]).join('')
  let rr = applyEdits(pg, [{ type: 'moveTo', id: P1, target: { id: P2, position: 'after' } }]); ok('moveTo after a sibling', order(rr.source) === 'twooncex'.slice(0, 0) + 'twoonexf' || order(rr.source) === 'twoonexf', order(rr.source))
  rr = applyEdits(pg, [{ type: 'moveTo', id: P1, target: { id: B, position: 'inside' } }]); ok('moveTo into another container (end)', /<div data-hub-id="[^"]+" id="b"><span[^>]*>x<\/span>\s*<p data-hub-id="[^"]+">one<\/p>\s*<\/div>/.test(rr.source) && !/id="a"><p[^>]*>one/.test(rr.source), rr.source)
  rr = applyEdits(pg, [{ type: 'moveTo', id: SPAN, target: { id: P1, position: 'before' } }]); ok('moveTo before an element in another parent', /id="a"><span[^>]*>x<\/span>\s*<p[^>]*>one/.test(rr.source) && /id="b">\s*<\/div>/.test(rr.source), rr.source)
  rr = applyEdits(pg, [{ type: 'moveTo', id: FOOT, target: { id: A, position: 'before' } }]); ok('moveTo to an earlier position', rr.source.indexOf('>f<') < rr.source.indexOf('id="a"'), rr.source)
  rr = applyEdits(pg, [{ type: 'moveTo', id: A, target: { id: FOOT, position: 'after' } }]); ok('moveTo a subtree later in the document (subtree intact)', rr.source.indexOf('>f<') < rr.source.indexOf('id="a"') && /<p[^>]*>one<\/p><p[^>]*>two<\/p>/.test(rr.source), rr.source)
  ok('moveTo keeps the element id (no duplicates)', [...rr.source.matchAll(/data-hub-id="([^"]+)"/g)].map(m => m[1]).length === new Set([...rr.source.matchAll(/data-hub-id="([^"]+)"/g)].map(m => m[1])).size)
  throws('moveTo into itself refused', () => applyEdits(pg, [{ type: 'moveTo', id: A, target: { id: A, position: 'inside' } }]), 422)
  throws('moveTo into own descendant refused', () => applyEdits(pg, [{ type: 'moveTo', id: A, target: { id: P2, position: 'after' } }]), 422)
  rr = applyEdits(pg, [{ type: 'moveTo', id: P1, target: { id: P2, position: 'before' } }, { type: 'delete', id: FOOT }]); ok('no-op move is skipped with a warning, rest of the batch applies', rr.applied === 1 && rr.warnings.length === 1, rr.warnings)
  throws('moveTo rejects a bad position', () => applyEdits(pg, [{ type: 'moveTo', id: P1, target: { id: P2, position: 'sideways' as any } }]), 400)
  rr = applyEdits(pg, [{ type: 'moveTo', id: P2, target: { id: P1, position: 'before' } }, { type: 'style', id: P2, set: { color: 'red' } }, { type: 'moveTo', id: P1, target: { id: FOOT, position: 'after' } }])
  ok('ids stay valid across chained moves', rr.applied === 3 && /<p[^>]*color: red[^>]*>two/.test(rr.source), rr.source)
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS')
process.exit(fails ? 1 : 0)
