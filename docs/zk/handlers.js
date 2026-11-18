// Content-Security-Policy friendly event handlers. The dashboards were written with inline attributes such as
// onclick="showTab('alerts', this)". A strict CSP (script-src 'self', no 'unsafe-inline') must refuse inline code, because an
// injected script is the main way to steal an unlocked key. This module lets those attributes keep working WITHOUT eval:
//   1. convert(): moves on* attributes to data-on* so the browser never tries to execute them as code
//   2. install(): one delegated listener per event type that reads the data-on* text, parses it with a tiny whitelisted grammar
//      (function calls with literal arguments, this, event, event/this property reads) and calls the named global function.
// Anything outside that grammar is refused and logged - it can never run arbitrary code.
(function (root) {
  'use strict';
  const READABLE = new Set(['value', 'checked', 'key', 'id', 'textContent', 'currentTarget', 'target']), EVENTS = ['click', 'change', 'input', 'keydown'], EVENT_METHODS = new Set(['stopPropagation', 'preventDefault']);

  function tokenize(src) {
    const out = []; let i = 0; const n = src.length;
    while (i < n) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1, s = '';
        while (j < n && src[j] !== c) {
          if (src[j] === '\\') { j++; const e = src[j]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e; } else s += src[j];
          j++;
        }
        if (j >= n) throw new Error('unterminated string');
        out.push({ t: 'str', v: s }); i = j + 1; continue;
      }
      if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] || ''))) { const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i)); out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
      if (/[A-Za-z_$]/.test(c)) { const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i)); out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if ('(),[];.'.includes(c)) { out.push({ t: c }); i++; continue; }
      throw new Error('unexpected character ' + JSON.stringify(c));
    }
    return out;
  }

  // statements := call (';' call)* ';'?     call := path '(' (arg (',' arg)*)? ')'     path := id ('.' id)*
  // arg := str | num | true | false | null | undefined | '[' args ']' | ('this'|'event') ('.' id)*
  function parse(src) {
    const tk = tokenize(src); let p = 0; const peek = () => tk[p], eat = t => { const x = tk[p]; if (!x || x.t !== t) throw new Error('expected ' + t); p++; return x; };
    function path() { const parts = [eat('id').v]; while (peek() && peek().t === '.') { p++; parts.push(eat('id').v); } return parts; }
    function arg() {
      const x = peek(); if (!x) throw new Error('missing argument');
      if (x.t === 'str' || x.t === 'num') { p++; return { k: 'lit', v: x.v }; }
      if (x.t === '[') { p++; const items = []; if (peek() && peek().t !== ']') { items.push(arg()); while (peek() && peek().t === ',') { p++; items.push(arg()); } } eat(']'); return { k: 'arr', items }; }
      if (x.t === 'id') {
        if (x.v === 'true' || x.v === 'false') { p++; return { k: 'lit', v: x.v === 'true' }; }
        if (x.v === 'null') { p++; return { k: 'lit', v: null }; }
        if (x.v === 'undefined') { p++; return { k: 'lit', v: undefined }; }
        if (x.v === 'this' || x.v === 'event') { const pa = path(); return { k: 'ref', path: pa }; }
      }
      throw new Error('argument not allowed');
    }
    const calls = [];
    while (p < tk.length) {
      if (peek().t === ';') { p++; continue; }
      const fn = path(); eat('('); const args = [];
      if (peek() && peek().t !== ')') { args.push(arg()); while (peek() && peek().t === ',') { p++; args.push(arg()); } }
      eat(')'); calls.push({ fn, args });
      if (p < tk.length) eat(';');
    }
    if (!calls.length) throw new Error('empty handler');
    return calls;
  }

  const cache = new Map();
  const compiled = src => { let c = cache.get(src); if (!c) { c = parse(src); if (cache.size > 2000) cache.clear(); cache.set(src, c); } return c; };

  function evalArg(a, ctx) {
    if (a.k === 'lit') return a.v;
    if (a.k === 'arr') return a.items.map(x => evalArg(x, ctx));
    let v = a.path[0] === 'this' ? ctx.el : ctx.event;
    if (a.path.length > 2 || (a.path.length === 2 && !READABLE.has(a.path[1]))) throw new Error('property not allowed');      // one level, short list: this.value, this.checked, event.key ...
    return a.path.length === 2 ? (v === null || v === undefined ? undefined : v[a.path[1]]) : v;
  }

  // ctx: { el, event, global, allow:Set<string> }  (allow = the app's own handler functions, generated at build time)
  function exec(src, ctx) {
    for (const c of compiled(src)) {
      const args = c.args.map(a => evalArg(a, ctx));
      if (c.fn.length === 2 && (c.fn[0] === 'event' || c.fn[0] === 'this')) {                  // event.stopPropagation() / event.preventDefault()
        const target = c.fn[0] === 'event' ? ctx.event : ctx.el;
        if (c.fn[0] !== 'event' || !EVENT_METHODS.has(c.fn[1])) throw new Error('method not allowed');
        target[c.fn[1]].apply(target, args); continue;
      }
      if (c.fn.length !== 1) throw new Error('only plain function calls are allowed');
      if (!ctx.allow || !ctx.allow.has(c.fn[0])) throw new Error(c.fn[0] + ' is not an allowed handler');      // fail closed: eval, fetch, setTimeout ... are never reachable
      const f = ctx.global[c.fn[0]];
      if (typeof f !== 'function') throw new Error(c.fn[0] + ' is not a function');
      f.apply(ctx.global, args);
    }
  }

  // Walk from the event target up to the document, running data-on<type> like native inline handlers would (bubbling,
  // `this` = the element, stopPropagation honoured, currentTarget set).
  function dispatch(ev, global, allow, log) {
    const attr = 'data-on' + ev.type; let stopped = false; const orig = ev.stopPropagation;
    ev.stopPropagation = function () { stopped = true; if (orig) orig.call(ev); };
    for (let el = ev.target; el && !stopped; el = el.parentElement) {
      if (el.nodeType !== undefined && el.nodeType !== 1) continue;
      const code = el.getAttribute && el.getAttribute(attr); if (code === null || code === undefined) continue;
      try { Object.defineProperty(ev, 'currentTarget', { get: () => el, configurable: true }); } catch (e) {}
      try { exec(code, { el, event: ev, global, allow }); } catch (e) { (log || console.error)('Blocked/failed handler [' + attr + ']: ' + String(code).slice(0, 80) + ' - ' + e.message); }
    }
  }

  const SEL = EVENTS.map(e => '[on' + e + ']').join(',');
  function convert(node) {
    if (!node || node.nodeType !== 1) return;
    const list = [node].concat(Array.from(node.querySelectorAll ? node.querySelectorAll(SEL) : []));
    for (const el of list) for (const e of EVENTS) { const a = 'on' + e; if (el.hasAttribute && el.hasAttribute(a)) { el.setAttribute('data-' + a, el.getAttribute(a)); el.removeAttribute(a); } }
  }

  function install(doc, global, names) {
    global = global || root; const allow = new Set(names || root.ZK_HANDLER_NAMES || []);
    convert(doc.documentElement);
    new MutationObserver(muts => { for (const m of muts) m.addedNodes.forEach(convert); }).observe(doc.documentElement, { childList: true, subtree: true });
    for (const e of EVENTS) doc.addEventListener(e, ev => dispatch(ev, global, allow), false);
  }
  root.ZKHandlers = { parse, exec, dispatch, convert, install, EVENTS };
  if (typeof module !== 'undefined') module.exports = root.ZKHandlers;
})(typeof window !== 'undefined' ? window : globalThis);
