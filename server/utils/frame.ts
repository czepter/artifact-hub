import { EDITOR } from './editorScript'
import {
  buildPreviewVisibilityGuard,
  buildPreviewSandboxShim,
  buildPreviewRedirectGuard,
} from '../../shared/vendor/open-design/preview-guards'
import {
  findRealTagEnd,
  findRealTagOffset,
  prependAfterDoctype,
  HTML_TAG_PATTERNS,
} from '../../shared/vendor/open-design/html-injection-points'

/**
 * In-frame bridge. Speaks a small postMessage protocol with the host viewer:
 *   host -> frame  hub:comment-mode {enabled}
 *                  hub:locate {items:[{id, selector, text}]}
 *                  hub:tweaks-update {values}   live tweak values for a Design Component board (handled by its runtime)
 *                  hub:tweaks-request           ask the board to announce its tweaks again
 *   frame -> host  hub:ready | hub:layout | hub:target {anchor} | hub:located {items:[{id, rect|null}]} | hub:navigate {href} | hub:tweaks-ready {defs, values}
 * Unlike Open Design's own bridge (which only targets elements the agent tagged with data-od-id),
 * this one anchors to any element via a stable CSS path plus a text fingerprint.
 */
const BRIDGE = String.raw`<script data-hub-bridge>(function(){
  var enabled = false, hover = null, box = null, navKeys = false;
  function post(m){ try { window.parent.postMessage(m, '*'); } catch (_) {} }
  function esc(s){ return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
  function unique(sel){ try { return document.querySelectorAll(sel).length === 1; } catch (_) { return false; } }
  function selectorFor(el){
    if (!el || el === document.body || el === document.documentElement) return 'body';
    var hid = el.getAttribute('data-hub-id'); if (hid && unique('[data-hub-id="' + hid.replace(/"/g, '\\"') + '"]')) return '[data-hub-id="' + hid.replace(/"/g, '\\"') + '"]';
    var od = el.getAttribute('data-od-id'); if (od && unique('[data-od-id="' + od.replace(/"/g, '\\"') + '"]')) return '[data-od-id="' + od.replace(/"/g, '\\"') + '"]';
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && unique('#' + esc(el.id))) return '#' + esc(el.id);
    var parts = [], node = el, depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 12) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id) && unique('#' + esc(node.id))) { parts.unshift('#' + esc(node.id)); break; }
      var tag = node.tagName.toLowerCase(), idx = 1, sib = node;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === node.tagName) idx++;
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      node = node.parentElement; depth++;
    }
    return (parts[0] && parts[0][0] === '#' ? '' : 'body > ') + parts.join(' > ');
  }
  function textOf(el){ return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120); }
  function rectOf(el){ var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  function find(item){
    var el = null;
    try { el = item.selector ? document.querySelector(item.selector) : null; } catch (_) {}
    if (el && item.text && textOf(el).slice(0, 40) !== item.text.slice(0, 40) && item.text.length > 3) {
      // Selector still matches something, but the content moved. Try to re-find by text.
      var all = document.querySelectorAll(el.tagName.toLowerCase()), best = null;
      for (var i = 0; i < all.length; i++) if (textOf(all[i]).slice(0, 40) === item.text.slice(0, 40)) { best = all[i]; break; }
      if (best) el = best;
    }
    return el;
  }
  function ensureBox(){
    if (box) return box;
    box = document.createElement('div');
    box.setAttribute('data-hub-overlay', '');
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #d97757;background:rgba(217,119,87,.12);border-radius:3px;display:none;transition:all .05s';
    document.documentElement.appendChild(box);
    return box;
  }
  function drawHover(el){
    var b = ensureBox();
    if (!el) { b.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    b.style.cssText += ';display:block;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
  }
  function targetEl(ev){ var el = ev.target; return el && el.nodeType === 1 && !el.hasAttribute('data-hub-overlay') ? el : null; }
  document.addEventListener('mousemove', function(ev){ if (!enabled) return; hover = targetEl(ev); drawHover(hover); }, true);
  document.addEventListener('mouseleave', function(){ drawHover(null); }, true);
  document.addEventListener('click', function(ev){
    if (!enabled) return;
    var el = targetEl(ev); if (!el) return;
    ev.preventDefault(); ev.stopPropagation();
    var r = el.getBoundingClientRect();
    post({ type: 'hub:target', anchor: {
      selector: selectorFor(el), tag: el.tagName.toLowerCase(), text: textOf(el),
      rel: { x: r.width ? Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) : 0, y: r.height ? Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) : 0 },
      click: { x: ev.clientX, y: ev.clientY }
    }});
  }, true);
  ['submit', 'dblclick', 'auxclick'].forEach(function(t){ document.addEventListener(t, function(ev){ if (enabled) { ev.preventDefault(); ev.stopPropagation(); } }, true); });
  window.addEventListener('message', function(ev){
    var d = ev.data; if (!d || typeof d.type !== 'string' || ev.source !== window.parent) return;
    if (d.type === 'hub:nav-keys') navKeys = !!d.enabled;
    if (d.type === 'hub:comment-mode') { enabled = !!d.enabled; document.documentElement.toggleAttribute('data-hub-comment-mode', enabled); if (!enabled) drawHover(null); }
    if (d.type === 'hub:locate') {
      var out = [];
      (d.items || []).forEach(function(it){ var el = find(it); if (!el) { out.push({ id: it.id, rect: null }); return; } var r = rectOf(el); out.push({ id: it.id, rect: r, rel: it.rel || null }); });
      post({ type: 'hub:located', items: out });
    }
  });
  // In focus/present mode the viewer owns the arrow keys; forward them from inside the page (not while typing).
  document.addEventListener('keydown', function(ev){
    if (enabled && ev.key === 'Escape') { post({ type: 'hub:escape' }); return; }
    if (!navKeys || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var t = ev.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Escape'].indexOf(ev.key) < 0) return;
    ev.preventDefault(); post({ type: 'hub:key', key: ev.key, code: ev.code, mod: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey, alt: ev.altKey });
  }, true);
  // Links between views: a plain click on a link to another file (or an external site) is handed to the viewer, which
  // focuses the target board, loads the page in this frame or opens a new tab. Anchors (#x) and links the page handled itself are left alone.
  document.addEventListener('click', function(ev){
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    // Any element can navigate between boards with data-nav="Other.dc.html" (resolved against this page), e.g. a table row opening its detail board.
    var nv = ev.target && ev.target.closest ? ev.target.closest('[data-nav]') : null;
    if (nv && !nv.closest('a[href]')) { try { ev.preventDefault(); post({ type: 'hub:navigate', href: new URL(nv.getAttribute('data-nav'), document.baseURI).href }); } catch (_) {} return; }
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null; if (!a) return;
    var raw = a.getAttribute('href');
    if (!raw || raw.charAt(0) === '#' || /^(mailto|tel|javascript|blob|data):/i.test(raw) || a.hasAttribute('download')) return;
    if (a.target && a.target !== '_self') return;
    ev.preventDefault(); post({ type: 'hub:navigate', href: a.href });
  }, false);
  var layoutTimer = null;
  function layout(){ clearTimeout(layoutTimer); layoutTimer = setTimeout(function(){ post({ type: 'hub:layout', width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }); }, 80); }
  window.addEventListener('load', function(){ post({ type: 'hub:ready' }); layout(); });
  window.addEventListener('resize', layout);
  window.addEventListener('scroll', layout, true);
  try { new MutationObserver(layout).observe(document.documentElement, { childList: true, subtree: true, attributes: true }); } catch (_) {}
})();</script>`


