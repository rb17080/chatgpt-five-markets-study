// Builds the published files from raw/, top_picks.jsonl, results.json (scripts/analyze.cjs)
// and layers.json (scripts/layers.cjs): queries.txt, answers.csv, top_picks_by_country.csv,
// local_pages.csv, brand_layers.csv. Prints the headline numbers.
//   node scripts/analyze.cjs && node scripts/layers.cjs && node scripts/build_dataset.cjs
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), RAW = path.join(ROOT, 'raw');
const MARKETS = ['US', 'GB', 'AU', 'CA', 'DE'];
const LANG = { US: 'en', GB: 'en', AU: 'en', CA: 'en', DE: 'de' };
const label = m => (m === 'GB' ? 'UK' : m);
const MONEY = ['accounting', 'payroll', 'payments'];
const csv = rows => rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n') + '\n';
const clean = u => u.replace(/[?&]utm_[^&]*/g, '').replace(/\?$/, '').replace(/#.*$/, '');
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '');

const picks = new Map(fs.readFileSync(path.join(ROOT, 'top_picks.jsonl'), 'utf8').trim().split('\n').map(l => { const j = JSON.parse(l); return [j.id, j]; }));
const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'results.json'), 'utf8'));
const layers = JSON.parse(fs.readFileSync(path.join(ROOT, 'layers.json'), 'utf8'));

// answers
const answers = [];
for (const m of MARKETS) for (const f of fs.readdirSync(path.join(RAW, m)).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(RAW, m, f))).tasks?.[0]?.result?.[0];
  if (!r) continue;
  const urls = new Set();
  for (const s of r.sources || []) if (s.url) urls.add(clean(s.url));
  for (const it of r.items || []) for (const s of it.sources || []) if (s.url) urls.add(clean(s.url));
  const [q, n] = f.replace('.json', '').split('-');
  const id = `${m}|${q}|${n}`, p = picks.get(id) || {};
  answers.push({ id, m, q, n: +n, keyword: r.keyword, pick: p.pick || '', names: p.names || [], urls: [...urls] });
}

// queries.txt
const qs = [...new Map(answers.map(a => [a.m + a.q, `${label(a.m)}\t${a.q}\t${a.keyword}`])).values()];
fs.writeFileSync(path.join(ROOT, 'queries.txt'), 'country\tquestion\tasked as\n' + qs.join('\n') + '\n');

// answers.csv
const arows = [['answer_id', 'country', 'language', 'question', 'repeat', 'top_pick', 'tracked_brands_named', 'cited_urls']];
for (const a of answers) arows.push([a.id.replace(/^GB/, 'UK'), label(a.m), LANG[a.m], a.q, a.n, a.pick === 'none' ? '(no single pick)' : a.pick, a.names.join(' | '), a.urls.join(' ')]);
fs.writeFileSync(path.join(ROOT, 'answers.csv'), csv(arows));

// top_picks_by_country.csv
const trows = [['question', 'country', 'answers', 'top_pick_1', 'top_pick_2', 'top_pick_3']];
const Q = [...new Set(answers.map(a => a.q))];
for (const q of Q) for (const m of MARKETS) {
  const set = answers.filter(a => a.q === q && a.m === m), c = {};
  for (const a of set) { const k = a.pick === 'none' ? '(no single pick)' : a.pick; c[k] = (c[k] || 0) + 1; }
  const top = Object.entries(c).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`);
  trows.push([q, label(m), set.length, ...top]);
}
fs.writeFileSync(path.join(ROOT, 'top_picks_by_country.csv'), csv(trows));

// local_pages.csv: vendor x country cases where the vendor has a page for that country and is cited in 5+ of 30
const vk = results.vendorPairs.filter(p => p.observed || p.hreflang);
const lrows = [['question', 'money_category', 'country', 'vendor', 'answers_citing_vendor', 'citing_country_page', 'citing_only_other_pages', 'country_page_won', 'country_page_seen_in_answers', 'hreflang_declares_country']];
for (const p of vk) lrows.push([p.q, MONEY.includes(p.q) ? 'yes' : 'no', label(p.m), p.vendor, `${p.cited} of ${p.of}`, p.local, p.otherOnly, p.local > p.otherOnly ? 'yes' : 'no', p.observed ? 'yes' : 'no', p.hreflang === null ? 'not checked' : p.hreflang ? 'yes' : 'no']);
fs.writeFileSync(path.join(ROOT, 'local_pages.csv'), csv(lrows));

// brand_layers.csv
const brows = [['question', 'country', 'brand', 'answers', 'named', 'top_pick', 'linked', 'cited']];
for (const r of layers) brows.push([r.q, label(r.m), r.brand, r.n, r.named, r.recommended, r.linked, r.cited]);
fs.writeFileSync(path.join(ROOT, 'brand_layers.csv'), csv(brows));

// headline numbers
const usTop = q => { const c = {}; answers.filter(a => a.q === q && a.m === 'US').forEach(a => (c[a.pick] = (c[a.pick] || 0) + 1)); return Object.entries(c).sort((x, y) => y[1] - x[1])[0][0]; };
let P = 0, D = 0;
for (const q of ['accounting', 'payroll', 'hr']) { const t = usTop(q); for (const a of answers.filter(a => a.q === q && a.m !== 'US' && a.pick && a.pick !== 'none')) { P++; if (a.pick !== t) D++; } }
const M = vk.filter(p => MONEY.includes(p.q)), O = vk.filter(p => !MONEY.includes(p.q));
console.log('answers', answers.length, '| with a cited page', answers.filter(a => a.urls.length).length);
console.log(`accounting/payroll/HR outside the US: different pick than the US winner in ${D} of ${P} answers with a pick (${pct(D, P)})`);
console.log(`country page beat the .com: money ${M.filter(p => p.local > p.otherOnly).length} of ${M.length}, other ${O.filter(p => p.local > p.otherOnly).length} of ${O.length}`);
console.log('files written: queries.txt answers.csv top_picks_by_country.csv local_pages.csv brand_layers.csv');
