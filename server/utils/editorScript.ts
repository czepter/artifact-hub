/**
 * In-frame visual editor (owner only; inert until the viewer sends hub:edit-mode). It edits the live DOM so the
 * result is instant and reports every change as a small operation (style, attr, text, insert, delete, duplicate,
 * move, moveTo, group, ungroup). The viewer batches them; the server replays them against the stored source.
 * Elements are addressed by data-hub-id (permanent) or data-hub-pid (provisional, from serving); nodes created by
 * page scripts have neither and cannot be edited.
 *
 * Free positioning: an element with position absolute/fixed is moved by changing left/top and resized with 8
 * handles, with snapping to the parent and to sibling edges. "Free" converts a flow element in place (its parent
 * becomes the positioning context) without it jumping.
 */
export const EDITOR = String.raw`<script data-hub-editor>(function(){
  var multi = [], multiBoxes = [];
  var on = false, sel = null, editing = null, editOriginal = '', hoverEl = null, raf = 0, treeTimer = 0;
  var dragCand = null, dragging = false, dragPl = null, suppressClick = false, fm = null, resizing = null;
  // 'free': dragging moves an element anywhere and palette drops land exactly where released. 'flow': dragging reorders in the page flow.
  var dragMode = 'free';
  var NOFREE = { html:1, body:1, tr:1, td:1, th:1, tbody:1, thead:1, tfoot:1, col:1, colgroup:1, caption:1 };
  var VOID = { area:1, base:1, br:1, col:1, embed:1, hr:1, img:1, input:1, link:1, meta:1, source:1, track:1, wbr:1 };
  var CONT = { div:1, section:1, main:1, article:1, aside:1, header:1, footer:1, nav:1, form:1, ul:1, ol:1, li:1, body:1, figure:1, fieldset:1, details:1, td:1, th:1 };
  var NOINS = { tr:1, tbody:1, thead:1, tfoot:1, colgroup:1, col:1, caption:1 };
  var GROUPABLE = { div:1, section:1, article:1, aside:1, header:1, footer:1, main:1, nav:1, span:1, figure:1 };
  var NOGROUP = { li:1, tr:1, td:1, th:1, option:1, dt:1, dd:1, thead:1, tbody:1, tfoot:1, caption:1, col:1, colgroup:1, html:1, body:1 };
  var LISTPAR = { ul:1, ol:1, dl:1, table:1, thead:1, tbody:1, tfoot:1, tr:1, colgroup:1, select:1, optgroup:1 };
  var CURSORS = { nw:'nwse-resize', n:'ns-resize', ne:'nesw-resize', e:'ew-resize', se:'nwse-resize', s:'ns-resize', sw:'nesw-resize', w:'ew-resize' };
  function post(m){ try { window.parent.postMessage(m, '*'); } catch (_) {} }
  function q(s){ return String(s).replace(/["\\]/g, '\\$&'); }
  function px(v){ var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function rnd(n){ return Math.round(n * 10) / 10; }
  function idOf(el){
    if (!el || el.nodeType !== 1) return null;
    var a = el.getAttribute('data-hub-id'); if (a) return a;
    var p = el.getAttribute('data-hub-pid'); return p != null ? 'p' + p : null;
  }
  function byId(id){
    if (!id) return null;
    var el = document.querySelector('[data-hub-id="' + q(id) + '"]');
    if (!el && /^p\d+$/.test(id)) el = document.querySelector('[data-hub-pid="' + id.slice(1) + '"]');
    return el;
  }
  // A node rendered from a loop exists once per row, all sharing one id: edits to the template show on every copy.
  function allById(id){
    if (!id) return [];
    var sel0 = '[data-hub-id="' + q(id) + '"]' + (/^p\d+$/.test(id) ? ',[data-hub-pid="' + id.slice(1) + '"]' : '');
    return [].slice.call(document.querySelectorAll(sel0)).filter(function(n){ return !isOverlay(n); });
  }
  function isOverlay(el){ return el && el.closest && el.closest('[data-hub-overlay]'); }
  function editableAt(el){
    while (el && el.nodeType === 1) {
      if (el === document.documentElement) return null;
      if (!isOverlay(el) && idOf(el)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function newId(){ var id; do { id = 'n' + Math.random().toString(36).slice(2, 8); } while (byId(id)); return id; }
  function declared(el){
    var out = {}, css = el.getAttribute('style') || '', depth = 0, quote = '', cur = '', parts = [];
    for (var i = 0; i < css.length; i++) {
      var c = css[i];
      if (quote) { cur += c; if (c === quote && css[i - 1] !== '\\') quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; cur += c; continue; }
      if (c === '(') depth++; if (c === ')') depth--;
      if (c === ';' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) parts.push(cur);
    parts.forEach(function(d){ var k = d.indexOf(':'); if (k > 0) out[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).trim(); });
    return out;
  }
  function side(cs, p){
    var v = [cs[p + 'Top'], cs[p + 'Right'], cs[p + 'Bottom'], cs[p + 'Left']];
    return v[0] === v[1] && v[1] === v[2] && v[2] === v[3] ? v[0] : (v[0] === v[2] && v[1] === v[3] ? v[0] + ' ' + v[1] : v.join(' '));
  }
  function siblingWithId(el, dir){
    var n = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    while (n && (!idOf(n) || isOverlay(n))) n = dir < 0 ? n.previousElementSibling : n.nextElementSibling;
    return n;
  }
  function isFree(el){ var p = getComputedStyle(el).position; return p === 'absolute' || p === 'fixed'; }
  function leftOf(el){ return el.offsetLeft - px(getComputedStyle(el).marginLeft); }
  function topOf(el){ return el.offsetTop - px(getComputedStyle(el).marginTop); }

  // ---- contrast (WCAG) ----
  function parseColor(c){
    var m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null;
    var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function effectiveBg(el){
    var layers = [];
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    var bg = { r: 255, g: 255, b: 255 };
    for (var i = layers.length - 1; i >= 0; i--) { var L = layers[i]; bg = { r: L.r * L.a + bg.r * (1 - L.a), g: L.g * L.a + bg.g * (1 - L.a), b: L.b * L.a + bg.b * (1 - L.a) }; }
    return bg;
  }
  function lum(c){ function ch(v){ v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); } return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b); }
  function contrastOf(el, cs){
    var fg = parseColor(cs.color), bg = effectiveBg(el); if (!fg) return null;
    var a = fg.a == null ? 1 : fg.a; fg = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
    var l1 = lum(fg), l2 = lum(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    var size = px(cs.fontSize), large = size >= 24 || (size >= 18.66 && px(cs.fontWeight) >= 700);
    var level = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : (ratio >= 3 && large) ? 'AA large' : ratio >= 3 ? 'low' : 'fail';
    return { ratio: Math.round(ratio * 10) / 10, level: level, large: large };
  }

  function describe(el){
    if (!el) return null;
    var cs = getComputedStyle(el), id = idOf(el), tag = el.tagName.toLowerCase(), r = el.getBoundingClientRect();
    var plain = !el.querySelector(':not(b):not(i):not(u):not(em):not(strong):not(br):not(a)');
    var par = el.parentElement ? editableAt(el.parentElement) : null;
    var pcs = el.parentElement ? getComputedStyle(el.parentElement) : null;
    return {
      id: id, tag: tag, rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      declared: declared(el), free: isFree(el), position: cs.position,
      parentFlex: !!pcs && /flex/.test(pcs.display), parentRow: !!pcs && /flex/.test(pcs.display) && !/^column/.test(pcs.flexDirection),
      textEditable: !!id && !el.hasAttribute('data-hub-h') && !VOID[tag] && plain,
      bound: el.hasAttribute('data-hub-h'),
      repeats: allById(id).length,
      multi: multi.length,
      canGroup: canGroup(),
      groupable: !!GROUPABLE[tag] && !!el.children.length && el !== document.body,
      parentId: par ? idOf(par) : null,
      canUp: !!siblingWithId(el, -1), canDown: !!siblingWithId(el, 1),
      attrs: { src: el.getAttribute('src'), href: el.getAttribute('href'), alt: el.getAttribute('alt'), placeholder: el.getAttribute('placeholder'), title: el.getAttribute('title'), id: el.getAttribute('id'), cls: el.getAttribute('class'), ariaLabel: el.getAttribute('aria-label') },
      contrast: /\S/.test(el.textContent || '') && plain ? contrastOf(el, cs) : null,
      c: {
        color: cs.color, backgroundColor: cs.backgroundColor, fontSize: cs.fontSize, fontWeight: cs.fontWeight, textAlign: cs.textAlign,
        lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, fontFamily: cs.fontFamily, textDecoration: cs.textDecorationLine,
        width: cs.width, height: cs.height, minWidth: cs.minWidth, flexGrow: cs.flexGrow, left: cs.left, top: cs.top,
        padding: side(cs, 'padding'), paddingTop: cs.paddingTop, paddingRight: cs.paddingRight, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
        margin: side(cs, 'margin'), gap: cs.rowGap, boxShadow: cs.boxShadow,
        borderRadius: cs.borderTopLeftRadius, radiusTR: cs.borderTopRightRadius, radiusBR: cs.borderBottomRightRadius, radiusBL: cs.borderBottomLeftRadius,
        borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor, borderStyle: cs.borderTopStyle,
        display: cs.display, flexDirection: cs.flexDirection, flexWrap: cs.flexWrap, justifyContent: cs.justifyContent, alignItems: cs.alignItems, opacity: cs.opacity
      }
    };
  }

  // ---- overlays ----
  var selBox, hoverBox, tagLabel, dropBox, guideV, guideH, handles = {};
  var BASE = 'position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;';
  var HANDLE = 'position:fixed;z-index:2147483647;box-sizing:border-box;width:9px;height:9px;background:#fff;border:1.5px solid #3b82f6;pointer-events:auto;';
  function mk(css){ var d = document.createElement('div'); d.setAttribute('data-hub-overlay', ''); d.style.cssText = BASE + 'display:none;' + css; document.documentElement.appendChild(d); return d; }
  function ensureBoxes(){
    if (selBox) return;
    selBox = mk('border:2px solid #3b82f6;border-radius:2px');
    hoverBox = mk('border:1px dashed #3b82f6;background:rgba(59,130,246,.06)');
    tagLabel = mk('background:#3b82f6;color:#fff;font:600 11px/1 system-ui,sans-serif;padding:3px 6px;border-radius:3px;white-space:nowrap');
    dropBox = mk('background:#3b82f6');
    guideV = mk('background:#f43f5e;width:1px'); guideH = mk('background:#f43f5e;height:1px');
    Object.keys(CURSORS).forEach(function(k){ var h = mk(''); h.setAttribute('data-hub-handle', k); handles[k] = h; });
  }
  function place(box, el){
    if (!el || !document.contains(el)) { box.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    box.style.cssText = BASE + box.getAttribute('data-css') + ';display:block;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
  }
  function paint(){
    raf = 0; if (!on) return; ensureBoxes();
    selBox.setAttribute('data-css', 'border:2px solid #3b82f6;border-radius:2px'); hoverBox.setAttribute('data-css', 'border:1px dashed #3b82f6;background:rgba(59,130,246,.06)');
    place(selBox, sel); place(hoverBox, hoverEl && hoverEl !== sel && !editing && !fm ? hoverEl : null);
    while (multiBoxes.length < multi.length) { var mb = mk(''); mb.setAttribute('data-css', 'border:2px solid #3b82f6;border-radius:2px;opacity:.65'); multiBoxes.push(mb); }
    multiBoxes.forEach(function(b, i){ if (i < multi.length) place(b, multi[i]); else b.style.display = 'none'; });
    var live = sel && document.contains(sel);
    if (live) {
      var r = sel.getBoundingClientRect();
      tagLabel.textContent = sel.tagName.toLowerCase() + '  ' + Math.round(r.width) + ' × ' + Math.round(r.height);
      tagLabel.style.cssText = BASE + 'background:#3b82f6;color:#fff;font:600 11px/1 system-ui,sans-serif;padding:3px 6px;border-radius:3px;white-space:nowrap;display:block;left:' + r.left + 'px;top:' + Math.max(0, r.top - 20) + 'px';
    } else tagLabel.style.display = 'none';
    var showH = live && !editing && sel !== document.body && !dragging, free = live && isFree(sel);
    Object.keys(handles).forEach(function(k){
      var h = handles[k];
      if (!showH || !(free || k === 'e' || k === 's' || k === 'se')) { h.style.display = 'none'; return; }
      var r2 = sel.getBoundingClientRect();
      var x = k.indexOf('w') >= 0 ? r2.left : k.indexOf('e') >= 0 ? r2.right : r2.left + r2.width / 2;
      var y = k.indexOf('n') >= 0 ? r2.top : k.indexOf('s') >= 0 ? r2.bottom : r2.top + r2.height / 2;
      h.style.cssText = HANDLE + 'cursor:' + CURSORS[k] + ';display:block;left:' + (x - 4.5) + 'px;top:' + (y - 4.5) + 'px';
    });
  }
  function schedule(){ if (!raf) raf = requestAnimationFrame(paint); }
  function report(){ post({ type: 'hub:edit-select', info: describe(sel) }); schedule(); }
  function select(el, keep){ sel = el || null; if (!keep) multi = []; report(); }
  function note(text){ post({ type: 'hub:edit-note', text: text }); }
  function canGroup(){
    if (!sel || sel === document.body) return false;
    var par = sel.parentElement;
    if (!par || LISTPAR[par.tagName.toLowerCase()]) return false;
    return [sel].concat(multi).every(function(m){ return m.parentElement === par && !NOGROUP[m.tagName.toLowerCase()] && !!idOf(m); });
  }
  function toggleMulti(el){
    if (!el || !sel || el === sel || el === document.body) return;
    if (el.parentElement !== sel.parentElement) { note('Group needs elements with the same parent. Shift-click siblings of the selected element.'); return; }
    var i = multi.indexOf(el); if (i >= 0) multi.splice(i, 1); else multi.push(el);
    report();
  }
  function emit(op){ post({ type: 'hub:edit-op', op: op }); }

  // ---- layer tree and tweaks ----
  function labelOf(el){
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return n.nodeValue.replace(/\s+/g, ' ').trim().slice(0, 32);
    return el.id ? '#' + el.id : (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '');
  }
  function treeOf(el, depth, budget){
    var kids = [];
    if (depth < 14) [].forEach.call(el.children, function(c){ if (budget.n > 0 && idOf(c) && !isOverlay(c)) { budget.n--; kids.push(treeOf(c, depth + 1, budget)); } });
    return { id: idOf(el), tag: el.tagName.toLowerCase(), label: labelOf(el), free: isFree(el), kids: kids };
  }
  function postTree(){ treeTimer = 0; if (on) post({ type: 'hub:edit-tree', tree: treeOf(document.body, 0, { n: 800 }) }); }
  function scheduleTree(){ if (on && !treeTimer) treeTimer = setTimeout(postTree, 250); }
  function postTweaks(){
    var s = document.querySelector('script[data-dc-script]'), defs = null;
    if (s) { try { defs = JSON.parse(s.getAttribute('data-props') || '{}'); } catch (_) { defs = null; } }
    post({ type: 'hub:tweaks', defs: defs, values: window.__dcProps || {} });
  }

  // ---- drop targets (palette drags and drags of existing elements) ----
  function isRow(el){ var cs = getComputedStyle(el); return /flex/.test(cs.display) && !/^column/.test(cs.flexDirection); }
  function hitTest(x, y, exclude){
    var prev; if (exclude) { prev = exclude.style.pointerEvents; exclude.style.pointerEvents = 'none'; }
    var el = document.elementFromPoint(x, y);
    if (exclude) exclude.style.pointerEvents = prev;
    return el;
  }
  function placementAt(x, y, exclude){
    var t = editableAt(hitTest(x, y, exclude));
    if (!t) return null;
    if (exclude && (t === exclude || exclude.contains(t))) return null;
    var tag = t.tagName.toLowerCase();
    if (tag === 'body' && document.querySelector('x-dc')) return { none: true };
    if (NOINS[tag]) return null;
    if (CONT[tag]) {
      var kids = [].filter.call(t.children, function(c){ return idOf(c) && !isOverlay(c) && c !== exclude; });
      if (!kids.length) return { target: t, position: 'inside' };
      var row = isRow(t);
      for (var i = 0; i < kids.length; i++) {
        var r = kids[i].getBoundingClientRect(), mid = row ? r.left + r.width / 2 : r.top + r.height / 2;
        if ((row ? x : y) < mid) return { target: kids[i], position: 'before', row: row };
      }
      return { target: kids[kids.length - 1], position: 'after', row: row };
    }
    var rr = t.getBoundingClientRect(), pr = !!(t.parentElement && isRow(t.parentElement));
    var before = pr ? x < rr.left + rr.width / 2 : y < rr.top + rr.height / 2;
    return { target: t, position: before ? 'before' : 'after', row: pr };
  }
  function showDrop(pl){
    ensureBoxes();
    if (!pl || pl.none || !pl.target) { dropBox.style.display = 'none'; return; }
    var r = pl.target.getBoundingClientRect(), css;
    if (pl.position === 'inside') css = 'background:rgba(59,130,246,.12);border:2px dashed #3b82f6;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
    else if (pl.row) css = 'background:#3b82f6;width:3px;height:' + r.height + 'px;top:' + r.top + 'px;left:' + ((pl.position === 'before' ? r.left : r.right) - 1) + 'px';
    else css = 'background:#3b82f6;height:3px;width:' + r.width + 'px;left:' + r.left + 'px;top:' + ((pl.position === 'before' ? r.top : r.bottom) - 1) + 'px';
    dropBox.style.cssText = BASE + css + ';display:block';
  }
  function showGuides(par, vx, vy){
    ensureBoxes();
    var pr = par.getBoundingClientRect();
    if (vx == null) guideV.style.display = 'none'; else guideV.style.cssText = BASE + 'background:#f43f5e;width:1px;display:block;top:' + pr.top + 'px;height:' + pr.height + 'px;left:' + (pr.left + par.clientLeft + vx - (par.scrollLeft || 0)) + 'px';
    if (vy == null) guideH.style.display = 'none'; else guideH.style.cssText = BASE + 'background:#f43f5e;height:1px;display:block;left:' + pr.left + 'px;width:' + pr.width + 'px;top:' + (pr.top + par.clientTop + vy - (par.scrollTop || 0)) + 'px';
  }
  function endDrag(){
    dragging = false; dragCand = null; dragPl = null; fm = null; showDrop(null);
    if (guideV) { guideV.style.display = 'none'; guideH.style.display = 'none'; }
    document.documentElement.style.cursor = ''; schedule();
  }
  function insertNode(html, op){
    var tpl = document.createElement('template'); tpl.innerHTML = html;
    var node = tpl.content.firstElementChild; if (!node) return;
    var t = op.target && byId(op.target.id);
    if (op.target && !t) return;
    if (t) {
      var pos = op.target.position;
      if (pos === 'before') t.parentNode.insertBefore(node, t);
      else if (pos === 'inside' && !VOID[t.tagName.toLowerCase()]) t.appendChild(node);
      else t.parentNode.insertBefore(node, t.nextSibling);
    } else (document.querySelector('x-dc') || document.body).appendChild(node);
    emit(op); select(node);
  }

  // ---- free positioning ----
  // Converts a flow element to an absolutely positioned one WITHOUT moving it: the parent becomes the
  // positioning context and the element keeps its on-screen box.
  function makeFree(el){
    var par = el.parentElement;
    if (!par || !idOf(par)) { post({ type: 'hub:edit-note', text: 'This element cannot be placed freely (its parent is not editable).' }); return false; }
    var cs = getComputedStyle(el), r = el.getBoundingClientRect(), prevH = par.getBoundingClientRect().height, pset = null;
    if (getComputedStyle(par).position === 'static') { par.style.position = 'relative'; pset = { position: 'relative' }; }
    var pr = par.getBoundingClientRect();
    var set = {
      position: 'absolute',
      left: rnd(r.left - pr.left - par.clientLeft + (par.scrollLeft || 0) - px(cs.marginLeft)) + 'px',
      top: rnd(r.top - pr.top - par.clientTop + (par.scrollTop || 0) - px(cs.marginTop)) + 'px',
      width: cs.width
    };
    if (/^(img|svg|video|canvas|iframe|input|textarea|select)$/i.test(el.tagName) || el.style.height) set.height = cs.height;
    var d = declared(el); if (d.right) set.right = null; if (d.bottom) set.bottom = null;
    Object.keys(set).forEach(function(k){ if (set[k] === null) el.style.removeProperty(k); else el.style.setProperty(k, set[k]); });
    // The parent must not collapse just because its child left the flow.
    if (prevH - par.getBoundingClientRect().height > 2) { par.style.minHeight = rnd(prevH) + 'px'; pset = pset || {}; pset['min-height'] = rnd(prevH) + 'px'; }
    if (pset) emit({ type: 'style', id: idOf(par), set: pset });
    emit({ type: 'style', id: idOf(el), set: set });
    return true;
  }
  function makeFlow(el){
    var set = { position: null, left: null, top: null, right: null, bottom: null };
    Object.keys(set).forEach(function(k){ el.style.removeProperty(k); });
    emit({ type: 'style', id: idOf(el), set: set });
  }
  // Nearest container (not a table row, not inline text) around a point; .dc.html boards use their template root.
  function containerAt(x, y){
    var t = editableAt(hitTest(x, y, null));
    while (t && (!CONT[t.tagName.toLowerCase()] || NOINS[t.tagName.toLowerCase()])) t = t.parentElement ? editableAt(t.parentElement) : null;
    // Empty space around or below the content hits the document root: the body (or template root) is the container then.
    if (!t && document.body && idOf(document.body)) t = document.body;
    if (t && t === document.body && document.querySelector('x-dc')) { var root = document.querySelector('x-dc > *'); if (root && idOf(root)) t = root; }
    return t;
  }
  function showGhost(x, y, par){
    ensureBoxes(); hoverEl = par; schedule();
    dropBox.style.cssText = BASE + 'border:2px dashed #3b82f6;background:rgba(59,130,246,.12);left:' + x + 'px;top:' + y + 'px;width:140px;height:80px;display:block';
  }
  // Palette drop in free mode: the element goes INTO the container under the pointer, positioned exactly where released.
  function freeDrop(m){
    var par = containerAt(m.x, m.y); showDrop(null); hoverEl = null;
    if (!par) { post({ type: 'hub:edit-note', text: 'Cannot drop here. Drop onto a container.' }); return; }
    var pset = null;
    if (getComputedStyle(par).position === 'static') { par.style.position = 'relative'; pset = { position: 'relative' }; }
    var pr = par.getBoundingClientRect();
    var set = { position: 'absolute', left: rnd(m.x - pr.left - par.clientLeft + (par.scrollLeft || 0)) + 'px', top: rnd(m.y - pr.top - par.clientTop + (par.scrollTop || 0)) + 'px' };
    if (m.kind === 'image' || m.kind === 'divider') set.width = '240px';
    if (pset) emit({ type: 'style', id: idOf(par), set: pset });
    insertNode(m.html, { type: 'insert', kind: m.kind, id: m.id, target: { id: idOf(par), position: 'inside' } });
    var node = byId(m.id); if (!node) return;
    Object.keys(set).forEach(function(k){ node.style.setProperty(k, set[k]); });
    emit({ type: 'style', id: m.id, set: set }); select(node);
  }
  function snap(el, l, t){
    var par = el.offsetParent || document.body, T = 6, out = { l: l, t: t, vx: null, vy: null, par: par };
    var cs = getComputedStyle(el), ml = px(cs.marginLeft), mt = px(cs.marginTop), ew = el.offsetWidth, eh = el.offsetHeight, pw = par.clientWidth, ph = par.clientHeight;
    var xs = [0, pw / 2, pw], ys = [0, ph / 2, ph];
    [].forEach.call(par.children, function(s){
      if (s === el || isOverlay(s) || !idOf(s)) return;
      xs.push(s.offsetLeft, s.offsetLeft + s.offsetWidth / 2, s.offsetLeft + s.offsetWidth);
      ys.push(s.offsetTop, s.offsetTop + s.offsetHeight / 2, s.offsetTop + s.offsetHeight);
    });
    var bx = Infinity, by = Infinity;
    [l + ml, l + ml + ew / 2, l + ml + ew].forEach(function(m){ xs.forEach(function(x){ var d = x - m; if (Math.abs(d) <= T && Math.abs(d) < Math.abs(bx === Infinity ? Infinity : bx)) { bx = d; out.vx = x; } }); });
    [t + mt, t + mt + eh / 2, t + mt + eh].forEach(function(m){ ys.forEach(function(y){ var d = y - m; if (Math.abs(d) <= T && Math.abs(d) < Math.abs(by === Infinity ? Infinity : by)) { by = d; out.vy = y; } }); });
    if (bx !== Infinity) out.l = l + bx; if (by !== Infinity) out.t = t + by;
    return out;
  }
  function moveFree(ev){
    var nl = fm.l + (ev.clientX - fm.x), nt = fm.t + (ev.clientY - fm.y), s = (ev.ctrlKey || ev.metaKey) ? { l: nl, t: nt, vx: null, vy: null, par: fm.el.offsetParent || document.body } : snap(fm.el, nl, nt); // Ctrl/Cmd turns snapping off
    fm.el.style.left = rnd(s.l) + 'px'; fm.el.style.top = rnd(s.t) + 'px';
    fm.el.style.removeProperty('right'); fm.el.style.removeProperty('bottom');
    showGuides(s.par, s.vx, s.vy); schedule();
  }
  function finishFree(){
    var el = fm.el, set = { left: el.style.left, top: el.style.top }, d = declared(el);
    if (fm.hadRight || d.right) set.right = null; if (fm.hadBottom || d.bottom) set.bottom = null;
    emit({ type: 'style', id: idOf(el), set: set }); endDrag(); select(el);
  }
  function startResize(k, ev){
    var el = sel, cs = getComputedStyle(el), r = el.getBoundingClientRect(), free = isFree(el);
    resizing = { k: k, el: el, x: ev.clientX, y: ev.clientY, w: px(cs.width), h: px(cs.height), l: free ? leftOf(el) : 0, t: free ? topOf(el) : 0, ratio: r.width / (r.height || 1), free: free, touched: {} };
    ev.preventDefault(); ev.stopPropagation();
  }
  function doResize(ev){
    var z = resizing, dx = ev.clientX - z.x, dy = ev.clientY - z.y, w = z.w, h = z.h, l = z.l, t = z.t, k = z.k;
    if (k.indexOf('e') >= 0) { w = z.w + dx; z.touched.width = 1; }
    if (k.indexOf('w') >= 0) { w = z.w - dx; l = z.l + dx; z.touched.width = 1; z.touched.left = 1; }
    if (k.indexOf('s') >= 0) { h = z.h + dy; z.touched.height = 1; }
    if (k.indexOf('n') >= 0) { h = z.h - dy; t = z.t + dy; z.touched.height = 1; z.touched.top = 1; }
    if (ev.shiftKey && k.length === 2) { var nh = w / z.ratio; if (k.indexOf('n') >= 0) t += h - nh; h = nh; z.touched.height = 1; }
    w = Math.max(8, w); h = Math.max(8, h);
    if (z.touched.width) z.el.style.width = rnd(w) + 'px';
    if (z.touched.height) z.el.style.height = rnd(h) + 'px';
    if (z.free && z.touched.left) z.el.style.left = rnd(l) + 'px';
    if (z.free && z.touched.top) z.el.style.top = rnd(t) + 'px';
    schedule();
  }
  function finishResize(){
    var z = resizing, set = {}; resizing = null;
    if (z.touched.width) set.width = z.el.style.width; if (z.touched.height) set.height = z.el.style.height;
    if (z.touched.left) set.left = z.el.style.left; if (z.touched.top) set.top = z.el.style.top;
    if (Object.keys(set).length) emit({ type: 'style', id: idOf(z.el), set: set });
    select(z.el);
  }
  function alignTo(el, to){
    var par = el.offsetParent || document.body, set = {};
    if (isFree(el)) {
      var cs = getComputedStyle(el), ew = el.offsetWidth, eh = el.offsetHeight, ml = px(cs.marginLeft), mt = px(cs.marginTop);
      if (to === 'left') set.left = rnd(-ml) + 'px'; if (to === 'hcenter') set.left = rnd((par.clientWidth - ew) / 2 - ml) + 'px'; if (to === 'right') set.left = rnd(par.clientWidth - ew - ml) + 'px';
      if (to === 'top') set.top = rnd(-mt) + 'px'; if (to === 'vmiddle') set.top = rnd((par.clientHeight - eh) / 2 - mt) + 'px'; if (to === 'bottom') set.top = rnd(par.clientHeight - eh - mt) + 'px';
      if (set.left !== undefined) set.right = null; if (set.top !== undefined) set.bottom = null;
    } else {
      var pf = el.parentElement && /flex/.test(getComputedStyle(el.parentElement).display);
      if (VOID[el.tagName.toLowerCase()] && !/block|flex|grid/.test(getComputedStyle(el).display)) set.display = 'block';
      if (to === 'left') { set['margin-left'] = '0'; set['margin-right'] = 'auto'; }
      if (to === 'hcenter') { set['margin-left'] = 'auto'; set['margin-right'] = 'auto'; }
      if (to === 'right') { set['margin-left'] = 'auto'; set['margin-right'] = '0'; }
      if (pf && (to === 'top' || to === 'vmiddle' || to === 'bottom')) set['align-self'] = to === 'top' ? 'flex-start' : to === 'bottom' ? 'flex-end' : 'center';
      else if (to === 'top' || to === 'vmiddle' || to === 'bottom') { post({ type: 'hub:edit-note', text: 'Vertical alignment needs a flex parent or a freely placed element.' }); return; }
    }
    Object.keys(set).forEach(function(k){ if (set[k] === null) el.style.removeProperty(k); else el.style.setProperty(k, set[k]); });
    emit({ type: 'style', id: idOf(el), set: set }); select(el);
  }

  // ---- inline text editing ----
  function startEdit(el){
    editing = el; editOriginal = el.innerHTML;
    el.setAttribute('contenteditable', 'true'); el.focus();
    var range = document.createRange(); range.selectNodeContents(el);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
    el.addEventListener('blur', onBlur);
    schedule();
  }
  function onBlur(ev){ if (ev.target === editing) commitEdit(); }
  function commitEdit(){
    if (!editing) return;
    var el = editing; editing = null;
    el.removeEventListener('blur', onBlur);
    el.removeAttribute('contenteditable');
    if (el.innerHTML !== editOriginal) emit({ type: 'text', id: idOf(el), html: el.innerHTML });
    select(el);
  }
  function cancelEdit(){
    if (!editing) return;
    var el = editing; editing = null;
    el.removeEventListener('blur', onBlur);
    el.removeAttribute('contenteditable'); el.innerHTML = editOriginal; select(el);
  }

  // ---- DOM input ----
  function handleKeyOf(t){ return t && t.getAttribute ? t.getAttribute('data-hub-handle') : null; }
  document.addEventListener('mousemove', function(ev){
    if (!on) return;
    if (resizing) { doResize(ev); return; }
    if (dragCand && !dragging && (ev.buttons & 1) && Math.hypot(ev.clientX - dragCand.x, ev.clientY - dragCand.y) > 5) {
      dragging = true; select(dragCand.el); document.documentElement.style.cursor = 'grabbing';
      var el = dragCand.el, wasFree = isFree(el);
      // A free element always moves freely. A flow element moves freely too (it is pulled out of the flow where it is),
      // unless the drag mode is 'flow' or Alt is held, which reorders it in the flow instead (Alt flips the mode).
      var wantFree = dragMode === 'free' ? !ev.altKey : ev.altKey;
      if (wasFree || (wantFree && !NOFREE[el.tagName.toLowerCase()] && makeFree(el))) {
        var d0 = declared(el);
        fm = { el: el, l: leftOf(el), t: topOf(el), x: dragCand.x, y: dragCand.y, fromFlow: !wasFree, hadRight: !!d0.right, hadBottom: !!d0.bottom };
      }
    }
    if (dragging && fm) { moveFree(ev); return; }
    if (dragging) { dragPl = placementAt(ev.clientX, ev.clientY, dragCand.el); showDrop(dragPl); return; }
    if (editing) return;
    var h = editableAt(ev.target); if (h !== hoverEl) { hoverEl = h; schedule(); }
  }, true);
  document.addEventListener('mousedown', function(ev){
    if (!on) return;
    var hk = handleKeyOf(ev.target); if (hk && sel) { startResize(hk, ev); return; }
    if (editing && editing.contains(ev.target)) return;
    if (editing) commitEdit();
    var cand = ev.button === 0 ? editableAt(ev.target) : null;
    dragCand = cand && cand !== document.body ? { el: cand, x: ev.clientX, y: ev.clientY } : null;
    ev.preventDefault();
    // preventDefault also stops the browser from moving keyboard focus here, so Delete, Ctrl+D and the arrow keys would
    // go to the page around the board. Take focus explicitly.
    try { window.focus(); } catch (_) {}
  }, true);
  document.addEventListener('mouseup', function(){
    if (!on) return;
    if (resizing) { finishResize(); suppressClick = true; setTimeout(function(){ suppressClick = false; }, 0); return; }
    if (!dragging) { dragCand = null; return; }
    suppressClick = true; setTimeout(function(){ suppressClick = false; }, 0);
    if (fm) { finishFree(); return; }
    var el = dragCand.el, pl = dragPl;
    endDrag();
    if (!pl || pl.none || !pl.target || pl.target === el) return;
    var same = (pl.position === 'before' && el.nextElementSibling === pl.target) || (pl.position === 'after' && el.previousElementSibling === pl.target) ||
      (pl.position === 'inside' && pl.target.lastElementChild === el);
    if (same) { select(el); return; }
    if (pl.position === 'before') pl.target.parentNode.insertBefore(el, pl.target);
    else if (pl.position === 'after') pl.target.parentNode.insertBefore(el, pl.target.nextSibling);
    else pl.target.appendChild(el);
    emit({ type: 'moveTo', id: idOf(el), target: { id: idOf(pl.target), position: pl.position } }); select(el);
  }, true);
  document.documentElement.addEventListener('mouseleave', function(){ if (dragging && !fm) endDrag(); });
  document.addEventListener('click', function(ev){
    if (!on) return;
    if (suppressClick) { ev.preventDefault(); ev.stopPropagation(); return; }
    if ((editing && editing.contains(ev.target)) || isOverlay(ev.target)) return;
    ev.preventDefault(); ev.stopPropagation();
    if (ev.shiftKey && sel) { toggleMulti(editableAt(ev.target)); return; }
    select(editableAt(ev.target));
  }, true);
  document.addEventListener('dblclick', function(ev){
    if (!on) return;
    var el = editableAt(ev.target); if (!el) return;
    var d = describe(el);
    if (d.textEditable) { ev.preventDefault(); select(el); startEdit(el); }
    else post({ type: 'hub:edit-note', text: d.bound ? 'This text comes from template data: edit it under Template in the panel.' : 'Select an inner element to edit its text.' });
  }, true);
  ['submit', 'auxclick', 'contextmenu'].forEach(function(t){ document.addEventListener(t, function(ev){ if (on && !editing) ev.preventDefault(); }, true); });
  document.addEventListener('keydown', function(ev){
    if (!on) return;
    if ((dragging || resizing) && ev.key === 'Escape') { ev.preventDefault(); if (resizing) { resizing = null; post({ type: 'hub:edit-reload' }); } endDrag(); return; }
    if (editing) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commitEdit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); cancelEdit(); }
      return;
    }
    var mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); post({ type: 'hub:key', key: 'undo', code: ev.code, mod: true, shift: ev.shiftKey, alt: ev.altKey }); return; }
    if (!sel) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); run({ cmd: 'delete', id: idOf(sel) }); }
    else if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); run({ cmd: 'duplicate', id: idOf(sel) }); }
    else if (mod && ev.key.toLowerCase() === 'g') { ev.preventDefault(); run({ cmd: ev.shiftKey ? 'ungroup' : 'group', id: idOf(sel) }); }
    else if (ev.key === 'Escape') { select(null); }
    else if (/^Arrow/.test(ev.key) && isFree(sel)) {
      ev.preventDefault();
      var step = ev.shiftKey ? 10 : 1, l = leftOf(sel), t = topOf(sel);
      if (ev.key === 'ArrowLeft') l -= step; if (ev.key === 'ArrowRight') l += step; if (ev.key === 'ArrowUp') t -= step; if (ev.key === 'ArrowDown') t += step;
      sel.style.left = rnd(l) + 'px'; sel.style.top = rnd(t) + 'px';
      emit({ type: 'style', id: idOf(sel), set: { left: sel.style.left, top: sel.style.top } }); report();
    }
  }, true);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  // Our own overlays change constantly; only real page changes may trigger a repaint (otherwise: an endless loop).
  try {
    new MutationObserver(function(muts){
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i], t = m.target;
        if (t.nodeType === 1 && isOverlay(t)) continue;
        if (m.type === 'childList' && [].every.call(m.addedNodes, isOverlay) && [].every.call(m.removedNodes, isOverlay)) continue;
        schedule(); scheduleTree(); break;
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  } catch (_) {}

  // ---- group / ungroup ----
  // Grouping wraps siblings (and whatever lies between them) in a new div. When every member is freely positioned the
  // wrapper becomes a free box around them and the members move to its coordinate space, so nothing jumps.
  function doGroup(){
    if (!sel) return;
    if (!canGroup()) { note('These elements cannot be grouped. Pick siblings with the same parent (not list or table items).'); return; }
    var members = [sel].concat(multi).sort(function(a, b){ return a.compareDocumentPosition(b) & 4 ? -1 : 1; });
    var par = sel.parentElement, first = members[0], last = members[members.length - 1], gid = newId();
    var wrap = document.createElement('div'); wrap.setAttribute('data-hub-id', gid);
    var allFree = members.every(isFree), style = '', childOps = [];
    if (allFree) {
      var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      members.forEach(function(m){ var ml = leftOf(m), mt = topOf(m); l = Math.min(l, ml); t = Math.min(t, mt); r = Math.max(r, ml + m.offsetWidth); b = Math.max(b, mt + m.offsetHeight); });
      l = rnd(l); t = rnd(t);
      style = 'position: absolute; left: ' + l + 'px; top: ' + t + 'px; width: ' + rnd(r - l) + 'px; height: ' + rnd(b - t) + 'px';
      wrap.style.cssText = style;
      members.forEach(function(m){ childOps.push({ el: m, set: { left: rnd(leftOf(m) - l) + 'px', top: rnd(topOf(m) - t) + 'px' } }); });
    }
    var nodes = []; for (var n = first; n; n = n.nextSibling) { nodes.push(n); if (n === last) break; }
    par.insertBefore(wrap, first);
    nodes.forEach(function(nd){ wrap.appendChild(nd); });
    var ids = members.map(idOf);
    var op = { type: 'group', ids: ids, id: gid }; if (style) op.style = style;
    emit(op);
    childOps.forEach(function(c){ Object.keys(c.set).forEach(function(k){ c.el.style.setProperty(k, c.set[k]); }); emit({ type: 'style', id: idOf(c.el), set: c.set }); });
    select(wrap);
  }
  function doUngroup(){
    if (!sel || !GROUPABLE[sel.tagName.toLowerCase()] || sel === document.body || !sel.children.length) { note('Select a group (a wrapper element with content) to ungroup it.'); return; }
    var wrapEl = sel, par = wrapEl.parentNode, kids = [].slice.call(wrapEl.children).filter(idOf);
    var pos = getComputedStyle(wrapEl).position, shift = pos !== 'static' ? { x: wrapEl.offsetLeft + wrapEl.clientLeft, y: wrapEl.offsetTop + wrapEl.clientTop } : null;
    if (shift) kids.forEach(function(k){
      if (!isFree(k)) return;
      var set = { left: rnd(leftOf(k) + shift.x) + 'px', top: rnd(topOf(k) + shift.y) + 'px' };
      emit({ type: 'style', id: idOf(k), set: set });
      k.setAttribute('data-hub-tmp', JSON.stringify(set));
    });
    while (wrapEl.firstChild) par.insertBefore(wrapEl.firstChild, wrapEl);
    kids.forEach(function(k){ var tmp = k.getAttribute('data-hub-tmp'); if (tmp) { var set = JSON.parse(tmp); k.removeAttribute('data-hub-tmp'); Object.keys(set).forEach(function(p){ k.style.setProperty(p, set[p]); }); } });
    wrapEl.remove();
    emit({ type: 'ungroup', id: idOf(wrapEl) });
    select(kids[0] || null);
    multi = kids.slice(1); report();
  }

  // ---- commands from the viewer ----
  function run(m){
    var el = byId(m.id);
    switch (m.cmd) {
      case 'select': if (m.extend && sel && el) toggleMulti(el); else select(el); break;
      case 'deselect': select(null); break;
      case 'hover': hoverEl = el; schedule(); break;
      case 'tree': postTree(); break;
      case 'style':
        if (!el) return;
        allById(m.id).forEach(function(t){ Object.keys(m.set || {}).forEach(function(k){ if (m.set[k] === null || m.set[k] === '') t.style.removeProperty(k); else t.style.setProperty(k, m.set[k]); }); });
        emit({ type: 'style', id: m.id, set: m.set }); select(el); break;
      case 'attr':
        if (!el) return;
        allById(m.id).forEach(function(t){ if (m.value === '' && (m.name === 'id' || m.name === 'class' || m.name === 'aria-label')) t.removeAttribute(m.name); else t.setAttribute(m.name, m.value); });
        emit({ type: 'attr', id: m.id, name: m.name, value: m.value }); select(el); break;
      case 'position':
        if (!el) return;
        if (m.mode === 'free') { if (!isFree(el)) makeFree(el); } else if (isFree(el)) makeFlow(el);
        select(el); break;
      case 'align': if (el) alignTo(el, m.to); break;
      case 'nudge':
        if (el && isFree(el)) {
          el.style.left = rnd(leftOf(el) + (m.dx || 0)) + 'px'; el.style.top = rnd(topOf(el) + (m.dy || 0)) + 'px';
          emit({ type: 'style', id: m.id, set: { left: el.style.left, top: el.style.top } }); select(el);
        }
        break;
      case 'insert': insertNode(m.html, m.op); break;
      case 'group': doGroup(); break;
      case 'ungroup': doUngroup(); break;
      case 'drag-mode': dragMode = m.mode === 'flow' ? 'flow' : 'free'; break;
      case 'drag-over': if (dragMode === 'free') { var c0 = containerAt(m.x, m.y); if (c0) showGhost(m.x, m.y, c0); else showDrop(null); } else showDrop(placementAt(m.x, m.y, null)); break;
      case 'drag-leave': showDrop(null); hoverEl = null; schedule(); break;
      case 'drag-drop': {
        if (dragMode === 'free') { freeDrop(m); break; }
        var pl = placementAt(m.x, m.y, null); showDrop(null);
        if (!pl) { post({ type: 'hub:edit-note', text: 'Cannot drop here. Drop onto a container or beside another element.' }); return; }
        var iop = { type: 'insert', kind: m.kind, id: m.id };
        if (!pl.none) iop.target = { id: idOf(pl.target), position: pl.position };
        insertNode(m.html, iop); break;
      }
      case 'delete': {
        if (!el) return;
        var par = el.parentElement ? editableAt(el.parentElement) : null;
        el.remove(); emit({ type: 'delete', id: m.id }); select(par); break;
      }
      case 'duplicate': {
        if (!el) return;
        var clone = el.cloneNode(true), map = {};
        [clone].concat([].slice.call(clone.querySelectorAll('[data-hub-id],[data-hub-pid]'))).forEach(function(n){
          var old = idOf(n); var nid = newId(); map[old] = nid;
          n.removeAttribute('data-hub-pid'); n.setAttribute('data-hub-id', nid);
        });
        el.parentNode.insertBefore(clone, el.nextSibling);
        emit({ type: 'duplicate', id: m.id, idMap: map }); select(clone); break;
      }
      case 'move': {
        if (!el) return;
        var other = siblingWithId(el, m.dir === 'up' ? -1 : 1); if (!other) return;
        if (m.dir === 'up') el.parentNode.insertBefore(el, other); else el.parentNode.insertBefore(other, el);
        emit({ type: 'move', id: m.id, otherId: idOf(other) }); select(el); break;
      }
      case 'export-html': {
        var src = el || document.body, c = src.cloneNode(true);
        [c].concat([].slice.call(c.querySelectorAll('*'))).forEach(function(n){ ['data-hub-id', 'data-hub-pid', 'data-hub-h', 'contenteditable'].forEach(function(a){ n.removeAttribute(a); }); });
        [].slice.call(c.querySelectorAll('[data-hub-overlay],script')).forEach(function(n){ n.remove(); });
        post({ type: 'hub:edit-export', html: c.tagName === 'BODY' ? c.innerHTML : c.outerHTML }); break;
      }
      case 'tweak-set':
        if (window.__dcSetProps) { window.__dcSetProps(m.props || {}); setTimeout(function(){ postTweaks(); report(); }, 30); }
        break;
    }
  }
  window.addEventListener('message', function(ev){
    var d = ev.data; if (!d || ev.source !== window.parent) return;
    if (d.type === 'hub:edit-mode') {
      on = !!d.enabled;
      if (!on) { if (editing) cancelEdit(); sel = null; hoverEl = null; resizing = null; ensureBoxes(); endDrag(); [selBox, hoverBox, tagLabel, dropBox, guideV, guideH].forEach(function(b){ b.style.display = 'none'; }); Object.keys(handles).forEach(function(k){ handles[k].style.display = 'none'; }); }
    } else if (d.type === 'hub:edit-cmd') {
      if (d.cmd === 'tweak-set') run(d);
      else if (on) run(d);
    }
  });
  window.addEventListener('load', function(){ setTimeout(postTweaks, 80); });
})();</script>`
