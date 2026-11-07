/*
 * Artifact Hub: Design Component (.dc.html) runtime.
 *
 * An independent implementation of the documented .dc.html authoring format (templates in <x-dc> with
 * {{holes}}, <sc-for>, <sc-if>, <dc-import>, <helmet>, `class Component extends DCLogic`). It is served as
 * `support.js` after React 18 (MIT) and ReactDOM, which it needs as globals. No code from any other runtime.
 *
 * Supported: dotted-path holes and literals, interpolated attributes, camelCase events, state/setState and the
 * React class lifecycle, sc-for ($index), sc-if, dc-import (fetches Name.dc.html next to the page), helmet,
 * data-props, links between boards (plain relative hrefs; the host serves every board).
 * Not supported: the editor (properties panel, tweaks UI), print/PDF flow, design-system mounting (x-import).
 */
(function () {
  'use strict'
  var React = window.React, ReactDOM = window.ReactDOM
  if (!React || !ReactDOM) { console.error('dc-runtime: React/ReactDOM missing'); return }
  var h = React.createElement
  var Fragment = React.Fragment

  // Hide the raw template until the first render so people never see {{holes}}.
  var hide = document.createElement('style')
  hide.textContent = 'x-dc{display:contents}x-dc:not([data-dc-ready]){visibility:hidden}'
  ;(document.head || document.documentElement).appendChild(hide)

  // ---- holes ---------------------------------------------------------------------------------
  var HOLE_G = /\{\{\s*([^{}]*?)\s*\}\}/g
  var HOLE_ONE = /^\s*\{\{\s*([^{}]*?)\s*\}\}\s*$/

  function lookup(path, scope) {
    if (path === 'true') return true
    if (path === 'false') return false
    if (path === 'null') return null
    if (path === 'undefined') return undefined
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path)
    var q = path.match(/^(['"])(.*)\1$/)
    if (q) return q[2]
    var parts = path.split('.')
    var v = scope[parts[0]]
    for (var i = 1; i < parts.length && v != null; i++) v = v[parts[i]]
    return v
  }

  function str(v) { return v == null || v === false || v === true ? '' : String(v) }

  /** Compile a string with holes to scope => value (raw for a single whole-value hole, else a string). */
  function compileValue(s) {
    var one = s.match(HOLE_ONE)
    if (one) { var p = one[1]; return function (scope) { return lookup(p, scope) } }
    if (s.indexOf('{{') < 0) return function () { return s }
    return function (scope) { return s.replace(HOLE_G, function (_, p) { return str(lookup(p, scope)) }) }
  }

  // ---- attributes ----------------------------------------------------------------------------
  var EVENTS = {}
  ;('click dblclick change input submit keydown keyup keypress focus blur mouseenter mouseleave mouseover mouseout mousedown mouseup mousemove ' +
    'pointerdown pointerup pointermove pointerenter pointerleave touchstart touchend touchmove scroll wheel contextmenu drag dragstart dragend dragover drop select copy cut paste')
    .split(' ').forEach(function (e) {
      var react = e === 'dblclick' ? 'DoubleClick' : e.replace(/(^|[a-z])(down|up|move|enter|leave|over|out|start|end|menu|click)$/, function (m, a, b) { return a + b.charAt(0).toUpperCase() + b.slice(1) })
      EVENTS['on' + e] = 'on' + react.charAt(0).toUpperCase() + react.slice(1)
    })
  EVENTS.onclick = 'onClick'; EVENTS.onkeydown = 'onKeyDown'; EVENTS.onkeyup = 'onKeyUp'; EVENTS.onkeypress = 'onKeyPress'
  EVENTS.onmouseenter = 'onMouseEnter'; EVENTS.onmouseleave = 'onMouseLeave'; EVENTS.onmouseover = 'onMouseOver'; EVENTS.onmouseout = 'onMouseOut'
  EVENTS.onmousedown = 'onMouseDown'; EVENTS.onmouseup = 'onMouseUp'; EVENTS.onmousemove = 'onMouseMove'; EVENTS.oncontextmenu = 'onContextMenu'
  EVENTS.onpointerdown = 'onPointerDown'; EVENTS.onpointerup = 'onPointerUp'; EVENTS.onpointermove = 'onPointerMove'
  EVENTS.onpointerenter = 'onPointerEnter'; EVENTS.onpointerleave = 'onPointerLeave'
  EVENTS.ontouchstart = 'onTouchStart'; EVENTS.ontouchend = 'onTouchEnd'; EVENTS.ontouchmove = 'onTouchMove'
  EVENTS.ondragstart = 'onDragStart'; EVENTS.ondragend = 'onDragEnd'; EVENTS.ondragover = 'onDragOver'

  var RENAME = {
    class: 'className', for: 'htmlFor', tabindex: 'tabIndex', colspan: 'colSpan', rowspan: 'rowSpan', maxlength: 'maxLength', minlength: 'minLength',
    readonly: 'readOnly', autofocus: 'autoFocus', autocomplete: 'autoComplete', autocapitalize: 'autoCapitalize', spellcheck: 'spellCheck',
    contenteditable: 'contentEditable', crossorigin: 'crossOrigin', srcset: 'srcSet', novalidate: 'noValidate', cellpadding: 'cellPadding',
    cellspacing: 'cellSpacing', datetime: 'dateTime', enctype: 'encType', formaction: 'formAction', inputmode: 'inputMode', usemap: 'useMap',
    frameborder: 'frameBorder', allowfullscreen: 'allowFullScreen', playsinline: 'playsInline', accesskey: 'accessKey', viewbox: 'viewBox',
    'accept-charset': 'acceptCharset', 'http-equiv': 'httpEquiv', 'xlink:href': 'xlinkHref', 'xml:space': 'xmlSpace',
  }
  var BOOLEAN = { disabled: 1, hidden: 1, readonly: 1, required: 1, autofocus: 1, multiple: 1, open: 1, selected: 1, autoplay: 1, controls: 1, loop: 1, muted: 1, novalidate: 1, checked: 1, allowfullscreen: 1, playsinline: 1 }

  function camel(name) { return name.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase() }) }

  function splitDeclarations(css) {
    var out = [], depth = 0, quote = '', cur = ''
    for (var i = 0; i < css.length; i++) {
      var c = css[i]
      if (quote) { cur += c; if (c === quote && css[i - 1] !== '\\') quote = ''; continue }
      if (c === '"' || c === "'") { quote = c; cur += c; continue }
      if (c === '(') depth++
      if (c === ')') depth--
      if (c === ';' && depth === 0) { out.push(cur); cur = ''; continue }
      cur += c
    }
    if (cur.trim()) out.push(cur)
    return out
  }

  function styleObject(css) {
    var o = {}
    splitDeclarations(css).forEach(function (d) {
      var i = d.indexOf(':')
      if (i < 0) return
      var prop = d.slice(0, i).trim(), val = d.slice(i + 1).trim()
      if (!prop || !val) return
      if (prop.indexOf('--') === 0) o[prop] = val
      else if (/^-ms-/.test(prop)) o[camel(prop.slice(1))] = val
      else o[camel(prop.replace(/^-/, function () { return /^-(webkit|moz|o)-/.test(prop) ? '' : '-' }).replace(/^(webkit|moz|o)-/, function (m) { return m.charAt(0).toUpperCase() + m.slice(1) }))] = val
    })
    return o
  }

  function compileAttrs(el) {
    var tag = el.localName
    var hasChange = el.hasAttribute('onchange') || el.hasAttribute('oninput')
    var items = []
    Array.prototype.forEach.call(el.attributes, function (a) {
      var name = a.name, raw = a.value
      if (name.indexOf('hint-') === 0) return
      var val = compileValue(raw)
      if (name === 'style') {
        items.push(function (props, scope) {
          var v = val(scope)
          if (v && typeof v === 'object') props.style = v
          else if (v) props.style = styleObject(str(v))
        })
      } else if (EVENTS[name]) {
        items.push(function (props, scope) { var f = val(scope); if (typeof f === 'function') props[EVENTS[name]] = f })
      } else if (name === 'ref') {
        items.push(function (props, scope) { var r = val(scope); if (r && typeof r === 'object') props.ref = r })
      } else if (BOOLEAN[name]) {
        var key = RENAME[name] || name
        if ((name === 'checked') && !hasChange) key = 'defaultChecked'
        items.push(function (props, scope) { var v = val(scope); props[key] = raw.indexOf('{{') < 0 ? (v !== 'false') : !!v })
      } else if (name === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
        var vk = hasChange ? 'value' : 'defaultValue'
        items.push(function (props, scope) { var v = val(scope); if (v != null) props[vk] = v })
      } else {
        var out = RENAME[name] || (name.indexOf('data-') === 0 || name.indexOf('aria-') === 0 ? name : camel(name))
        items.push(function (props, scope) { var v = val(scope); if (v != null && v !== false) props[out] = v })
      }
    })
    return function (scope) { var props = {}; for (var i = 0; i < items.length; i++) items[i](props, scope); return props }
  }

  // ---- template compilation ------------------------------------------------------------------
  var TABLE_PARENTS = { table: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1, colgroup: 1, select: 1, optgroup: 1 }

  function compileChildren(parent) {
    var fns = []
    Array.prototype.forEach.call(parent.childNodes, function (n) { var f = compileNode(n); if (f) fns.push(f) })
    return function (scope) { return fns.map(function (f, i) { return f(scope, i) }) }
  }

  function compileNode(node) {
    if (node.nodeType === 3) {
      var text = node.nodeValue
      if (!/\S/.test(text) && node.parentNode && TABLE_PARENTS[node.parentNode.localName]) return null
      var one = text.match(HOLE_ONE)
      if (one) { var p = one[1]; return function (scope) { var v = lookup(p, scope); return typeof v === 'object' && v !== null ? v : str(v) } }
      if (text.indexOf('{{') < 0) return function () { return text }
      var tv = compileValue(text)
      return function (scope) { return tv(scope) }
    }
    if (node.nodeType !== 1) return null
    var tag = node.localName
    if (tag === 'helmet') return null

    if (tag === 'sc-if') {
      var cond = compileValue(node.getAttribute('value') || 'false')
      var kids = compileChildren(node)
      return function (scope, i) { return cond(scope) ? h.apply(null, [Fragment, { key: i }].concat(kids(scope))) : null }
    }
    if (tag === 'sc-for') {
      var list = compileValue(node.getAttribute('list') || '')
      var as = node.getAttribute('as') || 'item'
      var body = compileChildren(node)
      return function (scope, i) {
        var arr = list(scope)
        if (!Array.isArray(arr)) arr = arr && typeof arr === 'object' ? Object.keys(arr).map(function (k) { return arr[k] }) : []
        return h(Fragment, { key: i }, arr.map(function (item, idx) {
          var inner = Object.assign({}, scope); inner[as] = item; inner.$index = idx; inner.$first = idx === 0; inner.$last = idx === arr.length - 1
          return h.apply(null, [Fragment, { key: idx }].concat(body(inner)))
        }))
      }
    }
    if (tag === 'dc-import') {
      var name = node.getAttribute('name') || ''
      var pf = []
      Array.prototype.forEach.call(node.attributes, function (a) {
        if (a.name === 'name' || a.name.indexOf('hint-') === 0) return
        var f = compileValue(a.value); var pn = camel(a.name)
        pf.push(function (props, scope) { props[pn] = f(scope) })
      })
      var hint = (node.getAttribute('hint-size') || '').split(',')
      return function (scope, i) {
        var props = {}; pf.forEach(function (f) { f(props, scope) })
        return h(DCImport, { key: i, name: name, childProps: props, hintW: hint[0], hintH: hint[1] })
      }
    }

    var attrs = compileAttrs(node)
    var children = compileChildren(node)
    var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 }
    return function (scope, i) {
      var props = attrs(scope)
      if (props.key === undefined) props.key = i
      return VOID[tag] ? h(tag, props) : h.apply(null, [tag, props].concat(children(scope)))
    }
  }

  // ---- components ----------------------------------------------------------------------------
  function DCLogic(props, context) { React.Component.call(this, props, context); this.state = {} }
  DCLogic.prototype = Object.create(React.Component.prototype)
  DCLogic.prototype.constructor = DCLogic
  DCLogic.prototype.renderVals = function () { return {} }
  DCLogic.prototype.render = function () {
    var tpl = this.constructor.__dcTemplate
    if (!tpl) return null
    var vals = this.renderVals() || {}
    return h.apply(null, [Fragment, null].concat(tpl(Object.assign({}, vals))))
  }
  window.DCLogic = DCLogic

  var seenHelmet = {}
  function applyHelmet(helmet) {
    if (!helmet) return
    Array.prototype.forEach.call(helmet.children, function (el) {
      var key = el.outerHTML
      if (seenHelmet[key]) return
      seenHelmet[key] = 1
      var copy = document.createElement(el.localName)
      Array.prototype.forEach.call(el.attributes, function (a) { copy.setAttribute(a.name, a.value) })
      copy.textContent = el.textContent
      document.head.appendChild(copy)
    })
  }

  /** Turn a parsed document into a component class. */
  function componentFromDocument(doc, evalDoc) {
    var xdc = doc.querySelector('x-dc')
    var script = doc.querySelector('script[type="text/x-dc"][data-dc-script]')
    if (!xdc || !script) throw new Error('not a .dc.html document (missing <x-dc> or the data-dc-script block)')
    applyHelmet(xdc.querySelector('helmet'))
    var template = compileChildren(xdc)
    var Cls = new Function('DCLogic', 'React', 'ReactDOM', script.textContent + '\n;return typeof Component !== "undefined" ? Component : null')(DCLogic, React, ReactDOM)
    if (typeof Cls !== 'function') throw new Error('the script block must define `class Component extends DCLogic`')
    Cls.__dcTemplate = template
    try { Cls.__dcProps = JSON.parse(script.getAttribute('data-props') || '{}') } catch (e) { Cls.__dcProps = {} }
    return Cls
  }

  var importCache = {}
  function loadComponent(name) {
    var url = new URL(name + '.dc.html', document.baseURI).href
    if (!importCache[url]) {
      importCache[url] = fetch(url).then(function (r) {
        if (!r.ok) throw new Error('dc-import "' + name + '": ' + r.status)
        return r.text()
      }).then(function (html) {
        return componentFromDocument(new DOMParser().parseFromString(html, 'text/html'))
      })
    }
    return importCache[url]
  }

  function DCImport(p) {
    var st = React.useState(null), Comp = st[0], setComp = st[1]
    var er = React.useState(null), err = er[0], setErr = er[1]
    React.useEffect(function () {
      var live = true
      loadComponent(p.name).then(function (C) { if (live) setComp(function () { return C }) }, function (e) { if (live) setErr(e) })
      return function () { live = false }
    }, [p.name])
    if (err) return h('div', { style: { color: '#b3261e', font: '12px monospace' } }, String(err.message || err))
    if (!Comp) return h('div', { style: { width: p.hintW || undefined, height: p.hintH || undefined } })
    return h(Comp, p.childProps)
  }

  // ---- boot ----------------------------------------------------------------------------------
  function showError(root, e) {
    console.error('dc-runtime:', e)
    var pre = document.createElement('pre')
    pre.style.cssText = 'margin:16px;padding:12px;border:1px solid #b3261e;color:#b3261e;background:#fff5f5;font:12px/1.5 monospace;white-space:pre-wrap'
    pre.textContent = 'This board could not render:\n' + (e && e.message ? e.message : e)
    root.innerHTML = ''
    root.appendChild(pre)
    root.setAttribute('data-dc-ready', '')
  }

  function boot() {
    var root = document.querySelector('x-dc')
    if (!root) return
    try {
      var Cls = componentFromDocument(document)
      root.innerHTML = ''
      var mount = ReactDOM.createRoot(root)
      // Tweak values chosen in the editor arrive as window.__dcProps (injected before this script runs) and can be
      // changed live with window.__dcSetProps(props): the root component simply re-renders with new props.
      ReactDOM.flushSync(function () { mount.render(h(Cls, window.__dcProps || {})) })
      window.__dcSetProps = function (p) { window.__dcProps = p || {}; ReactDOM.flushSync(function () { mount.render(h(Cls, window.__dcProps)) }) }
      root.setAttribute('data-dc-ready', '')
      window.__dcRoot = mount
    } catch (e) { showError(root, e) }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
