// Markets study analysis. Reads raw/default/<MARKET>/<question>-NNN.json, writes results.json and prints the numbers.
// node scripts/analyze.cjs            (uses hreflang.json if present)
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..'), RAW = process.argv[2] || path.join(DIR, 'raw');
const MARKETS = ['US', 'GB', 'AU', 'CA', 'DE'];
const LOCAL = {
  GB: [/\.co\.uk$/, /^uk\./, /\/(uk|gb|en-gb|en_gb|en-uk)(\/|$)/i, /[?&](lang|locale)=en-gb/i],
  AU: [/\.com\.au$/, /\.au$/, /^au\./, /\/(au|en-au|en_au)(\/|$)/i],
  CA: [/\.ca$/, /^ca\./, /\/(ca|en-ca|en_ca)(\/|$)/i],
  DE: [/\.de$/, /^de\./, /\/(de|de-de|de_de)(\/|$)/i],
};
const clean = u => u.replace(/[?&]utm_[^&]*/g, '').replace(/\?$/, '').replace(/#.*$/, '');
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const pathOf = u => { try { return new URL(u).pathname; } catch { return ''; } };
// brand root: strip subdomain and country TLDs so bamboohr.co.uk and bamboohr.com group together
const root = h => {
  const parts = h.split('.');
  let n = 2;
  if (/\.(co|com|org|net)\.(uk|au)$/.test(h)) n = 3;
  return parts.slice(-n)[0];
};
const isLocal = (u, m) => {
  if (!LOCAL[m]) return false;
  const h = hostOf(u), p = pathOf(u);
  return LOCAL[m].some(re => re.test(h) || re.test(p) || re.test(u));
};
const anyLocal = u => ['GB', 'AU', 'CA', 'DE'].some(m => isLocal(u, m));

// load answers
const answers = [];
for (const m of MARKETS) {
  const d = path.join(RAW, m);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    const j = JSON.parse(fs.readFileSync(path.join(d, f)));
    const r = j.tasks?.[0]?.result?.[0];
    if (!r) continue;
    const urls = new Set();
    for (const s of r.sources || []) if (s.url) urls.add(clean(s.url));
    for (const it of r.items || []) for (const s of it.sources || []) if (s.url) urls.add(clean(s.url));
    const [q, n] = f.replace('.json', '').split('-');
    answers.push({ m, q, n: +n, urls: [...urls], md: r.markdown || '' });
  }
}
const Q = [...new Set(answers.map(a => a.q))].sort();
const out = { answers: answers.length, byMarket: {}, perQuestion: {}, pairs: [], control: {} };
for (const m of MARKETS) out.byMarket[m] = answers.filter(a => a.m === m).length;
console.log('answers', answers.length, JSON.stringify(out.byMarket));
const withSources = answers.filter(a => a.urls.length).length;
console.log('answers citing at least one page', withSources);
out.withSources = withSources;

// control: US answers citing any market-specific URL
const us = answers.filter(a => a.m === 'US');
out.control.usAnswersWithAnyLocal = us.filter(a => a.urls.some(anyLocal)).length;
out.control.usAnswers = us.length;

