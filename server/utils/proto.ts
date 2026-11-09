/**
 * Click-dummy runtime, injected into every board next to the comment bridge. It executes the data-hub-* attributes described
 * in shared/protoFlow.ts: navigation between boards (with a transition the viewer plays), component states (a list of
 * tokens in data-hub-state, shown and hidden with data-hub-show / data-hub-hide), overlays (dialog, drawers, sheet, popover,
 * or another board in a frame), triggers for clicks, holds (hover, press, focus), control changes, and conditions on actions.
 *
 * It is inert while the owner edits (hub:edit-mode) or comments (hub:comment-mode), and timers (data-hub-after) only run
 * while the viewer says the board is being played (hub:proto-play): in focus/present mode, or on a page that is not a canvas.
 * Grammar parsing is mirrored in shared/protoFlow.ts (the server-side reader); keep the two in step.
 *
 *   frame -> host  hub:navigate {href, transition} | hub:back
 *   host -> frame  hub:proto-play {enabled} | hub:history-back
 *   overlay frame -> its page  hub:overlay-close | hub:overlay-go {href, transition}
 */
export const PROTO = String.raw`<script data-hub-proto>(function(){
  var editOn = false, commentOn = false, playing = false, timers = [], stack = [];
  var initial = new WeakMap();
  var inOverlay = window.name === 'hub-overlay';
  var inHost = false; try { inHost = window.parent && window.parent !== window; } catch (_) {}
  var TR = { none: 1, fade: 1, 'slide-left': 1, 'slide-right': 1, 'slide-up': 1, 'slide-down': 1 };
  var PRESET = 'html:not([data-hub-editing]) ';
  function post(m){ try { window.parent.postMessage(m, '*'); } catch (_) {} }

  // Defaults sit in :where() so a class of the page's own always wins over them.
  var css = document.createElement('style');
  css.setAttribute('data-hub-overlay', '');
  css.textContent =
    PRESET + '[data-hub-off]{display:none!important}' +
    PRESET + '[data-hub-modal]:not([data-hub-open]){display:none!important}' +
    ':where(' + PRESET + '[data-hub-modal]:not([data-hub-modal=free]):not([data-hub-modal^=drawer]):not([data-hub-modal=sheet]):not([data-hub-modal=popover])[data-hub-open]){position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)}' +
    ':where(' + PRESET + '[data-hub-modal^=drawer][data-hub-open],' + PRESET + '[data-hub-modal=sheet][data-hub-open],' + PRESET + '[data-hub-modal=popover][data-hub-open]){position:fixed;z-index:2147482000;background:#fff;box-sizing:border-box;overflow:auto;max-width:100vw}' +
    ':where(' + PRESET + '[data-hub-modal^=drawer][data-hub-open],' + PRESET + '[data-hub-modal=sheet][data-hub-open]){box-shadow:0 0 0 100vmax rgba(0,0,0,.45);animation:.26s cubic-bezier(.2,.7,.2,1) hubin-b}' +
    ':where(' + PRESET + '[data-hub-modal=drawer-right][data-hub-open]){top:0;right:0;bottom:0;width:min(360px,90vw);animation-name:hubin-r}' +
    ':where(' + PRESET + '[data-hub-modal=drawer-left][data-hub-open]){top:0;left:0;bottom:0;width:min(360px,90vw);animation-name:hubin-l}' +
    ':where(' + PRESET + '[data-hub-modal=sheet][data-hub-open]){left:0;right:0;bottom:0;max-height:85vh;border-radius:16px 16px 0 0}' +
    ':where(' + PRESET + '[data-hub-modal=popover][data-hub-open]){min-width:160px;max-height:60vh;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.2),0 0 0 1px rgba(0,0,0,.06);animation:.14s ease-out hubin-p}' +
    '@keyframes hubin-r{from{transform:translateX(100%)}}@keyframes hubin-l{from{transform:translateX(-100%)}}@keyframes hubin-b{from{transform:translateY(100%)}}@keyframes hubin-p{from{opacity:0;transform:translateY(-4px)}}' +
    '@media (prefers-reduced-motion:reduce){[data-hub-open]{animation:none!important}}' +
    PRESET + '[data-hub-click],' + PRESET + '[data-hub-hover],' + PRESET + '[data-hub-press]{cursor:pointer}' +
    '@keyframes hubflash{0%{outline-color:rgba(59,130,246,0);box-shadow:0 0 0 0 rgba(59,130,246,.5)}30%{outline-color:#3b82f6;box-shadow:0 0 0 6px rgba(59,130,246,.25)}100%{outline-color:rgba(59,130,246,0);box-shadow:0 0 0 0 rgba(59,130,246,0)}}' +
    '[data-hub-flash]{outline:2px solid #3b82f6;outline-offset:2px;animation:hubflash .8s ease-out}';
  (document.head || document.documentElement).appendChild(css);

  // ---- grammar ---------------------------------------------------------------------------------
  function parse(v){
    var out = [];
    String(v || '').split(';').forEach(function(part){
      var s = part.trim(); if (!s) return;
      var c = /^([\s\S]*?)\s+(if|unless)\s+(\S[\s\S]*)$/.exec(s), when = null;
      if (c) { s = c[1].trim(); when = { negate: c[2] === 'unless', tests: c[3].trim() }; }
      var i = s.indexOf(':'), verb = (i < 0 ? s : s.slice(0, i)).trim(), rest = i < 0 ? '' : s.slice(i + 1).trim(), a = null;
      if (verb === 'back' || verb === 'close') a = { verb: verb };
      else if (verb === 'go' && rest) { var p = rest.split('|'); a = { verb: 'go', target: p[0].trim(), tr: TR[(p[1] || '').trim()] ? p[1].trim() : 'fade' }; }
      else if (verb === 'open' && rest) a = { verb: 'open', target: rest };
      else if ((verb === 'state' || verb === 'toggle') && rest.indexOf('=') >= 0) { var e = rest.indexOf('='); a = { verb: verb, target: rest.slice(0, e).trim(), value: rest.slice(e + 1).trim() }; }
      if (a) { if (when) a.when = when; out.push(a); }
    });
    return out;
  }

  // ---- component states: a list of tokens; a plain token is the main state, "facet:value" tokens are independent ----------
  function comp(target, from){
    if (!target || target === 'self') return from && from.closest ? from.closest('[data-hub-component]') : null;
    if (target.charAt(0) === '#') return document.getElementById(target.slice(1));
    var all = document.querySelectorAll('[data-hub-component]');
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-hub-component') === target) return all[i];
    return null;
  }
  function tokens(v){ return String(v || '').split(/[\s,]+/).filter(Boolean); }
  function stateOf(el){ return el.getAttribute('data-hub-state') || ''; }
  function tokenOf(str, facet){
    var t = tokens(str);
    for (var i = 0; i < t.length; i++) { var c = t[i].indexOf(':'); if (facet ? t[i].slice(0, c) === facet && c > 0 : c < 0) return facet ? t[i].slice(c + 1) : t[i]; }
    return '';
  }
  function withToken(str, facet, v){
    var t = tokens(str).filter(function(x){ var c = x.indexOf(':'); return facet ? !(c > 0 && x.slice(0, c) === facet) : c >= 0; });
    if (v !== '') t.push(facet ? facet + ':' + v : v);
    return t.join(' ');
  }
  /** "Menu.tab" is the component Menu, facet tab. */
  function splitTarget(t){ var i = t.lastIndexOf('.'); return i >= 0 && i < t.length - 1 ? { name: t.slice(0, i), facet: t.slice(i + 1) } : { name: t, facet: '' }; }
  function apply(){
    var els = document.querySelectorAll('[data-hub-show],[data-hub-hide]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], c = el.closest('[data-hub-component]'), have = c ? tokens(stateOf(c)) : [], off = false;
      function any(list){ return tokens(list).some(function(x){ return have.indexOf(x) >= 0; }); }
      if (!editOn) {
        if (el.hasAttribute('data-hub-show') && !any(el.getAttribute('data-hub-show'))) off = true;
        if (el.hasAttribute('data-hub-hide') && any(el.getAttribute('data-hub-hide'))) off = true;
      }
      if (off) el.setAttribute('data-hub-off', ''); else el.removeAttribute('data-hub-off');
    }
  }
  function rawState(el, v){
    if (!initial.has(el)) initial.set(el, stateOf(el));
    if (stateOf(el) === v) return;
    el.setAttribute('data-hub-state', v); apply();
  }
  function resetStates(){
    document.querySelectorAll('[data-hub-component]').forEach(function(el){ if (initial.has(el)) el.setAttribute('data-hub-state', initial.get(el)); });
    apply();
  }

  // ---- values and conditions --------------------------------------------------------------------------
  var CTL = /^(INPUT|SELECT|TEXTAREA)$/;
  function valueOf(el){
    if (!el) return '';
    if (el.tagName === 'INPUT' && el.type === 'checkbox') return el.checked ? 'on' : 'off';
    if (el.tagName === 'INPUT' && el.type === 'radio') return el.checked ? el.value : '';
    return CTL.test(el.tagName) ? el.value : '';
  }
  function controlsOf(x){
    if (Array.isArray(x)) return x;
    if (CTL.test(x.tagName)) return [x];
    return [].slice.call(x.querySelectorAll('input,select,textarea'));
  }
  function filledOf(c){ return c.type === 'checkbox' || c.type === 'radio' ? c.checked : String(c.value || '').trim() !== ''; }
  function resolveCtl(t, ctx){
    if (!t || t === 'self') return ctx.target || ctx.from;
    if (t.charAt(0) === '#') return document.getElementById(t.slice(1));
    if (t.charAt(0) === '@') { var g = [].slice.call(document.getElementsByName(t.slice(1))); return g.length ? g : null; }
    return comp(t, ctx.from);
  }
  function test(x, t){
    if (!x) return false;
    var cs = controlsOf(x), state = !Array.isArray(x) && !CTL.test(x.tagName) && x.hasAttribute && x.hasAttribute('data-hub-component');
    var group = Array.isArray(x) && !!x[0] && (x[0].type === 'checkbox' || x[0].type === 'radio'); // one choice among several: any one counts
    if (t.charAt(0) === '=' || t.slice(0, 2) === '!=') {
      var neg = t.charAt(0) === '!', want = t.slice(neg ? 2 : 1).trim(), have;
      if (state) have = tokens(stateOf(x)).indexOf(want) >= 0;
      else { var v = Array.isArray(x) ? (cs.filter(function(c){ return c.checked; })[0] || { value: '' }).value : valueOf(x); have = v === want; }
      return neg ? !have : have;
    }
    if (t === 'filled') return cs.length > 0 && (group ? cs.some(filledOf) : cs.every(filledOf));
    if (t === 'empty') return !test(x, 'filled');
    if (t === 'checked') return cs.length > 0 && (group ? cs.some(function(c){ return c.checked; }) : cs.every(function(c){ return c.checked; }));
    if (t === 'unchecked') return !test(x, 'checked');
    if (t === 'valid') return cs.every(function(c){ return c.checkValidity(); });
    if (t === 'invalid') return !test(x, 'valid');
    return false;
  }
  function holds(w, ctx){
    var ok = w.tests.split('&').every(function(part){
      var s = part.trim(), i = s.indexOf(':'), target = i < 0 ? 'self' : s.slice(0, i).trim(), t = i < 0 ? s : s.slice(i + 1).trim();
      return test(resolveCtl(target, ctx), t);
    });
    return w.negate ? !ok : ok;
  }

  // ---- overlays ----------------------------------------------------------------------------------
  function modalKind(el){ var m = el.getAttribute('data-hub-modal') || 'dialog'; return m === 'free' || m === 'sheet' || m === 'popover' || m.indexOf('drawer') === 0 ? m : 'dialog'; }
  /** "outside" / "escape" as set by data-hub-dismiss; drawers, sheets and popovers close on both unless told otherwise. */
  function dismiss(el, what){
    if (el.hasAttribute('data-hub-dismiss')) { var v = el.getAttribute('data-hub-dismiss').trim(); if (v === 'none') return false; return v === '' || tokens(v).indexOf(what) >= 0; }
    if (!el.hasAttribute('data-hub-modal')) return false;
    var k = modalKind(el); return k !== 'free' && k !== 'dialog';
  }
  function place(el, anchor){
    if (!anchor || !anchor.getBoundingClientRect) return;
    var r = anchor.getBoundingClientRect(), b = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.min(Math.max(8, r.left), Math.max(8, vw - b.width - 8));
    var top = r.bottom + 6; if (top + b.height > vh - 8 && r.top - b.height - 6 >= 8) top = r.top - b.height - 6;
    el.style.left = Math.round(left) + 'px'; el.style.top = Math.round(Math.max(8, top)) + 'px';
  }
  function openOverlay(target, from){
    if (target.charAt(0) === '#') {
      var el = document.getElementById(target.slice(1)); if (!el) return;
      if (el.hasAttribute('data-hub-open')) { if (modalKind(el) === 'popover') closeEl(el); return; }
      el.setAttribute('data-hub-open', '');
      var anchor = from && from !== el && !el.contains(from) ? from : null;
      if (modalKind(el) === 'popover') place(el, anchor);
      stack.push({ el: el, anchor: anchor }); return;
    }
    var f = document.createElement('iframe');
    f.name = 'hub-overlay'; f.setAttribute('data-hub-overlay', ''); f.setAttribute('aria-label', 'Overlay');
    f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;z-index:' + (2147482500 + stack.length) + ';color-scheme:normal';
    try { f.src = new URL(target, document.baseURI).href; } catch (_) { return; }
    document.body.appendChild(f); stack.push({ frame: f });
  }
  function closeEntry(t){
    if (t.el) { t.el.removeAttribute('data-hub-open'); if (modalKind(t.el) === 'popover') { t.el.style.left = ''; t.el.style.top = ''; } }
    else if (t.frame) t.frame.remove();
  }
  function closeEl(el){
    var at = stack.map(function(s){ return s.el; }).indexOf(el);
    closeEntry(at >= 0 ? stack.splice(at, 1)[0] : { el: el });
  }
  function closeTop(){
    var t = stack.pop();
    if (!t) { if (inOverlay) post({ type: 'hub:overlay-close' }); return; }
    closeEntry(t);
  }
  function closeAll(){ while (stack.length) closeEntry(stack.pop()); }
  /** A press or key outside closes the topmost overlay that asks for it, and resets components (a dropdown) that ask for it. */
  function dismissAt(t, what){
    var acted = false, top = stack[stack.length - 1];
    if (top && top.el && dismiss(top.el, what) && !(what === 'outside' && (top.el.contains(t) || (top.anchor && top.anchor.contains(t))))) { closeTop(); acted = true; }
    document.querySelectorAll('[data-hub-component][data-hub-dismiss]').forEach(function(c){
      if (!dismiss(c, what) || !initial.has(c) || stateOf(c) === initial.get(c)) return;
      if (what === 'outside' && c.contains(t)) return;
      rawState(c, initial.get(c)); acted = true;
    });
    return acted;
  }

  // ---- actions -----------------------------------------------------------------------------------
  function goTo(href, tr){
    if (inOverlay) { post({ type: 'hub:overlay-go', href: href, transition: tr }); return; }
    closeAll();
    post({ type: 'hub:navigate', href: href, transition: tr });
  }
  function sub(s, ctx){ return String(s).replace(/\{value\}/g, function(){ return ctx.value; }); }
  /** Applies one state/toggle action; returns [element, facet, previous token] for holds to revert. */
  function setStateAction(a, ctx){
    var t = splitTarget(sub(a.target, ctx)), c = comp(t.name, ctx.from); if (!c) return null;
    if (!initial.has(c)) initial.set(c, stateOf(c));
    var prev = stateOf(c), before = tokenOf(prev, t.facet), v = sub(a.value, ctx);
    if (a.verb === 'toggle' && before === v) v = tokenOf(initial.get(c), t.facet);
    rawState(c, withToken(prev, t.facet, v));
    return [c, t.facet, before];
  }
  function run(actions, ctx){
    var undo = [];
    actions.forEach(function(a){
      if (a.when && !holds(a.when, ctx)) return;
      if (a.verb === 'go') { try { goTo(new URL(sub(a.target, ctx), document.baseURI).href, a.tr); } catch (_) {} }
      else if (a.verb === 'back') { if (inOverlay) post({ type: 'hub:overlay-close' }); else if (stack.length) closeTop(); else post({ type: 'hub:back' }); }
      else if (a.verb === 'open') openOverlay(sub(a.target, ctx), ctx.from);
      else if (a.verb === 'close') closeTop();
      else { var u = setStateAction(a, ctx); if (u) undo.push(u); }
    });
    return undo;
  }
  function live(){ return !editOn && !commentOn; }
  function ctxFor(from, target){
    var ctl = target && CTL.test(target.tagName) ? target : (from && CTL.test(from.tagName) ? from : null);
    return { from: from, target: ctl || target || from, value: valueOf(ctl) };
  }
  function fire(attr, ev){
    var t = ev.target; if (!t || !t.closest) return null;
    var h = t.closest('[' + attr + ']'); if (!h) return null;
    var acts = parse(h.getAttribute(attr));
    if (acts.length) run(acts, ctxFor(h, t));
    return h;
  }

  document.addEventListener('click', function(ev){
    if (!live() || ev.button !== 0) return;
    var t = ev.target; if (!t || !t.closest) return;
    dismissAt(t, 'outside');
    var m = t.closest('[data-hub-modal][data-hub-open]');
    if (m && t === m && modalKind(m) === 'dialog' && !(m.hasAttribute('data-hub-dismiss') && !dismiss(m, 'outside'))) { ev.preventDefault(); closeEl(m); return; }
    var h = t.closest('[data-hub-click]');
    if (h) {
      var acts = parse(h.getAttribute('data-hub-click'));
      if (acts.length) { ev.preventDefault(); run(acts, ctxFor(h, t)); }
      return;
    }
    if (playing && !t.closest('a[href],button,input,select,textarea,label,[data-nav],[data-hub-hover],[data-hub-press]')) {
      document.querySelectorAll('[data-hub-click],[data-hub-hover],[data-hub-press],[data-nav]').forEach(function(e){
        e.setAttribute('data-hub-flash', ''); setTimeout(function(){ e.removeAttribute('data-hub-flash'); }, 850);
      });
    }
  }, true);

  // Holds (hover, press, focus): the actions apply while it lasts; state changes revert afterwards.
  var held = {};
  function hold(attr, h, ctx){
    release(attr);
    var undo = run(parse(h.getAttribute(attr)), ctx);
    held[attr] = { el: h, undo: undo };
  }
  function release(attr){
    var x = held[attr]; if (!x) return;
    delete held[attr];
    x.undo.reverse().forEach(function(u){ rawState(u[0], withToken(stateOf(u[0]), u[1], u[2])); }); // only the token the hold changed goes back
  }
  document.addEventListener('mouseover', function(ev){
    if (!live()) return;
    var h = ev.target && ev.target.closest ? ev.target.closest('[data-hub-hover]') : null;
    if (!h || (held['data-hub-hover'] && held['data-hub-hover'].el === h)) return;
    hold('data-hub-hover', h, ctxFor(h, ev.target));
  }, true);
  document.addEventListener('mouseout', function(ev){
    var x = held['data-hub-hover']; if (!x) return;
    if (!ev.relatedTarget || !x.el.contains(ev.relatedTarget)) release('data-hub-hover');
  }, true);
  document.addEventListener('pointerdown', function(ev){
    if (!live() || ev.button > 0) return;
    var h = ev.target && ev.target.closest ? ev.target.closest('[data-hub-press]') : null;
    if (h) hold('data-hub-press', h, ctxFor(h, ev.target));
  }, true);
  ['pointerup', 'pointercancel', 'dragstart'].forEach(function(n){ document.addEventListener(n, function(){ release('data-hub-press'); }, true); });
  window.addEventListener('blur', function(){ release('data-hub-press'); release('data-hub-hover'); });
  document.addEventListener('focusin', function(ev){
    if (!live()) return;
    var h = ev.target && ev.target.closest ? ev.target.closest('[data-hub-focus]') : null;
    if (h && !(held['data-hub-focus'] && held['data-hub-focus'].el === h)) hold('data-hub-focus', h, ctxFor(h, ev.target));
  }, true);
  document.addEventListener('focusout', function(ev){
    var x = held['data-hub-focus'];
    if (x && (!ev.relatedTarget || !x.el.contains(ev.relatedTarget))) release('data-hub-focus');
    if (!live()) return;
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-hub-blur]') : null;
    if (b && (!ev.relatedTarget || !b.contains(ev.relatedTarget))) run(parse(b.getAttribute('data-hub-blur')), ctxFor(b, ev.target));
  }, true);

  // Control changes: a select, radio, checkbox or text field drives states and navigation; {value} is what it holds.
  document.addEventListener('change', function(ev){ if (live()) fire('data-hub-change', ev); }, true);
  document.addEventListener('input', function(ev){ if (live()) fire('data-hub-input', ev); }, true);

  document.addEventListener('keydown', function(ev){
    if (ev.key !== 'Escape' || !live()) return;
    if (dismissAt(ev.target, 'escape')) return;
    var top = stack[stack.length - 1];
    if (top) { if (!top.el || !top.el.hasAttribute('data-hub-dismiss') || dismiss(top.el, 'escape')) closeTop(); }
    else if (inOverlay) { ev.preventDefault(); post({ type: 'hub:overlay-close' }); }
  }, true);

  // ---- timers -------------------------------------------------------------------------------------
  function stopTimers(){ timers.forEach(clearTimeout); timers = []; }
  function startTimers(){
    stopTimers();
    if (!playing || !live()) return;
    document.querySelectorAll('[data-hub-after]').forEach(function(el){
      var m = /^\s*(\d{1,6})\s+(.+)$/.exec(el.getAttribute('data-hub-after') || ''); if (!m) return;
      var acts = parse(m[2]);
      if (acts.length) timers.push(setTimeout(function(){ if (live() && playing) run(acts, ctxFor(el, el)); }, Number(m[1])));
    });
  }

  // ---- host messages --------------------------------------------------------------------------------
  window.addEventListener('message', function(ev){
    var d = ev.data; if (!d || typeof d.type !== 'string') return;
    if (ev.source === window.parent) {
      if (d.type === 'hub:comment-mode') { commentOn = !!d.enabled; startTimers(); }
      else if (d.type === 'hub:edit-mode') {
        editOn = !!d.enabled; document.documentElement.toggleAttribute('data-hub-editing', editOn);
        if (editOn) { stopTimers(); closeAll(); } apply();
      }
      else if (d.type === 'hub:proto-play') { playing = !!d.enabled; if (playing) { closeAll(); resetStates(); } startTimers(); }
      else if (d.type === 'hub:history-back') { try { history.back(); } catch (_) {} }
      return;
    }
    // From an overlay frame this page opened.
    var mine = stack.filter(function(s){ return s.frame && s.frame.contentWindow === ev.source; })[0];
    if (!mine) return;
    if (d.type === 'hub:overlay-close') { stack.splice(stack.indexOf(mine), 1); mine.frame.remove(); }
    else if (d.type === 'hub:overlay-go' && typeof d.href === 'string') goTo(d.href, TR[d.transition] ? d.transition : 'fade');
  });

  function boot(){ apply(); if (!inHost) { playing = true; startTimers(); } }
  window.addEventListener('load', boot);
  if (document.readyState !== 'loading') apply();
  // Boards rendered later by a script (Design Component boards) get their states applied as they appear.
  try { var tm = null; new MutationObserver(function(){ clearTimeout(tm); tm = setTimeout(apply, 30); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (_) {}
})();</script>`