/**
 * window.artifact: what a published page can use. Calls go to the viewer (parent window) over
 * postMessage; the viewer performs them with the viewer's own session, so the sandboxed page never
 * holds credentials. Outside the viewer (file opened directly) storage calls reject.
 *
 *   await artifact.ready                       -> { viewer:{name,role,canWrite}, artifactId, version, live } | null
 *   await artifact.shared.set('poll/ada', {choice:'A'})   // visible to everyone using the artifact
 *   await artifact.shared.get('poll/ada')      -> value | null
 *   await artifact.shared.list('poll/')        -> [{key, value, updatedAt, updatedBy}]
 *   await artifact.shared.delete('poll/ada')
 *   artifact.shared.onChange(({keys}) => ...)  -> unsubscribe()   // live, from other viewers or the model
 *   artifact.personal.*                        // same calls, private to the current viewer
 */
const ARTIFACT_API = String.raw`<script data-hub-artifact-api>(function(){
  if (window.artifact) return;
  var inHost = false; try { inHost = window.parent && window.parent !== window; } catch (_) {}
  var seq = 0, pending = {}, info = null, listeners = [], settle, ready = new Promise(function(r){ settle = r; });
  function post(m){ try { window.parent.postMessage(m, '*'); return true; } catch (e) { return false; } }
  function call(op, scope, key, value, prefix){
    if (!inHost) return Promise.reject(new Error('artifact storage needs the Artifact Hub viewer'));
    return new Promise(function(resolve, reject){
      var id = ++seq;
      var t = setTimeout(function(){ delete pending[id]; reject(new Error('artifact: request timed out')); }, 15000);
      pending[id] = { resolve: resolve, reject: reject, t: t };
      if (!post({ type: 'hub:rpc', id: id, op: op, scope: scope, key: key, value: value, prefix: prefix })) {
        clearTimeout(t); delete pending[id]; reject(new Error('artifact: value cannot be sent (functions and DOM nodes are not allowed)'));
      }
    });
  }
  window.addEventListener('message', function(ev){
    if (ev.source !== window.parent) return;
    var d = ev.data; if (!d || typeof d.type !== 'string') return;
    if (d.type === 'hub:rpc-result' && pending[d.id]) {
      var p = pending[d.id]; clearTimeout(p.t); delete pending[d.id];
      if (d.ok) p.resolve(d.result); else p.reject(new Error(d.error || 'artifact: request failed'));
    } else if (d.type === 'hub:hello-result') {
      info = d.info; settle(info);
    } else if (d.type === 'hub:data-changed') {
      listeners.slice().forEach(function(l){ if (l.scope === d.scope) { try { l.fn({ keys: d.keys || [] }); } catch (_) {} } });
    }
  });
  (function hello(n){
    if (info) return;
    if (!inHost || n > 24) { settle(null); return; }
    post({ type: 'hub:hello' });
    setTimeout(function(){ hello(n + 1); }, 250);
  })(0);
  function scoped(scope){
    return Object.freeze({
      get: function(key){ return call('get', scope, key).then(function(r){ return r ? r.value : null; }); },
      list: function(prefix){ return call('list', scope, undefined, undefined, prefix || ''); },
      set: function(key, value){ return call('set', scope, key, value).then(function(){}); },
      delete: function(key){ return call('delete', scope, key).then(function(){}); },
      onChange: function(fn){ var l = { scope: scope, fn: fn }; listeners.push(l); return function(){ listeners = listeners.filter(function(x){ return x !== l; }); }; }
    });
  }
  Object.defineProperty(window, 'artifact', { value: Object.freeze({ ready: ready, shared: scoped('shared'), personal: scoped('personal'), get info(){ return info; } }), configurable: false });
})();</script>`


