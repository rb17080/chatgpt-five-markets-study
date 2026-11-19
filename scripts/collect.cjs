// ChatGPT markets study, 2026-11-19 .
// 10 questions x 5 markets (US, UK, Australia, Canada in English, Germany in German) x 30 = 1,500 answers.
// Default mode only: ChatGPT decides whether to search (it searched 15 of 15 in the pre-test).
// Standard queue ($0.0012 a task). Hard stop: nothing is posted once spend since the first
// post would pass $3.00. Resumable: tags already posted are never posted again, answers
// already saved are never fetched again.
//
//   node scripts/collect.cjs --dry     print the plan and the cost, send nothing
//   node scripts/collect.cjs --post    post whatever is not posted yet, then collect
//   node scripts/collect.cjs --collect only collect ready answers

const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..');
const RAW = path.join(DIR, 'raw');
const POSTED = path.join(DIR, 'posted.jsonl');
const STATE = path.join(DIR, 'state.json');
const LOG = path.join(DIR, 'run.log');
const CAP = 3.00, PRICE = 0.0012, REPEATS = 30, BATCH = 100;

const AUTH = 'Basic ' + Buffer.from(process.env.DATAFORSEO_LOGIN + ':' + process.env.DATAFORSEO_PASSWORD).toString('base64');
const BASE = 'https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper';

const log = (...a) => { const s = new Date().toISOString() + ' ' + a.join(' '); console.log(s); fs.appendFileSync(LOG, s + '\n'); };
const api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return r.json();
};
const balance = async () => (await api('GET', 'https://api.dataforseo.com/v3/appendix/user_data')).tasks[0].result[0].money.balance;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const QUESTIONS = [
  { id: 'accounting', en: "What's the best accounting software for a small business?", de: 'Was ist die beste Buchhaltungssoftware für ein kleines Unternehmen?' },
  { id: 'crm', en: "What's the best CRM for a small team?", de: 'Was ist das beste CRM für ein kleines Team?' },
  { id: 'email', en: "What's the best email marketing tool for a small business?", de: 'Was ist das beste E-Mail-Marketing-Tool für ein kleines Unternehmen?' },
  { id: 'hr', en: "What's the best HR software for a small company?", de: 'Was ist die beste HR-Software für ein kleines Unternehmen?' },
  { id: 'pm', en: "What's the best project management tool for a startup?", de: 'Was ist das beste Projektmanagement-Tool für ein Startup?' },
  { id: 'payroll', en: "What's the best payroll software for a small business?", de: 'Was ist die beste Lohnabrechnungssoftware für ein kleines Unternehmen?' },
  { id: 'payments', en: "What's the best payment processor for a small online store?", de: 'Was ist der beste Zahlungsanbieter für einen kleinen Onlineshop?' },
  { id: 'helpdesk', en: "What's the best help desk software for a small support team?", de: 'Was ist die beste Helpdesk-Software für ein kleines Support-Team?' },
  { id: 'esign', en: "What's the best e-signature software for a small business?", de: 'Was ist die beste Software für elektronische Signaturen für ein kleines Unternehmen?' },
  { id: 'passwords', en: "What's the best password manager for a small team?", de: 'Was ist der beste Passwort-Manager für ein kleines Team?' },
];
const COUNTRIES = [
  { c: 'US', loc: 2840, lang: 'en' },
  { c: 'GB', loc: 2826, lang: 'en' },
  { c: 'AU', loc: 2036, lang: 'en' },
  { c: 'CA', loc: 2124, lang: 'en' },
  { c: 'DE', loc: 2276, lang: 'de' },
];
const MODES = ['default'];

// Interleave repeats so a stop part-way still leaves every group evenly filled.
function plan() {
  const out = [];
  for (let n = 1; n <= REPEATS; n++)
    for (const m of MODES) for (const k of COUNTRIES) for (const q of QUESTIONS) {
      const t = { keyword: q[k.lang], location_code: k.loc, language_code: k.lang, tag: `${m}|${k.c}|${q.id}|${n}` };
      if (m === 'forced') t.force_web_search = true;
      out.push(t);
    }
  return out;
}

