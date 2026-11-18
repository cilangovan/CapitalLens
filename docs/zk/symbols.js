// Port of t212_to_yahoo (services/value_buy_service.py) and exchange_of (services/pie_history_service.py).
(function (root) {
  'use strict';
  function t212ToYahoo(t, exchange) {
    if (t === 'FB_US_EQ') return ['META', '$'];
    const core = t.replace('_EQ', ''), ex = (exchange || '').toUpperCase();
    if (['NASDAQ/NYSE', 'NYSE', 'NASDAQ'].includes(ex)) return [core.replace('_US', ''), '$'];
    if (ex === 'LSE') return [core.replace(/l+$/, '') + '.L', '£'];
    if (ex === 'XETRA') return [core.replace(/d+$/, '') + '.DE', '€'];
    if (ex === 'AMS') return [core.replace(/a+$/, '') + '.AS', '€'];
    return [core.split('_')[0], '$'];
  }
  function exchangeOf(t) {
    if (t.endsWith('_US_EQ')) return 'NASDAQ/NYSE';
    if (t.endsWith('l_EQ')) return 'LSE';
    if (t.endsWith('d_EQ')) return 'XETRA';
    if (t.endsWith('a_EQ')) return 'AMS';
    return '';
  }
  root.ZKSymbols = { t212ToYahoo, exchangeOf };
  if (typeof module !== 'undefined') module.exports = root.ZKSymbols;
})(typeof window !== 'undefined' ? window : globalThis);
