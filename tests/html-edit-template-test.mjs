import { applyEdits, getTemplateInfo, annotate } from '../server/utils/htmlEdit.ts'
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1 }
const throws = (n, f, re) => { try { f(); ok(n, false, 'did not throw') } catch (e) { ok(n, re.test(e.message), e.message) } }
const board = `<x-dc>
<div class="a" data-hub-id="a">A</div>
<div class="b" data-hub-id="b">B</div>
<p data-hub-id="c">C</p>
<ul data-hub-id="ul"><sc-for list="{{rows}}" as="r"><li data-hub-id="li"><span data-hub-id="rate">{{r.rate}} %</span></li></sc-for></ul>
<script type="text/x-dc" data-dc-script data-props='{"accent":{"default":"#111"},"rows":{}}'></script>
</x-dc>`
const run = (ops, src = board) => applyEdits(src, ops).source

// group / ungroup
let s = run([{ type: 'group', ids: ['b', 'a'], id: 'g1', style: 'display: flex; gap: 8px' }])
ok('group: wrapper before first member', /<div data-hub-id="g1" style="display: flex; gap: 8px">\n<div class="a"/.test(s), s)
ok('group: wrapper closes after last member', /B<\/div>\n<\/div>/.test(s))
s = run([{ type: 'group', ids: ['a', 'b'], id: 'g1' }, { type: 'ungroup', id: 'g1' }])
ok('ungroup: restores content without wrapper', !s.includes('g1') && s.includes('<div class="a" data-hub-id="a">A</div>'))
throws('group: different parents rejected', () => run([{ type: 'group', ids: ['a', 'rate'], id: 'g2' }]), /same parent/)
throws('group: list items rejected', () => run([{ type: 'group', ids: ['li'], id: 'g3' }]), /cannot be/)
throws('group: bad style rejected', () => run([{ type: 'group', ids: ['a'], id: 'g4', style: 'color: red; }' }]), /Invalid/)
throws('ungroup: only wrappers', () => run([{ type: 'ungroup', id: 'ul' }]), /cannot be ungrouped/)

// template text with holes
s = run([{ type: 'text', id: 'rate', html: '{{r.rate}} % p.a.' }])
ok('text: bound text editable and holes kept', s.includes('{{r.rate}} % p.a.</span>'))
throws('text: unclosed hole rejected', () => run([{ type: 'text', id: 'rate', html: '{{r.rate' }]), /not closed|Invalid|closed/)
throws('text: element mixing data and elements is refused', () => run([{ type: 'text', id: 'li', html: 'x' }]), /mixes/)

// attributes with holes
s = run([{ type: 'tattr', id: 'a', name: 'title', value: '{{r.rate}}' }, { type: 'tattr', id: 'a', name: 'onclick', value: '{{open}}' }])
ok('tattr: hole attribute and handler reference', s.includes('title="{{r.rate}}"') && s.includes('onclick="{{open}}"'))
throws('tattr: inline code in a handler rejected', () => run([{ type: 'tattr', id: 'a', name: 'onclick', value: 'alert(1)' }]), /reference/)
throws('tattr: srcdoc rejected', () => run([{ type: 'tattr', id: 'a', name: 'srcdoc', value: 'x' }]), /not editable/)
s = run([{ type: 'tattr', id: 'a', name: 'class', value: null }])
ok('tattr: null removes the attribute', !/data-hub-id="a"[^>]*class|class="a"/.test(s.split('\n')[1]))

// directives
s = run([{ type: 'directive', id: 'rate', kind: 'sc-for', set: { list: '{{accounts}}', as: 'acc' } }])
ok('directive: edits the loop around the element', s.includes('<sc-for list="{{accounts}}" as="acc">'))
throws('directive: loop variable must be a name', () => run([{ type: 'directive', id: 'rate', kind: 'sc-for', set: { as: 'a b' } }]), /plain name/)
throws('directive: list must be a data path', () => run([{ type: 'directive', id: 'rate', kind: 'sc-for', set: { list: 'alert(1)' } }]), /braces/)
s = run([{ type: 'unwrapDirective', id: 'rate', kind: 'sc-for' }])
ok('unwrapDirective: loop removed, content kept', !s.includes('sc-for') && s.includes('<li data-hub-id="li">'))
s = run([{ type: 'wrapDirective', id: 'c', kind: 'sc-if', attrs: { value: '{{loggedIn}}' } }])
ok('wrapDirective: element wrapped in sc-if', /<sc-if value="\{\{loggedIn\}\}">\n<p data-hub-id="c">C<\/p>\n<\/sc-if>/.test(s), s)
s = run([{ type: 'wrapDirective', id: 'c', kind: 'sc-for' }])
ok('wrapDirective: sc-for defaults', s.includes('<sc-for list="{{items}}" as="item">'))

// info
const info = getTemplateInfo(board, 'rate')
ok('info: loop chain with level', info.directives.length === 1 && info.directives[0].kind === 'sc-for' && info.directives[0].attrs.list === '{{rows}}')
ok('info: text with holes', info.text?.hasHoles && info.text.source === '{{r.rate}} %')
ok('info: scope has props and loop vars', info.scope.props.includes('accent') && info.scope.vars.includes('r') && info.scope.vars.includes('$index'))
ok('info: dc board', info.dc === true)
ok('info: li (has child elements) has no editable text', getTemplateInfo(board, 'li').text === null)