const posted = () => fs.existsSync(POSTED) ? fs.readFileSync(POSTED, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const fileFor = tag => { const [m, c, q, n] = tag.split('|'); return path.join(RAW, c, `${q}-${String(n).padStart(3, '0')}.json`); };

async function postAll() {
  const done = new Set(posted().map(p => p.tag));
  const todo = plan().filter(t => !done.has(t.tag));
  if (!todo.length) { log('nothing left to post'); return; }
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE)) : { startBalance: await balance() };
  // Spend is summed from each batch's reported cost; the balance endpoint refuses rapid calls.
  if (state.spent == null) state.spent = posted().length * PRICE;
  fs.writeFileSync(STATE, JSON.stringify(state));
  log('to post', todo.length, 'start balance', state.startBalance);
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const spent = state.spent;
    if (spent + batch.length * PRICE > CAP) { log('HARD STOP: spent', spent.toFixed(4), 'next batch would pass the $' + CAP + ' cap'); return; }
    const r = await api('POST', BASE + '/task_post', batch);
    if (r.status_code !== 20000) { log('post failed', r.status_code, r.status_message); return; }
    const lines = [];
    for (const t of r.tasks) {
      if (t.status_code === 20100) lines.push(JSON.stringify({ id: t.id, tag: t.data.tag }));
      else log(' task refused', t.data?.tag, t.status_code, t.status_message);
    }
    fs.appendFileSync(POSTED, lines.join('\n') + '\n');
    state.spent = spent + r.cost; fs.writeFileSync(STATE, JSON.stringify(state));
    log('posted batch', i / BATCH + 1, 'tasks', lines.length, 'cost', r.cost, 'spent so far', state.spent.toFixed(4));
    await sleep(1500);
  }
}

async function collect() {
  const byId = new Map(posted().map(p => [p.id, p.tag]));
  const missing = () => [...byId].filter(([, tag]) => !fs.existsSync(fileFor(tag)));
  let quiet = 0;
  while (missing().length && quiet < 90) {
    const ready = await api('GET', BASE + '/tasks_ready');
    const ids = (ready.tasks?.[0]?.result || []).map(r => r.id).filter(id => byId.has(id) && !fs.existsSync(fileFor(byId.get(id))));
    for (const id of ids) {
      const g = await api('GET', BASE + '/task_get/advanced/' + id);
      const t = g.tasks?.[0];
      if (t?.status_code === 20000) {
        const f = fileFor(byId.get(id));
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify(g));
      } else log(' get failed', byId.get(id), t?.status_code, t?.status_message);
    }
    const left = missing().length;
    log('collected', ids.length, 'still missing', left);
    quiet = ids.length ? 0 : quiet + 1;
    if (left) await sleep(60000);
  }
  // Final sweep: anything tasks_ready never listed gets asked for directly.
  for (const [id, tag] of missing()) {
    const t = (await api('GET', BASE + '/task_get/advanced/' + id)).tasks?.[0];
    if (t?.status_code === 20000) { const f = fileFor(tag); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ tasks: [t] })); }
    else log(' still missing', tag, t?.status_code, t?.status_message);
  }
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE)) : null;
  if (state) log('DONE. total spent', (state.startBalance - await balance()).toFixed(4), 'missing', missing().length);
}

(async () => {
  const arg = process.argv[2];
  if (arg === '--dry' || !arg) {
    const p = plan();
    console.log('tasks', p.length, 'cost $' + (p.length * PRICE).toFixed(2), 'cap $' + CAP);
    console.log('already posted', posted().length);
    console.log('first 3:', p.slice(0, 3).map(t => t.tag + ' :: ' + t.keyword).join('\n  '));
    console.log('groups:', new Set(p.map(t => t.tag.split('|').slice(0, 3).join('|'))).size, 'x', REPEATS);
    return;
  }
  if (arg === '--post') { await postAll(); await collect(); }
  if (arg === '--collect') await collect();
})().catch(e => log('ERROR', e.stack || e.message));
