// Peter Lynch's six stock buckets (rule-based estimate from public fundamentals; a screening aid, not advice).
//  1 Fast Growers (25%+ growth) · 2 Stalwarts (15-25% steady) · 3 Cyclicals (boom & bust) · 4 Slow Growers (<5%) · 5 Turnarounds (losses -> profits) · 6 Asset Plays (hidden assets)
// Order of the rules matters and is shown to the user as the "reason". Funds/ETFs are not classified (bucket 0).
(function (root) {
  'use strict';
  const BUCKETS = {
    0: { name: 'Fund / ETF', short: 'Fund', note: 'A basket of companies, not one business' },
    1: { name: 'Fast Grower', short: 'Fast', note: 'Rapid expansion, 25%+ growth' },
    2: { name: 'Stalwart', short: 'Stalwart', note: 'Large, dependable business, 15-25% steady growth' },
    3: { name: 'Cyclical', short: 'Cyclical', note: 'Earnings move in cycles: boom and bust' },
    4: { name: 'Slow Grower', short: 'Slow', note: 'Matured business, under 5% growth' },
    5: { name: 'Turnaround', short: 'Turnaround', note: 'Business recovery: losses to profits, management change' },
    6: { name: 'Asset Play', short: 'Asset', note: 'Hidden assets: very risky, asset value indeterminate' },
  };
  const CYC_SECTORS = /^(energy|basic materials)$/i;
  const CYC_INDUSTRY = /airline|aerospace|defen[cs]e|semiconductor|auto|steel|chemical|mining|oil|gas|metals|shipping|marine|homebuild|construction|building|paper|packaging|trucking|railroad|farm|heavy|machinery/i;
  const num = v => (v === null || v === undefined || v === '' || Number.isNaN(+v)) ? null : +v;
  const pct = v => (v * 100).toFixed(0) + '%';
  // d: flat Yahoo "info" from the relay (/yahoo-detail): quoteType, sector, industry, marketCap, earningsGrowth, revenueGrowth, profitMargins, priceToBook
  // Precious-metal ETCs/ETFs often come back from Yahoo with no fundamentals at all; they are funds, not "no data".
  const ETC = /^(SGLN|SSLN|SPLT|SPAL|PHAU|PHAG|PHPT|PHPD|IGLN|IGLD|GBSS|XGLD|XSLV|GLD|SLV|IAU|SGOL|SIVR|PPLT|PALL|CMOD|BCOM)$/;
  const isCommodityEtc = y => ETC.test(String(y || '').toUpperCase().split('.')[0]);
  // Yahoo's earningsGrowth is the latest quarter vs a year ago (noisy); revenueGrowth is steadier. With both, use the average (each capped at +-100%).
  const cap1 = v => Math.max(-1, Math.min(1, v));
  function classify(d, hint) {
    d = d || {};
    const type = String(d.quoteType || '').toUpperCase(), sector = d.sector || '', industry = d.industry || '', cap = num(d.marketCap), eg = num(d.earningsGrowth), rg = num(d.revenueGrowth), pm = num(d.profitMargins), pb = num(d.priceToBook);
    const both = eg !== null && rg !== null, g = both ? (cap1(eg) + cap1(rg)) / 2 : eg !== null ? eg : rg, basisTxt = both ? 'earnings & revenue' : eg !== null ? 'earnings' : 'revenue';
    const out = (bucket, reason, extra) => Object.assign({ bucket, name: BUCKETS[bucket].name, reason, growth: g, basis: both ? 'earnings & revenue' : eg !== null ? 'earnings' : rg !== null ? 'revenue' : null, confidence: 'medium' }, extra || {});
    if (type === 'ETF' || type === 'MUTUALFUND' || type === 'INDEX') return out(0, 'Fund or ETF: not a single business', { confidence: 'high' });
    if (!sector && cap === null && eg === null && rg === null && pm === null) {
      if (isCommodityEtc(hint)) return out(0, 'Precious-metal fund (ETC): tracks a commodity, not a business', { confidence: 'high' });
      return { bucket: null, name: 'Unclassified', reason: 'No fundamentals available', growth: null, basis: null, confidence: 'low' };
    }
    if (pb !== null && pb > 0 && pb < 0.8) return out(6, `Trades at ${pb.toFixed(2)}x book value (under 0.8x): possible hidden assets`);
    if (pm !== null && pm < 0) {
      if (rg !== null && rg >= 0.25) return out(1, `Loss-making but revenue up ${pct(rg)}: speculative fast grower (growth is revenue, not profit)`, { confidence: 'low' });
      return out(5, `Loss-making (profit margin ${pct(pm)}): recovery story`, { confidence: pm < -0.05 ? 'medium' : 'low' });
    }
    if (CYC_SECTORS.test(sector) || CYC_INDUSTRY.test(industry)) return out(3, `${industry || sector}: earnings move with the economic cycle`, { confidence: 'medium' });
    if (g === null) return { bucket: null, name: 'Unclassified', reason: 'No growth data', growth: null, basis: null, confidence: 'low' };
    const conf = eg !== null ? 'high' : 'medium';
    if (g >= 0.25) return out(1, `${basisTxt} growth ${pct(g)} (25%+)`, { confidence: conf });
    if (g >= 0.15) return out(2, `${basisTxt} growth ${pct(g)} (15-25%)`, { confidence: conf });
    if (g >= 0.05) return cap !== null && cap >= 10e9 ? out(2, `${basisTxt} growth ${pct(g)} and large (${(cap / 1e9).toFixed(0)}bn): dependable`, { confidence: 'medium' }) : out(4, `${basisTxt} growth ${pct(g)}, mid/small size`, { confidence: 'medium' });
    return out(4, `${basisTxt} growth ${pct(g)} (under 5%)`, { confidence: conf });
  }
  root.ZKLynch = { BUCKETS, classify, isCommodityEtc };
  if (typeof module !== 'undefined') module.exports = root.ZKLynch;
})(typeof window !== 'undefined' ? window : globalThis);
