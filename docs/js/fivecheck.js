// ── 5-CHECK REVIEW (Strategy tab: Holding Decisions + Entry Analysis, one box per stock) ───────────────────
// The owner's own 5-check prompt (how it makes money, moat, fair price, risks, a 30% drop, bull/bear/verdict) with the stock filled in.
// CapitalLens does NOT run it: the button copies the prompt (or opens ChatGPT, Claude or Grok with it) and the answer comes from Claude's general knowledge,
// not from live data, so the box says so. Nothing is sent anywhere until the person taps one of the assistant buttons; the copy button stays in the browser.
// The wording below is the owner's text, verbatim; only the stock name and ticker change. No inline handlers (one delegated listener).
(function (root) {
  'use strict';
  const PROMPT = [
    'Help me check this stock before I buy it: {STOCK}.',
    '',
    'Do these 5 checks. Use simple words. Keep it short. One page only.',
    '',
    '1. How does this company make money? Say it in 2 lines.',
    '2. Why will people keep buying from them? What is hard for other companies to copy?',
    '3. Is the price fair? Compare the price to its growth and its profit. Tell me if it looks cheap, fair, or too high — and why.',
    '4. What can go wrong? List the 3 biggest risks.',
    '5. If the price falls 30% tomorrow, would a long-term holder still hold it? Why, or why not?',
    '',
    'Then finish with 3 short parts: Bull case (why it can win), Bear case (why it can fail), and a one-line verdict in simple words.',
    '',
    'Do not tell me to buy or sell. Only give me the facts, so I can decide.',
    'If you are not sure about a number, say you are not sure.',
  ].join('\n');
  // Each assistant's own page, opened with the prompt in the address (they fill the box from ?q=). The badge is a plain letter mark, not the company's logo.
  const AIS = [
    { key: 'chatgpt', name: 'ChatGPT', mark: 'GPT', url: 'https://chatgpt.com/?q=' },
    { key: 'claude',  name: 'Claude',  mark: 'C',   url: 'https://claude.ai/new?q=' },
    { key: 'grok',    name: 'Grok',    mark: 'G',   url: 'https://grok.com/?q=' },
  ];
  const store = new Map();                                              // box id → prompt (kept out of the HTML)
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();

  // "Name (TICKER)", or just one of them when that is all there is or they are the same
  function stockLabel(name, ticker) {
    const n = clean(name), t = clean(ticker);
    if (n && t && n.toLowerCase() !== t.toLowerCase()) return `${n} (${t})`;
    return n || t || 'this stock';
  }
  const prompt = (name, ticker) => PROMPT.replace('{STOCK}', stockLabel(name, ticker));
  const idOf = (ticker, scope) => 'fc-' + (scope ? String(scope).replace(/[^a-z0-9]/gi, '_') + '-' : '') + String(ticker == null ? '' : ticker).replace(/[^a-z0-9]/gi, '_');   // scope keeps the same stock in two lists apart

  function html(name, ticker, scope) {
    const id = idOf(ticker, scope), p = prompt(name, ticker); store.set(id, p);
    return `<div class="fc-box" data-fc-id="${esc(id)}">
      <div class="fc-head">🧪 5-check review <span class="fc-for">${esc(stockLabel(name, ticker))}</span></div>
      <div class="fc-sub">Copy the prompt, or open ChatGPT, Claude or Grok with it filled in: how it makes money, what protects it, is the price fair, 3 risks, would you still hold after a 30% fall, bull / bear case and a one-line verdict. The assistant answers from general knowledge, not live data, so check any number it gives.</div>
      <div class="fc-actions">
        <button type="button" class="fc-btn" data-fc-copy="${esc(id)}">📋 Copy prompt</button>
        ${AIS.map(a => `<a class="fc-btn fc-ai fc-${a.key}" data-fc-open="${esc(id)}" data-fc-ai="${a.key}" href="${a.url}${encodeURIComponent(p)}" target="_blank" rel="noopener noreferrer" title="Open ${a.name} with the prompt" aria-label="Open ${a.name} with the prompt"><span class="fc-mark" aria-hidden="true">${a.mark}</span>${a.name}</a>`).join('\n        ')}
      </div>
      <details class="fc-prev"><summary>Show the prompt</summary><pre>${esc(p)}</pre></details>
    </div>`;
  }

  async function copy(id) {
    const p = store.get(id); if (!p) return false;
    try { if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) { await root.navigator.clipboard.writeText(p); return true; } } catch (e) { /* fall through to the older route */ }
    try {
      const d = root.document, ta = d.createElement('textarea'); ta.value = p; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      d.body.appendChild(ta); ta.select(); const ok = d.execCommand('copy'); d.body.removeChild(ta); return !!ok;
    } catch (e) { return false; }
  }

  if (typeof document !== 'undefined') document.addEventListener('click', async e => {
    const b = e.target && e.target.closest ? e.target.closest('[data-fc-copy]') : null; if (!b) return;
    const old = b.textContent, ok = await copy(b.getAttribute('data-fc-copy'));
    b.textContent = ok ? '✓ Copied: paste it into your AI' : 'Couldn’t copy: tap “Show the prompt” and copy it'; setTimeout(() => { b.textContent = old; }, 2500);
  });
  root.FiveCheck = { AIS, PROMPT, stockLabel, prompt, html, copy, idOf, _store: store };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FiveCheck;
})(typeof window !== 'undefined' ? window : globalThis);