// domain share vector for a set of answers
const shares = set => { const c = {}; for (const a of set) for (const r of new Set(a.urls.map(u => root(hostOf(u))))) c[r] = (c[r] || 0) + 1; for (const k in c) c[k] /= set.length; return c; };
const overlap = (A, B) => { const ks = new Set([...Object.keys(A), ...Object.keys(B)]); let mn = 0, mx = 0; for (const k of ks) { const a = A[k] || 0, b = B[k] || 0; mn += Math.min(a, b); mx += Math.max(a, b); } return mx ? mn / mx : 0; };
const shuffle = (a, seed) => { const x = a.slice(); let s = seed; for (let i = x.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor(s / 233280 * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

for (const q of Q) {
  const row = {};
  const usQ = answers.filter(a => a.q === q && a.m === 'US');
  for (const m of MARKETS) {
    const set = answers.filter(a => a.q === q && a.m === m);
    if (set.length < 10) continue;
    let within = 0, between = 0; const R = 50;
    for (let s = 1; s <= R; s++) {
      const sh = shuffle(set, s * 7 + 1), h = Math.floor(sh.length / 2);
      within += overlap(shares(sh.slice(0, h)), shares(sh.slice(h, 2 * h)));
      if (m !== 'US') { const su = shuffle(usQ, s * 13 + 3).slice(0, h), sm = shuffle(set, s * 17 + 5).slice(0, h); between += overlap(shares(su), shares(sm)); }
    }
    row[m] = { n: set.length, within: +(within / R).toFixed(2), vsUS: m === 'US' ? null : +(between / R).toFixed(2), localUrlAnswers: m === 'US' ? null : set.filter(a => a.urls.some(u => isLocal(u, m))).length };
  }
  out.perQuestion[q] = row;
}

// pairs: (root, question, market) where the root is cited in at least 5 of that market's answers
const hreflang = fs.existsSync(path.join(DIR, 'hreflang.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'hreflang.json'))) : {};
for (const q of Q) for (const m of ['GB', 'AU', 'CA', 'DE']) {
  const set = answers.filter(a => a.q === q && a.m === m);
  const roots = {};
  for (const a of set) {
    const seen = {};
    for (const u of a.urls) { const r = root(hostOf(u)); (seen[r] ??= { local: false, other: false }); if (isLocal(u, m)) seen[r].local = true; else seen[r].other = true; }
    for (const r in seen) { roots[r] ??= { cited: 0, local: 0, onlyOther: 0 }; roots[r].cited++; if (seen[r].local) roots[r].local++; else roots[r].onlyOther++; }
  }
  for (const [r, v] of Object.entries(roots)) {
    if (v.cited < 5) continue;
    const observedLocal = answers.some(a => a.m === m && a.urls.some(u => root(hostOf(u)) === r && isLocal(u, m)));
    const hl = hreflang[r] ? !!hreflang[r][m] : null;
    out.pairs.push({ q, m, root: r, cited: v.cited, of: set.length, localCited: v.local, otherOnly: v.onlyOther, localPageObserved: observedLocal, hreflangHasMarket: hl });
  }
}
// vendor pairs: the software brands from brands.json, (vendor, question, market) where the market's answers cite the vendor's site at least 5 times
const brandsFile = path.join(DIR, 'brands.json');
out.vendorPairs = [];
if (fs.existsSync(brandsFile)) {
  const brands = JSON.parse(fs.readFileSync(brandsFile, 'utf8'));
  const onDom = (u, doms) => { const h = hostOf(u); return doms.some(d => h === d || h.endsWith('.' + d) || root(h) === root(d)); };
  for (const q of Q) for (const b of brands[q] || []) for (const m of ['GB', 'AU', 'CA', 'DE']) {
    const set = answers.filter(a => a.q === q && a.m === m);
    let cited = 0, local = 0, other = 0;
    for (const a of set) { const us = a.urls.filter(u => onDom(u, b.domains)); if (!us.length) continue; cited++; if (us.some(u => isLocal(u, m))) local++; else other++; }
    if (cited < 5) continue;
    const observed = answers.some(a => a.m === m && a.urls.some(u => onDom(u, b.domains) && isLocal(u, m)));
    const hlRoots = b.domains.map(d => root(d)).filter(r => hreflang[r]);
    const hl = hlRoots.length ? hlRoots.some(r => !!hreflang[r][m]) : null;
    out.vendorPairs.push({ q, m, vendor: b.name, cited, of: set.length, local, otherOnly: other, observed, hreflang: hl });
  }
}
if (!process.argv[2]) fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(out, null, 1));

// print
console.log('\ncontrol: US answers citing any market-specific URL', out.control.usAnswersWithAnyLocal, 'of', out.control.usAnswers);
console.log('\nper question: within-market overlap vs US-vs-market overlap, and answers citing a local URL');
for (const q of Q) console.log(q.padEnd(11), MARKETS.map(m => { const c = out.perQuestion[q][m]; return c ? `${m} n${c.n} w${c.within}${c.vsUS != null ? ' x' + c.vsUS + ' L' + c.localUrlAnswers : ''}` : `${m} -`; }).join(' | '));
const known = out.pairs.filter(p => p.localPageObserved || p.hreflangHasMarket);
const localWins = known.filter(p => p.localCited > p.otherOnly);
console.log('\npairs with a local page (observed or hreflang):', known.length, ' local URL cited more often than the other:', localWins.length);
for (const p of known.sort((a, b) => b.cited - a.cited).slice(0, 40)) console.log(`${p.m} ${p.q.padEnd(10)} ${p.root.padEnd(18)} cited ${p.cited}/${p.of} local ${p.localCited} other-only ${p.otherOnly} hreflang ${p.hreflangHasMarket}`);

// vendor summary
const vk = out.vendorPairs.filter(p => p.observed || p.hreflang);
const vwin = vk.filter(p => p.local > p.otherOnly);
console.log('\nVENDOR pairs with a market page (observed or hreflang):', vk.length, ' local page cited more often than the .com page:', vwin.length);
for (const m of ['GB', 'AU', 'CA', 'DE']) { const s = vk.filter(p => p.m === m); console.log(' ', m, s.filter(p => p.local > p.otherOnly).length, 'of', s.length); }
const lossHl = vk.filter(p => p.local <= p.otherOnly);
console.log('vendor pairs where the market page lost:'); for (const p of lossHl) console.log(`  ${p.m} ${p.q} ${p.vendor} cited ${p.cited}/${p.of} local ${p.local} other ${p.otherOnly} hreflang ${p.hreflang} observed ${p.observed}`);
