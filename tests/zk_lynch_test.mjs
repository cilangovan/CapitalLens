// Run: node tests/zk_lynch_test.mjs
import { createRequire } from 'node:module'; const L = createRequire(import.meta.url)('../docs/zk/lynch.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : (fail++, console.log('  ✗ ' + n)); if (c) console.log('  ✓ ' + n); };
const b = d => L.classify(d).bucket;
ok('ETF is bucket 0', b({ quoteType: 'ETF' }) === 0);
ok('profitable 40% earnings growth -> Fast Grower', b({ quoteType: 'EQUITY', sector: 'Technology', industry: 'Software', marketCap: 5e9, earningsGrowth: 0.4, profitMargins: 0.2 }) === 1);
ok('large steady 18% -> Stalwart', b({ sector: 'Consumer Defensive', industry: 'Beverages', marketCap: 200e9, earningsGrowth: 0.18, profitMargins: 0.2 }) === 2);
ok('airline -> Cyclical even with growth', b({ sector: 'Industrials', industry: 'Airlines', marketCap: 20e9, earningsGrowth: 0.5, profitMargins: 0.05 }) === 3);
ok('semiconductors -> Cyclical', b({ sector: 'Technology', industry: 'Semiconductors', marketCap: 100e9, earningsGrowth: 0.3, profitMargins: 0.3 }) === 3);
ok('2% growth utility-like -> Slow Grower', b({ sector: 'Utilities', industry: 'Utilities - Regulated Electric', marketCap: 30e9, earningsGrowth: 0.02, profitMargins: 0.1 }) === 4);
ok('loss-making, flat revenue -> Turnaround', b({ sector: 'Industrials', industry: 'Specialty Business Services', marketCap: 2e9, revenueGrowth: 0.02, profitMargins: -0.1 }) === 5);
ok('loss-making but revenue +60% -> Fast (speculative, low confidence)', b({ sector: 'Industrials', industry: 'Space', revenueGrowth: 0.6, profitMargins: -0.4 }) === 1 && L.classify({ revenueGrowth: 0.6, profitMargins: -0.4, sector: 'x' }).confidence === 'low');
ok('price to book 0.5 -> Asset Play (beats growth rules)', b({ sector: 'Real Estate', marketCap: 1e9, earningsGrowth: 0.3, profitMargins: 0.2, priceToBook: 0.5 }) === 6);
ok('negative book value is not an asset play', b({ sector: 'Technology', industry: 'Software', marketCap: 5e9, earningsGrowth: 0.3, profitMargins: 0.1, priceToBook: -3 }) === 1);
ok('10% growth: large cap -> Stalwart, small cap -> Slow', b({ sector: 'Healthcare', industry: 'Medical Devices', marketCap: 50e9, earningsGrowth: 0.1, profitMargins: 0.1 }) === 2 && b({ sector: 'Healthcare', industry: 'Medical Devices', marketCap: 1e9, earningsGrowth: 0.1, profitMargins: 0.1 }) === 4);
ok('uses revenue growth when earnings growth is missing, says so', (() => { const r = L.classify({ sector: 'Technology', industry: 'Software', marketCap: 5e9, revenueGrowth: 0.3, profitMargins: 0.1 }); return r.bucket === 1 && r.basis === 'revenue' && /revenue/.test(r.reason); })());
ok('no data -> unclassified, never a guess', L.classify({}).bucket === null && L.classify(null).bucket === null);
ok('every classification has a reason and a known name', [{ quoteType: 'ETF' }, { sector: 'Energy', industry: 'Oil & Gas E&P', profitMargins: 0.1 }, { sector: 'Tech', earningsGrowth: 0.3, profitMargins: 0.1 }].every(d => { const r = L.classify(d); return r.reason && r.name && L.BUCKETS[r.bucket]; }));
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
