// Phone push delivery from the browser via ntfy. The topic acts like a password, so it is kept only in the user's encrypted store
// (kind 'settings', key 'notify'), never in code or in plain storage. Plain-text POST = a CORS "simple request" (no preflight).
(function (root) {
  'use strict';
  const PRIORITIES = ['min', 'low', 'default', 'high', 'urgent'];
  // opts: { topic, fetchImpl, server }
  function create(opts) {
    const topic = String(opts.topic || '').trim(), server = (opts.server || 'https://ntfy.sh').replace(/\/+$/, ''), f = opts.fetchImpl || ((...a) => fetch(...a));
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(topic)) throw new Error('ntfy topic must be 6-64 letters, digits, - or _');
    async function notify(push) {
      const q = new URLSearchParams({ title: push.title, priority: PRIORITIES.includes(push.priority) ? push.priority : 'default', tags: push.tags || 'bell' });
      let body = String(push.body || '');
      const bytes = t => new TextEncoder().encode(t).length;
      if (bytes(body) > 3900) { while (bytes(body) > 3800) body = body.slice(0, Math.floor(body.length * 0.9)); body = body.replace(/\n[^\n]*$/, '') + '\n… full report on the dashboard'; }
      const r = await f(`${server}/${topic}?${q}`, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body });
      if (!r.ok) throw new Error('ntfy HTTP ' + r.status);
      return true;
    }
    return { notify };
  }
  async function saveTopic(store, topic) { create({ topic, fetchImpl: () => null }); await store.put('settings', [{ key: 'notify', topic: String(topic).trim() }], r => r.key); }
  async function fromStore(store, fetchImpl) { const s = await store.get('settings', 'notify'); return s && s.topic ? create({ topic: s.topic, fetchImpl }) : null; }
  root.ZKNotify = { create, saveTopic, fromStore };
  if (typeof module !== 'undefined') module.exports = root.ZKNotify;
})(typeof window !== 'undefined' ? window : globalThis);
