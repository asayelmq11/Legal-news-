# Source registry — contents and activation procedure

> **2026-08-11 — registry finalized for delivery.** The platform originally
> seeded 52 official sources (below, "Original 52-source seed") plus 12
> discovery pseudo-sources. After the production-egress verification pass and
> a final go/no-go review of every still-pending source, the **live registry
> now holds 16 official sources** (14 active, 2 pending) **+ 12 discovery
> pseudo-sources = 28 total**. 36 official sources were removed — each had a
> confirmed, unrecoverable blocker (persistent WAF/network block from the
> production egress, no discoverable RSS/JSON/HTML route after a real audit,
> or an API with no provable, non-guessed request contract) and **zero**
> `legal_updates` rows attached, checked individually before each removal. See
> [Current live registry](#current-live-registry) below for the up-to-date
> table; the per-country tables further down are the **original seed**,
> preserved for history and for anyone re-evaluating a removed source.

12 discovery pseudo-sources — one Google News legal-update feed and one
Google News case-law feed per GCC country, `ingestion_mode = 'discovery'`,
`source_type = 'discovery_engine'` — are not authorities themselves; see
[`docs/hybrid-discovery-architecture-2026-08-03.md`](../docs/hybrid-discovery-architecture-2026-08-03.md)
for the discovery layer, and `n8n/README.md` §6 for how the two interact.
`ingestion_mode` (official/discovery/hybrid) is a different axis from
`source_type` below — it classifies HOW a source is reached, not WHAT kind
of authority it is.

**Case-law discovery (migration `0026`).** One discovery pseudo-source per
GCC country (never GCC itself — a case is attributed to the country it
happened in), parallel to and fully independent of the six legal-update
discovery feeds: same `discovery_engine`/`discovery` shape, but querying
`CASE_LAW_PHRASES` (`lib/discovery/discovery.ts`) — court/ruling/precedent
terms — instead of the legislative phrase set. No judicial (Supreme/
Cassation/Public Prosecution) source exists among the official sources;
those sites sit behind the same WAFs documented in
`docs/source-provisioning-2026-08-02.md`, so discovery is the proven path
here too. Feeds "آخر القضايا" in the UI via `category = 'litigation'` — no
schema change. The classify prompt (`n8n/prompts/classify-legal-update.md`)
carries the quality bar: rejects generic crime/accident/celebrity/tabloid
content that merely mentions a court in passing, accepts only content with
genuine legal/professional value.

## Status model

Two stored facts, six displayed states. Only `verified` may be activated.

| Stored `config_status` | + `active` | UI status |
|---|---|---|
| `verified` | true | نشط — Active |
| `verified` | false | موقوف — Disabled / تم التحقق — Verified |
| `pending_verification` | false | بانتظار التحقق — Pending verification |
| `blocked_by_access` | false | محجوب — Blocked by access |
| `requires_subscription` | false | يتطلب اشتراكاً — Requires subscription |

Enforced by `sources_only_verified_active`: any non-verified status refuses
activation outright.

### Flags

- `exclusion_group` — suspected mirrors share a label; a partial unique index
  permits at most one **active** member.
- `requires_authority_check` — non-government domain, must be confirmed as the
  genuine authority. Applies to any remaining `.com`/`.org` authority domain
  (e.g. `qfcra.com`, `qfma.org.qa`) — confirm before trusting, since the
  domain itself gives no assurance.

Domain corroboration done at seed time was **registry validation only** — it
confirms an authority's identity, never that a parser works or that the site
is reachable. Only a real production-egress test establishes that (see
[`docs/EGRESS_VERIFICATION.md`](../docs/EGRESS_VERIFICATION.md)).

---

## Current live registry

**16 official sources** (14 active, 2 pending) **+ 12 discovery
pseudo-sources = 28 total.** Read live, not maintained by hand — re-run the
query below (via the production Supabase credential; no direct DB access
from this file) before trusting exact numbers, since admin edits and future
activations diverge from any static snapshot immediately.

| Country | Active | Pending | Notes |
|---|---|---|---|
| SA | 7 | 0 | 1 removed for a confirmed blocker (`gac.gov.sa`, `blocked_by_access`, kept — see below) |
| AE | 0 | 0 | all 10 original seed sources removed — no working official source found for any of them, including UAE CMA (real POST API exists but no provable request body; the plain HTML listing has no recoverable publication date) |
| KW | 2 | 1 | Kuwait Al-Youm kept `requires_subscription` — needs a Legal Department decision, not a technical fix |
| QA | 2 | 0 | |
| BH | 1 | 0 | both gazette mirrors (`legalaffairs.gov.bh`, `lloc.gov.bh`) removed — persistent block / broken domain on re-check |
| OM | 1 | 0 | Financial Services Authority (`fsa.gov.om`/`e.fsa.gov.om`) activated 2026-08-11 — POST JSON API, live-tested end-to-end via an isolated, since-deleted test workflow |
| GCC | 1 | 0 | GSO (`gso.org.sa`) active; GCC Secretariat General removed (no feed found) |

One SA source is kept `blocked_by_access` rather than removed:
**الهيئة العامة للمنافسة (`gac.gov.sa`)** returned an explicit HTTP 503
maintenance page at last audit — a transient condition, not a structural
block, and worth a simple recheck later rather than removal.

---

## Original 52-source seed

The tables below are the **as-designed seed**, preserved for history. They
no longer reflect which sources are actually configured or active — see
[Current live registry](#current-live-registry) above for that. Rows for
sources removed on 2026-08-11 are marked `[removed]`.

### Why nothing was configured at seed time

M3 required: *"Do not guess selectors or parser configuration. If a parser
cannot yet be safely defined, mark the source as pending configuration rather
than inventing selectors."*

Selectors could not be authored without loading each site and reading its
markup, and verification could not be completed from the build environment:

| Attempt | Result |
|---|---|
| Direct HTTPS from the build container | Blocked by network policy — `403` on `CONNECT` for every non-allow-listed host |
| Fetch tool against `zatca.gov.sa`, `moj.gov.sa`, `sama.gov.sa`, `cma.org.sa`, `uaelegislation.gov.ae`, `almeezan.qa` | **`403 Forbidden` from the sites themselves** — GCC government portals sit behind WAFs that reject datacentre IPs |
| Web search for official domains | **Succeeded** — domains below are corroborated |

So the seed recorded what could be established (authority, domain,
classification, cadence) and left blank what could not (parser type,
selectors, feed URLs). Guessing would have produced a registry that looks
finished, silently scrapes the wrong elements, and fills the archive with
plausible nonsense attributed to a real ministry. The 2026-08-11 finalization
resolved this the intended way: a real production-egress audit per source
(`docs/EGRESS_VERIFICATION.md`), configuring what proved reachable and
removing what did not, rather than ever inventing a selector.

---

## What was trustworthy in the seed

| Field | Status |
|---|---|
| `country`, `authority_ar`, `authority_en` | Reliable |
| `source_type`, `priority`, `poll_interval_minutes` | Reliable — deliberate classification |
| `base_url`, `allowed_domains` | Corroborated by search; re-confirmed in a browser at activation |
| `parser_type`, `parser_config`, `feed_url` | Deliberately empty at seed time — filled per source during activation |

---

## Activation procedure

The database enforces the order — you cannot skip a step.

**1. Confirm the domain.** Open `base_url` in a browser. Check it is the real
authority and the domain matches. If it has moved, update `base_url` and
`allowed_domains` together (a constraint requires the host of `base_url` to
appear in `allowed_domains`).

**2. Find the ingestion route,** in order of preference:

- **RSS/Atom** — look for `<link rel="alternate" type="application/rss+xml">`,
  or try `/rss`, `/feed`, `/ar/rss.xml`. Best case: stable and cheap.
- **JSON API** — open devtools, reload the listing, look for an XHR returning
  JSON. Common on modern portals. Record the endpoint and field paths; if it
  requires `POST` with a JSON body, `parser_config.http_method`/`http_body`
  support it (`Fetch API` node, config-driven, GET/POST allow-listed).
- **HTML listing** — fall back to CSS selectors against the listing page.
  Prefer semantic classes over generated ones; a selector like `.css-1x7f9k`
  will break on the next deploy. Confirm the listing actually carries a
  reliable, per-item publication date — a source with no recoverable date
  cannot pass the Publishing Gate's `no_publication_date` rule no matter how
  good the selectors are.
- **PDF index** — the page is a list of PDF links, typical of gazettes.

**3. Fill in the configuration.**

```sql
-- RSS
update public.sources
   set parser_type = 'rss',
       feed_url = 'https://example.gov.sa/ar/rss.xml',
       parser_config = '{"date_field":"pubDate","content_field":"description"}'::jsonb,
       config_status = 'verified', updated_at = now()
 where country = 'SA' and authority_en = '<authority>';

-- HTML listing
update public.sources
   set parser_type = 'html',
       parser_config = '{
         "list":  ".news-list .news-item",
         "title": "h3 a",
         "link":  "h3 a@href",
         "date":  ".news-date",
         "body":  ".article-content"
       }'::jsonb,
       config_status = 'verified', updated_at = now()
 where country = 'SA' and authority_en = '<authority>';

-- JSON API (GET)
update public.sources
   set parser_type = 'api',
       feed_url = 'https://example.gov.sa/api/v1/announcements',
       parser_config = '{
         "items_path":"data.results", "title":"title", "url":"link",
         "date":"published_at", "body":"summary", "headers":{}
       }'::jsonb,
       config_status = 'verified', updated_at = now()
 where country = 'SA' and authority_en = '<authority>';

-- JSON API (POST + body, and/or a URL built from more than one field —
-- see Oman FSA for a real example: url is {template, fields} where a field
-- can itself be {from, map} to translate a numeric/enum code)
update public.sources
   set parser_type = 'api',
       feed_url = 'https://example.gov.sa/api/v1/search',
       parser_config = '{
         "http_method": "POST",
         "http_body": {"page": 1},
         "items_path": "data",
         "title": "HeaderAr", "date": "IssueDate",
         "url": {"template": "https://example.gov.sa/files/{id}", "fields": {"id": "Id"}}
       }'::jsonb,
       config_status = 'verified', updated_at = now()
 where country = 'SA' and authority_en = '<authority>';

-- PDF index
update public.sources
   set parser_type = 'pdf',
       parser_config = '{"list":"a[href$=\".pdf\"]","max_pages":40}'::jsonb,
       config_status = 'verified', updated_at = now()
 where country = 'SA' and authority_en = '<authority>';
```

**4. Activate.**

```sql
update public.sources set active = true, updated_at = now()
 where country = 'SA' and authority_en = '<authority>';
```

This fails for **any** status other than `verified` — the
`sources_only_verified_active` constraint. Marking `verified` also fails if
`parser_type` is still `unknown`, or if an `html`/`pdf` source has an empty
`parser_config`. And a source in an `exclusion_group` whose sibling is already
active is refused by a partial unique index. The order cannot be circumvented.

**5. Never put decision logic in `parser_config`.** It describes *where to
read* — selectors and field paths. Thresholds, retry counts, and publish rules
belong in n8n. Check S15 fails the build if a key matching
`threshold|confidence|publish|retry|backoff|schedule|cron|enabled|filter|rule`
appears there.

---

## Seed contents (original 52 — see [Current live registry](#current-live-registry) for what's actually configured today)

52 sources · 6 official gazettes · 25 regulators · 19 government bodies ·
2 GCC-wide, as originally designed.

### Saudi Arabia (13, 8 remain)

| Authority | Domain | Type | P | Status |
|---|---|---|---|---|
| أم القرى — الجريدة الرسمية | `uqn.gov.sa` | gazette | 1 | active |
| هيئة الخبراء بمجلس الوزراء | `laws.boe.gov.sa` | government | 1 | `[removed]` |
| هيئة الزكاة والضريبة والجمارك (ZATCA) | `zatca.gov.sa` | regulator | 1 | active |
| البنك المركزي السعودي (SAMA) | `sama.gov.sa` | regulator | 1 | active |
| هيئة السوق المالية (CMA) | `cma.gov.sa` | regulator | 1 | active |
| وزارة العدل | `moj.gov.sa` | government | 2 | `[removed]` |
| وزارة التجارة | `mc.gov.sa` | government | 2 | `[removed]` |
| وزارة الموارد البشرية والتنمية الاجتماعية | `hrsd.gov.sa` | government | 2 | active |
| الهيئة العامة للمنافسة | `gac.gov.sa` | regulator | 2 | kept, `blocked_by_access` (transient 503) |
| الهيئة السعودية للبيانات والذكاء الاصطناعي (SDAIA) | `sdaia.gov.sa` | regulator | 2 | `[removed]` |
| الهيئة الوطنية للأمن السيبراني (NCA) | `nca.gov.sa` | regulator | 2 | active |
| الهيئة السعودية للملكية الفكرية (SAIP) | `saip.gov.sa` | regulator | 3 | active |
| المركز الوطني للتنافسية | `ncc.gov.sa` | government | 3 | `[removed]` |

### United Arab Emirates (10, 0 remain)

| Authority | Domain | Type | P | Status |
|---|---|---|---|---|
| منصة التشريعات | `uaelegislation.gov.ae` | gazette | 1 | `[removed]` — Cloudflare JS challenge |
| هيئة الأوراق المالية والسلع (SCA → CMA) | `uaecma.gov.ae` | regulator | 1 | `[removed]` — real POST API found, no provable request body; HTML listing has no recoverable date |
| مصرف الإمارات المركزي | `centralbank.ae` | regulator | 1 | `[removed]` — Cloudflare JS challenge |
| الهيئة الاتحادية للضرائب | `tax.gov.ae` | regulator | 1 | `[removed]` — no feed found |
| وزارة العدل | `moj.gov.ae` | government | 2 | `[removed]` — no feed found |
| وزارة الاقتصاد | `moec.gov.ae` | government | 2 | `[removed]` — persistent timeout |
| مجلس الوزراء | `uaecabinet.ae` | government | 2 | `[removed]` — Cloudflare JS challenge |
| سلطة دبي للخدمات المالية (DFSA) | `dfsa.ae` | regulator | 2 | `[removed]` — Cloudflare JS challenge |
| سوق أبوظبي العالمي (ADGM) | `adgm.com` | regulator | 2 | `[removed]` — no feed found |
| مجلس الأمن السيبراني | `csc.gov.ae` | government | 3 | `[removed]` — TLS-level network block |

### Kuwait (8, 3 remain)

| Authority | Domain | Type | P | Status |
|---|---|---|---|---|
| الكويت اليوم — الجريدة الرسمية | `e.gov.kw` | gazette | 1 | kept, `requires_subscription` |
| هيئة أسواق المال | `cma.gov.kw` | regulator | 1 | active |
| بنك الكويت المركزي | `cbk.gov.kw` | regulator | 1 | `[removed]` — persistent timeout |
| وزارة العدل | `moj.gov.kw` | government | 2 | active |
| الأمانة العامة لمجلس الوزراء | `cmgs.gov.kw` | government | 2 | `[removed]` — no feed found at corrected domain |
| وزارة التجارة والصناعة | `moci.gov.kw` | government | 2 | `[removed]` — no feed found |
| مجلس الأمة | `kna.kw` | government | 3 | `[removed]` — no feed found |
| الهيئة العامة للقوى العاملة | `manpower.gov.kw` | regulator | 3 | `[removed]` — persistent timeout |

### Qatar (7, 2 remain)

| Authority | Domain | Type | P | Status |
|---|---|---|---|---|
| الميزان — البوابة القانونية | `almeezan.qa` | gazette | 1 | `[removed]` — legacy ASP.NET site, no findable feed within a bounded VIEWSTATE-heavy page |
| مصرف قطر المركزي | `qcb.gov.qa` | regulator | 1 | `[removed]` — no feed found |
| هيئة قطر للأسواق المالية (QFMA) | `qfma.org.qa` | regulator | 1 | active |
| وزارة العدل | `moj.gov.qa` | government | 2 | `[removed]` — no feed found |
| الأمانة العامة لمجلس الوزراء | `gco.gov.qa` | government | 2 | `[removed]` — Cloudflare JS challenge |
| هيئة تنظيم مركز قطر للمال (QFCRA) | `qfcra.com` | regulator | 2 | active |
| الهيئة العامة للضرائب | `gta.gov.qa` | regulator | 2 | `[removed]` — no feed found |

### Oman (6, 1 remains)

| Authority | Domain | Type | P | Status |
|---|---|---|---|---|
| وزارة العدل والشؤون القانونية — الجريدة الرسمية | `mjla.gov.om` | gazette | 1 | `[removed]` — no feed found |
| البنك المركزي العماني | `cbo.gov.om` | regulator | 1 | `[removed]` — no feed found |
| الهيئة العامة لسوق المال → هيئة الخدمات المالية (FSA) | `fsa.gov.om` / `e.fsa.gov.om` | regulator | 1 | active — **activated 2026-08-11** |
| جهاز الضرائب | `taxoman.gov.om` | regulator | 2 | `[removed]` — 404 on base_url, no correct domain found |
| وزارة العمل | `mol.gov.om` | government | 3 | `[removed]` — no feed found |
| وزارة التجارة والصناعة وترويج الاستثمار | `moci.gov.om` | government | 3 | `[removed]` — DNS resolution failure |

### Bahrain (6, 1 remains)

| Authority | Domain | Type | P | Status |
|---|---|---|---|---|
| هيئة التشريع والرأي القانوني — الجريدة الرسمية | `legalaffairs.gov.bh` | gazette | 1 | `[removed]` — persistent HTTP 403 |
| بوابة التشريعات (LLOC) | `lloc.gov.bh` | government | 1 | `[removed]` — broken/unreachable on re-check |
| مصرف البحرين المركزي | `cbb.gov.bh` | regulator | 1 | `[removed]` — persistent HTTP 403 |
| وزارة العدل والشؤون الإسلامية والأوقاف | `moj.gov.bh` | government | 2 | active |
| الجهاز الوطني للإيرادات (NBR) | `nbr.gov.bh` | regulator | 2 | `[removed]` — persistent HTTP 403 |
| هيئة تنظيم سوق العمل (LMRA) | `lmra.gov.bh` | regulator | 3 | `[removed]` — no feed found |

### GCC-wide (2, 1 remains)

| Authority | Domain | Type | P | Status |
|---|---|---|---|---|
| الأمانة العامة لمجلس التعاون | `gcc-sg.org` | gcc | 3 | `[removed]` — no feed found |
| هيئة التقييس لدول مجلس التعاون (GSO) | `gso.org.sa` | gcc | 4 | active |

---

## Resolved / no longer applicable

- ~~Kuwait Al-Youm is `requires_subscription`~~ — still true, still kept
  pending a Legal Department decision on a paid subscription; see
  [Current live registry](#current-live-registry).
- ~~Bahrain may be listed twice~~ — resolved by removing both
  `legalaffairs.gov.bh` and `lloc.gov.bh`; Bahrain now has one official
  source (`moj.gov.bh`).
- ~~Oman's FSA was renamed~~ — confirmed: `fsa.gov.om` is current, and its
  real content API lives on the `e.fsa.gov.om` subdomain (both are in
  `allowed_domains`).
- **Commercial/non-government domains still active:** `qfma.org.qa`,
  `qfcra.com`, `gso.org.sa`. All corroborated as the genuine authority;
  `adgm.com` and the old `cma.org.sa` entry were removed/superseded.
- **Umm Al-Qura polls every 12 hours,** not hourly, because it publishes
  weekly on Fridays. Kuwait Al-Youm is the same. Everything else inherits
  its priority tier.
- **UAE now has zero official sources.** All 10 original candidates were
  removed — nine for a persistent access block or no discoverable feed, and
  UAE CMA (the one with a real, working POST JSON API) for having no
  recoverable per-item publication date anywhere in its reachable content.
  This is a known gap, not an oversight — flagged here for whoever revisits
  UAE sourcing next.

---

## Validation

`03_source_registry_checks.sql`, run by `run_local_checks.sh`, validates the
**seed/migration**, not live runtime state — S17 explicitly re-seeds and
checks that admin edits (including today's activations and removals) are
preserved rather than overwritten:

| Check | Asserts |
|---|---|
| S1–S2 | all 7 jurisdictions covered; 52 sources **in the seed** |
| S3 | no duplicate `base_url` or `feed_url` |
| S4 | one entry per authority per country |
| S5 | shared domains reported; identical domain sets rejected |
| S6 | every `base_url` host is in its own `allowed_domains` |
| S7 | no empty domain lists; all lowercase bare hostnames |
| S8 | every source resolves to a polling interval; tier map covers all priorities |
| S9 | `parser_config` is a well-formed object, consistent with `config_status` |
| **S10** | **no selectors were invented** — every unverified source has `parser_type='unknown'`, empty config, no feed URL |
| S11–S12 | nothing unverified is active, and the database refuses to activate it |
| S13 | a source cannot trust a domain it does not serve |
| S14 | the configure → verify → activate lifecycle works and each gate holds |
| S15 | no workflow logic leaked into `parser_config` |
| S16 | gazettes are on fast tiers; zero unapproved news sources |
| S17 | re-seeding adds nothing and preserves admin edits — this is *why* the 2026-08-11 removals/activation are safe: they live in the database, not the seed, and re-running the seed will not undo them |
