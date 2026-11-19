// Four layers per brand: named, recommended (Jev top pick), linked, cited.
//   node scripts/layers.cjs --brands   top brand entities per category (to build brands.json)
//   node scripts/layers.cjs --jev      Jev top-pick read per answer, resumable, hard cap $0.50
//   node scripts/layers.cjs            compute the layers, write layers.json, print
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..'), RAW = path.join(DIR, 'raw');
const MARKETS = ['US', 'GB', 'AU', 'CA', 'DE'];
const get = k => process.env[k];
const JEV_CAP = 0.50, JEV_PRICE = 42 / 1e9;
const INTENT = {
  accounting: 'the best accounting software for a small business', crm: 'the best CRM for a small team',
  email: 'the best email marketing tool for a small business', hr: 'the best HR software for a small company',
  pm: 'the best project management tool for a startup', payroll: 'the best payroll software for a small business',
  payments: 'the best payment processor for a small online store', helpdesk: 'the best help desk software for a small support team',
  esign: 'the best e-signature software for a small business', passwords: 'the best password manager for a small team',
};
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const onDomain = (u, doms) => { const h = hostOf(u); return doms.some(d => h === d || h.endsWith('.' + d)); };
const mdLinks = md => [...md.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]);
const prose = md => md.replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, ' ').replace(/\b[a-z0-9-]+\.(com|io|co|net|org|ai|de|uk|au|ca)\b/gi, ' ');

function load() {
  const out = [];
  for (const m of MARKETS) {
    const d = path.join(RAW, m); if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      const r = JSON.parse(fs.readFileSync(path.join(d, f))).tasks?.[0]?.result?.[0]; if (!r) continue;
      const [q, n] = f.replace('.json', '').split('-');
      const cited = new Set(); for (const s of r.sources || []) s.url && cited.add(s.url); for (const it of r.items || []) for (const s of it.sources || []) s.url && cited.add(s.url);
      const consulted = (Array.isArray(r.search_results) ? r.search_results : []).map(s => s.url).filter(Boolean);
      const md = r.markdown || (r.items || []).map(i => i.markdown || '').join('\n');
      out.push({ id: `${m}|${q}|${n}`, m, q, n: +n, md, cited: [...cited], linked: [...new Set([...cited, ...consulted, ...mdLinks(md)])], entities: (r.brand_entities || []).map(b => b.markdown).filter(Boolean) });
    }
  }
  return out;
}

const arg = process.argv[2];
const answers = load();

if (arg === '--brands') {
  const by = {};
  for (const a of answers) for (const e of new Set(a.entities)) { (by[a.q] ??= {})[e] = (by[a.q][e] || 0) + 1; }
  for (const q of Object.keys(by).sort()) console.log(q.padEnd(11), Object.entries(by[q]).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(', '));
  process.exit(0);
}

const brands = JSON.parse(fs.readFileSync(path.join(DIR, 'brands.json'), 'utf8')); // { q: [{name, aliases:[], domains:[]}] }
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const namedIn = (a, b) => { const p = b.rawName ? a.md.replace(/\]\([^)]*\)/g, ']') : prose(a.md); return [b.name, ...(b.aliases || [])].some(x => new RegExp('(^|[^A-Za-z0-9])' + esc(x) + '($|[^A-Za-z0-9])', b.cs ? '' : 'i').test(p)); };
const JEV = path.join(DIR, 'top_picks.jsonl');
const jevDone = () => fs.existsSync(JEV) ? new Map(fs.readFileSync(JEV, 'utf8').trim().split('\n').filter(Boolean).map(l => { const j = JSON.parse(l); return [j.id, j]; })) : new Map();

