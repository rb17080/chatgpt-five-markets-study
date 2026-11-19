// For every site cited in at least 5 answers of a non-US market, fetch its most-cited non-local URL
// in that market and read the hreflang alternates. Writes hreflang.json { root: { GB: url, AU: url, ... , checked: url } }.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..'), RAW = path.join(DIR, 'raw');
const OUT = path.join(DIR, 'hreflang.json');
const clean = u => u.replace(/[?&]utm_[^&]*/g, '').replace(/\?$/, '').replace(/#.*$/, '');
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const root = h => { const p = h.split('.'); return p.slice(/\.(co|com|org|net)\.(uk|au)$/.test(h) ? -3 : -2)[0]; };
const LOCAL = { GB: /(\.co\.uk$|^uk\.|\/(uk|gb|en-gb|en_gb)(\/|$))/i, AU: /(\.au$|^au\.|\/(au|en-au)(\/|$))/i, CA: /(\.ca$|^ca\.|\/(ca|en-ca)(\/|$))/i, DE: /(\.de$|^de\.|\/(de|de-de)(\/|$))/i };
const isLocalAny = u => Object.values(LOCAL).some(re => re.test(hostOf(u)) || re.test(new URL(u).pathname));

const counts = {}; // root -> url -> count (non-US markets, non-local urls)
for (const m of ['GB', 'AU', 'CA', 'DE']) {
  const d = path.join(RAW, m); if (!fs.existsSync(d)) continue;
  const perRoot = {};
  for (const f of fs.readdirSync(d)) {
    const r = JSON.parse(fs.readFileSync(path.join(d, f))).tasks?.[0]?.result?.[0]; if (!r) continue;
    const urls = new Set(); for (const s of r.sources || []) s.url && urls.add(clean(s.url)); for (const it of r.items || []) for (const s of it.sources || []) s.url && urls.add(clean(s.url));
    const roots = new Set();
    for (const u of urls) { let lu; try { lu = isLocalAny(u); } catch { continue; } const rt = root(hostOf(u)); roots.add(rt); if (!lu) { (counts[rt] ??= {})[u] = (counts[rt][u] || 0) + 1; } }
    for (const rt of roots) perRoot[rt] = (perRoot[rt] || 0) + 1;
  }
  for (const [rt, c] of Object.entries(perRoot)) if (c >= 5) counts[rt] ??= {};
}
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {};
(async () => {
  const todo = Object.keys(counts).filter(rt => !prev[rt] && Object.keys(counts[rt]).length);
  console.log('sites to check', todo.length);
  for (const rt of todo) {
    const url = Object.entries(counts[rt]).sort((a, b) => b[1] - a[1])[0][0];
    const rec = { checked: url };
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
      const res = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.9' } });
      clearTimeout(t);
      rec.status = res.status;
      const html = (await res.text()).slice(0, 400000);
      const alts = [...html.matchAll(/<link[^>]+rel=["']alternate["'][^>]*>/gi)].map(m => m[0]);
      for (const a of alts) {
        const hl = (a.match(/hreflang=["']([^"']+)["']/i) || [])[1]; const href = (a.match(/href=["']([^"']+)["']/i) || [])[1];
        if (!hl || !href) continue; const h = hl.toLowerCase();
        if (h === 'en-gb' || h === 'en-uk') rec.GB = href; if (h === 'en-au') rec.AU = href; if (h === 'en-ca') rec.CA = href; if (h === 'de' || h === 'de-de') rec.DE = href;
      }
      rec.alternates = alts.length;
    } catch (e) { rec.error = e.name; }
    prev[rt] = rec; fs.writeFileSync(OUT, JSON.stringify(prev, null, 1));
    console.log(rt.padEnd(22), rec.status || rec.error, 'alts', rec.alternates ?? '-', ['GB', 'AU', 'CA', 'DE'].filter(k => rec[k]).join(','));
    await new Promise(r => setTimeout(r, 800));
  }
})();
