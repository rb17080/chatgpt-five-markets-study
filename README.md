# ChatGPT's top pick, by the buyer's country

Ask ChatGPT for the best small-business software from the US, the UK, Australia, Canada and Germany. Does it recommend the same brand?

For accounting, payroll and HR, mostly not. Outside the US, ChatGPT picked a different brand than the US winner in 77.4% of those answers.

## Results

1,500 ChatGPT answers, collected 2026-11-19. Ten buying questions, each asked 30 times from the US, the UK, Australia, Canada and Germany (the German ones in German).

| | |
|---|---|
| Answers | 1,500 |
| Accounting, payroll and HR answers outside the US that picked a brand | 265 |
| ...that picked a different brand than the US winner | **205 (77.4%)** |
| Cases where a vendor had a page for the buyer's country, accounting, payroll and payments | 37 |
| ...where ChatGPT cited that page more often than the vendor's other pages | **35** |
| The same, in the other seven categories | 8 of 55 |

The top pick in each country (answers out of 30):

| Question | US | UK | Australia | Canada | Germany |
|---|---|---|---|---|---|
| Accounting | QuickBooks 30 | Xero 30 | Xero 30 | QuickBooks 30 | no single pick 17, sevdesk 13 |
| Payroll | Gusto 30 | Sage Payroll 17 | Xero Payroll 26 | Gusto 15, no single pick 15 | Sage Payroll 23 |
| HR | Gusto 30 | no single pick 22 | Employment Hero 27 | BambooHR 24 | no single pick 30 |
| Payments | Stripe 30 | Stripe 30 | Stripe 30 | Stripe 28 | Mollie 25 |
| Email marketing | MailerLite 30 | MailerLite 30 | MailerLite 30 | MailerLite 30 | Brevo 27 |
| CRM | HubSpot 30 | HubSpot 30 | HubSpot 30 | HubSpot 30 | HubSpot 28 |
| Help desk | Freshdesk 25 | Freshdesk 30 | Freshdesk 27 | Freshdesk 28 | Freshdesk 30 |
| Password manager | 1Password 23 | 1Password 29 | 1Password 30 | 1Password 30 | 1Password 19 |
| E-signature | Dropbox Sign 28 | Dropbox Sign 21 | Dropbox Sign 25 | Dropbox Sign 26 | no single pick 30 |
| Project management | ClickUp 14 | Linear 22 | Linear 20 | Linear 17 | ClickUp 12 |

Two examples of country pages:

- **Stripe and QuickBooks**: Stripe's UK and Australian pages were cited in 30 of 30 answers in each country. QuickBooks' Canadian page was cited in 30 of 30 Canadian answers.
- **Notion**: its page declares UK, Australian and German versions, and ChatGPT cited the .com in 30 of 30 answers in all three countries.

Every case is in `local_pages.csv`, and the top three picks for every question and country are in `top_picks_by_country.csv`.

## Files

- `queries.txt` - the 50 questions exactly as asked (10 questions x 5 countries).
- `answers.csv` - one row per answer: country, question, repeat number, ChatGPT's top pick, the tracked brands it named, and every URL it cited.
- `top_picks_by_country.csv` - the three most common top picks for each question in each country.
- `local_pages.csv` - the 92 cases where a tracked vendor had a page for the buyer's country and was cited in at least 5 of that country's 30 answers: how many answers cited the country page, how many cited only the vendor's other pages, and how the country page was found.
- `brand_layers.csv` - for every tracked brand, question and country: answers that named it, picked it first, linked to it and cited it.
- `brands.json` - the tracked brands per question, with their domains.
- `top_picks.jsonl` - the top-pick read for every answer.
- `hreflang.json` - the hreflang check for every site cited in at least 5 answers outside the US.
- `raw/` - every DataForSEO response, unedited (`raw/<country>/<question>-<repeat>.json`, GB = UK).
- `scripts/collect.cjs` - the collection script (reads `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` from the environment, about $1.80).
- `scripts/analyze.cjs` - country pages and source overlap. `scripts/hreflang.cjs` - the hreflang check. `scripts/layers.cjs` - the top-pick reads (`--jev`, reads `JEV_API_KEY`) and the per-brand counts. `scripts/build_dataset.cjs` - builds the CSVs and prints the headline numbers.

To rebuild every number from `raw/`: `node scripts/analyze.cjs && node scripts/layers.cjs && node scripts/build_dataset.cjs`.

## Method

- Collected with DataForSEO's ChatGPT **LLM Scraper** (`ai_optimization/chat_gpt/llm_scraper/task_post`, standard queue), logged-out ChatGPT, default mode: ChatGPT decided on its own whether to search the web. All 1,500 answers cited at least one page.
- Locations: US (2840, en), UK (2826, en), Australia (2036, en), Canada (2124, en), Germany (2276, de). The 30 repeats were interleaved, so every question and country filled evenly.
- **Tracked brands** = the 5 to 8 brands ChatGPT itself listed most often for each question, with their domains (`brands.json`).
- **Top pick** = the one brand the answer puts first as its main recommendation. It was read per answer by Jev (TypeSafe AI, `jev-latest`) as a single choice among the tracked brands the answer named, or "no single pick" when the answer says it depends or recommends several equally. Answers that named none of the tracked brands are counted as no single pick. The reads weren't hand-checked one by one; the exact instructions are in `scripts/layers.cjs`.
- **Cited** = a URL in the answer's source citations. `utm_` parameters are stripped before de-duplicating.
- **Country page** = a URL marked for that country by its pattern (`/uk/`, `.co.uk`, `/en-gb/`, `/au/`, `.com.au`, `/ca/`, `.ca`, `/de/`, `.de` and similar). A vendor counts as having a page for a country if one was cited in that country's answers, or if the vendor's most-cited page declares that country in hreflang. A case counts only when the vendor was cited in at least 5 of that country's 30 answers, and the country page "won" when more answers cited it than cited only the vendor's other pages.
- Control: 10 of the 300 US answers cited a country-specific URL.
- Germany was asked in German, so its column changes language and location together.