async function jevCall(state, questions, key) {
  for (let t = 0; t < 6; t++) {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'jev-latest', state, questions }) });
    if (res.status === 429 || res.status === 529 || res.status >= 500) { await new Promise(r => setTimeout(r, 1000 * 2 ** t)); continue; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`jev ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    return body;
  }
  throw new Error('jev: retries exhausted');
}

async function runJev() {
  const key = get('JEV_API_KEY'); if (!key) throw new Error('no JEV_API_KEY');
  const done = jevDone();
  let tokens = [...done.values()].reduce((s, j) => s + (j.tokens || 0), 0);
  const queue = answers.filter(a => !done.has(a.id));
  console.log('to read', queue.length, 'already', done.size);
  let stop = false;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (queue.length && !stop) {
      const a = queue.shift();
      const names = (brands[a.q] || []).filter(b => namedIn(a, b)).map(b => b.name);
      if (!names.length) { fs.appendFileSync(JEV, JSON.stringify({ id: a.id, pick: 'none', names, tokens: 0, skipped: true }) + '\n'); continue; }
      if (tokens * JEV_PRICE > JEV_CAP) { stop = true; console.log('HARD STOP at cap'); break; }
      const criteria = {}; for (const n of names) criteria[n] = `${n} is the answer's top pick: the one brand it puts first as its main recommendation for this buyer.`;
      criteria.none = 'The answer names no single top pick: it says it depends, or recommends several equally.';
      try {
        const res = await jevCall(a.md, { top_pick: { type: 'choice', instructions: `A buyer asked an AI assistant for ${INTENT[a.q]}. Which brand is this answer's top pick?`, criteria } }, key);
        const t = res.usage?.input_tokens ?? 0; tokens += t;
        const ans = res.answers?.top_pick ?? {};
        fs.appendFileSync(JEV, JSON.stringify({ id: a.id, pick: ans.choice, confidence: ans.confidence, names, tokens: t }) + '\n');
      } catch (e) { console.log('error', a.id, e.message); }
    }
  }));
  console.log('Jev done. input tokens', tokens, 'cost $' + (tokens * JEV_PRICE).toFixed(4), 'reads', jevDone().size);
}

function compute() {
  const jev = jevDone();
  const rows = [];
  for (const q of Object.keys(brands)) for (const b of brands[q]) for (const m of MARKETS) {
    const set = answers.filter(a => a.q === q && a.m === m); if (!set.length) continue;
    const read = set.filter(a => jev.has(a.id) && jev.get(a.id).pick);
    rows.push({
      q, m, brand: b.name, n: set.length,
      named: set.filter(a => namedIn(a, b)).length,
      recommended: read.filter(a => jev.get(a.id).pick === b.name).length, recOf: read.length,
      linked: set.filter(a => a.linked.some(u => onDomain(u, b.domains))).length,
      cited: set.filter(a => a.cited.some(u => onDomain(u, b.domains))).length,
    });
  }
  fs.writeFileSync(path.join(DIR, 'layers.json'), JSON.stringify(rows, null, 1));
  // all markets pooled per brand
  const pooled = {};
  for (const r of rows) { const k = r.q + '|' + r.brand; const p = (pooled[k] ??= { q: r.q, brand: r.brand, n: 0, named: 0, recommended: 0, recOf: 0, linked: 0, cited: 0 }); for (const f of ['n', 'named', 'recommended', 'recOf', 'linked', 'cited']) p[f] += r[f]; }
  const P = Object.values(pooled);
  fs.writeFileSync(path.join(DIR, 'layers-pooled.json'), JSON.stringify(P, null, 1));
  const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '-';
  console.log('brand'.padEnd(26), 'answers  named  recommended  linked  cited');
  for (const p of P.sort((a, b) => a.q.localeCompare(b.q) || b.named - a.named)) console.log(`${p.q.padEnd(10)} ${p.brand.padEnd(15)} ${String(p.n).padStart(4)}  ${pct(p.named, p.n).padStart(5)}  ${pct(p.recommended, p.recOf).padStart(6)}  ${pct(p.linked, p.n).padStart(6)}  ${pct(p.cited, p.n).padStart(5)}`);
  const noneShare = [...jev.values()].filter(j => j.pick === 'none').length;
  console.log('Jev reads', jev.size, 'none', noneShare);
}

(async () => { if (arg === '--jev') await runJev(); else compute(); })().catch(e => { console.error(e); process.exit(1); });