const SHELL_HEAD = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0}</style>'

/** Wrap a fragment into a full document; pass full documents through. */
function ensureDocument(source: string): string {
  if (findRealTagOffset(source, HTML_TAG_PATTERNS.htmlOpen) >= 0 || /^\s*<!doctype/i.test(source)) return source
  return `<!doctype html><html><head>${SHELL_HEAD}</head><body>${source}</body></html>`
}

/**
 * Inject guards + comment bridge into an artifact HTML file. Uses Open Design's tag-aware
 * helpers so injection points inside comments, scripts or attribute values are never matched.
 */
export function instrumentHtml(source: string, opts: { props?: Record<string, unknown>, path?: string, isDc?: boolean } = {}): string {
  let doc = ensureDocument(source)
  const isDc = opts.isDc || (opts.path && opts.path.endsWith('.dc.html')) || /<x-dc\b/i.test(source)
  const dcSupport = isDc && !/support\.js/i.test(doc) ? '<script src="./support.js"></script>' : ''
  // Saved tweak values for this board (window.__dcProps), JSON escaped so it can never end the script element.
  const props = opts.props && Object.keys(opts.props).length ? `<script data-hub-props>window.__dcProps=${JSON.stringify(opts.props).replace(/</g, '\\u003c')};</script>` : ''
  const guards = buildPreviewVisibilityGuard() + buildPreviewSandboxShim() + buildPreviewRedirectGuard() + ARTIFACT_API + props + dcSupport
  const headEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.headOpen)
  if (headEnd >= 0) {
    doc = doc.slice(0, headEnd) + guards + doc.slice(headEnd)
  } else {
    const htmlEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.htmlOpen)
    doc = htmlEnd >= 0
      ? doc.slice(0, htmlEnd) + `<head>${guards}</head>` + doc.slice(htmlEnd)
      : prependAfterDoctype(doc, guards)
  }
  const bodyClose = findRealTagOffset(doc, HTML_TAG_PATTERNS.bodyClose)
  const tail = BRIDGE + EDITOR
  return bodyClose >= 0 ? doc.slice(0, bodyClose) + tail + doc.slice(bodyClose) : doc + tail
}

/** Response headers for any artifact file: opaque origin even when opened directly. */
export const FRAME_HEADERS = {
  'Content-Security-Policy': 'sandbox allow-scripts allow-popups allow-forms allow-downloads allow-modals',
  // The sandboxed page has an opaque origin, so reading sibling files (dc-import, fetch) is cross-origin. Access is the token in the URL path, never cookies.
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-cache',
} as const
