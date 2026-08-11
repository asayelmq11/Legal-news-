# Source registry — contents and activation procedure

52 official sources across the six GCC states and two GCC-wide bodies, plus
(M13) 6 discovery pseudo-sources — one per GCC country, `ingestion_mode =
'discovery'`, `source_type = 'discovery_engine'` — that are not authorities
themselves. Everything below describes the 52 OFFICIAL sources; see
[`docs/hybrid-discovery-architecture-2026-08-03.md`](../docs/hybrid-discovery-architecture-2026-08-03.md)
for the discovery layer, and `n8n/README.md` §6 for how the two interact.
`ingestion_mode` (official/discovery/hybrid) is a different axis from
`source_type` below — it classifies HOW a source is reached, not WHAT kind
of authority it is.

**Case-law discovery (6 more, migration `0026`).** One more discovery
pseudo-source per GCC country (never GCC itself — a case is attributed to the
country it happened in), parallel to and fully independent of the six
legal-update discovery feeds above: same `discovery_engine`/`discovery`
shape, but querying `CASE_LAW_PHRASES` (`lib/discovery/discovery.ts`) —
court/ruling/precedent terms — instead of the legislative phrase set. No
judicial (Supreme/Cassation/Public Prosecution) source exists yet among the
52 official sources; those sites are expected to sit behind the same WAFs
documented in `docs/source-provisioning-2026-08-02.md`, so discovery is the
proven path here too. Feeds "آخر القضايا" in the UI via `category =
'litigation'` — no schema change. The classify prompt (
`n8n/prompts/classify-legal-update.md`) carries the quality bar: rejects
generic crime/accident/celebrity/tabloid content that merely mentions a
court in passing, accepts only content with genuine legal/professional
value.

**Every source ships inactive and unverified.** Nothing will be crawled until a
person opens the site, works out how to read it, and switches it on — from the
production egress. This page is how that is done; the connectivity record lives
in [`docs/EGRESS_VERIFICATION.md`](../docs/EGRESS_VERIFICATION.md).

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
  permits at most one **active** member. Set on the two Bahrain LLOC candidates.
- `requires_authority_check` — non-government domain, must be confirmed as the
  genuine authority. Set on `adgm.com`, `qfcra.com`, `cma.org.sa`,
  `qfma.org.qa`, `gso.org.sa`.

Domain corroboration done in M3 was **registry validation only** — it confirms
an authority's identity, never that a parser works or that the site is
reachable. Only M7.5 establishes the latter.

---

## Why nothing is configured yet

M3 required: *"Do not guess selectors or parser configuration. If a parser
cannot yet be safely defined, mark the source as pending configuration rather
than inventing selectors."*

Selectors cannot be authored without loading each site and reading its markup.
Verification was attempted and **could not be completed** from the build
environment:

| Attempt | Result |
|---|---|
| Direct HTTPS from the build container | Blocked by network policy — `403` on `CONNECT` for every non-allow-listed host |
| Fetch tool against `zatca.gov.sa`, `moj.gov.sa`, `sama.gov.sa`, `cma.org.sa`, `uaelegislation.gov.ae`, `almeezan.qa` | **`403 Forbidden` from the sites themselves** — GCC government portals sit behind WAFs that reject datacentre IPs |
| Web search for official domains | **Succeeded** — domains below are corroborated |

So the registry records what could be established (authority, domain,
classification, cadence) and leaves blank what could not (parser type,
selectors, feed URLs). Guessing would have produced a registry that looks
finished, silently scrapes the wrong elements, and fills the archive with
plausible nonsense attributed to a real ministry.

**The WAF finding matters for M8.** n8n will hit the same blocks unless it runs
from an egress address these sites accept. Establish that before configuring
parsers — it may require a fixed IP, an allow-list request, or an on-premises
runner.

---

## What is trustworthy in the seed

| Field | Status |
|---|---|
| `country`, `authority_ar`, `authority_en` | Reliable |
| `source_type`, `priority`, `poll_interval_minutes` | Reliable — deliberate classification |
| `base_url`, `allowed_domains` | Corroborated by search; **re-confirm in a browser at activation** |
| `parser_type`, `parser_config`, `feed_url` | **Deliberately empty.** Must be filled by a human |

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
  JSON. Common on modern portals. Record the endpoint and field paths.
- **HTML listing** — fall back to CSS selectors against the listing page.
  Prefer semantic classes over generated ones; a selector like `.css-1x7f9k`
  will break on the next deploy.
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

-- JSON API
update public.sources
   set parser_type = 'api',
       feed_url = 'https://example.gov.sa/api/v1/announcements',
       parser_config = '{
         "items_path":"data.results", "title":"title", "url":"link",
         "date":"published_at", "body":"summary", "headers":{}
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

## Contents

52 sources · 6 official gazettes · 25 regulators · 19 government bodies ·
2 GCC-wide. Zero news sources — none have been approved yet, and the platform
trusts nothing that is not in this table.

### Saudi Arabia (13)

| Authority | Domain | Type | P |
|---|---|---|---|
| أم القرى — الجريدة الرسمية | `uqn.gov.sa` | gazette | 1 |
| هيئة الخبراء بمجلس الوزراء | `laws.boe.gov.sa` | government | 1 |
| هيئة الزكاة والضريبة والجمارك (ZATCA) | `zatca.gov.sa` | regulator | 1 |
| البنك المركزي السعودي (SAMA) | `sama.gov.sa` | regulator | 1 |
| هيئة السوق المالية (CMA) | `cma.org.sa` | regulator | 1 |
| وزارة العدل | `moj.gov.sa` | government | 2 |
| وزارة التجارة | `mc.gov.sa` | government | 2 |
| وزارة الموارد البشرية والتنمية الاجتماعية | `hrsd.gov.sa` | government | 2 |
| الهيئة العامة للمنافسة | `gac.gov.sa` | regulator | 2 |
| الهيئة السعودية للبيانات والذكاء الاصطناعي (SDAIA) | `sdaia.gov.sa` | regulator | 2 |
| الهيئة الوطنية للأمن السيبراني (NCA) | `nca.gov.sa` | regulator | 2 |
| الهيئة السعودية للملكية الفكرية (SAIP) | `saip.gov.sa` | regulator | 3 |
| المركز الوطني للتنافسية | `ncc.gov.sa` | government | 3 |

### United Arab Emirates (10)

| Authority | Domain | Type | P |
|---|---|---|---|
| منصة التشريعات | `uaelegislation.gov.ae` | gazette | 1 |
| هيئة الأوراق المالية والسلع (SCA) | `sca.gov.ae` | regulator | 1 |
| مصرف الإمارات المركزي | `centralbank.ae` | regulator | 1 |
| الهيئة الاتحادية للضرائب | `tax.gov.ae` | regulator | 1 |
| وزارة العدل | `moj.gov.ae` | government | 2 |
| وزارة الاقتصاد | `moec.gov.ae` | government | 2 |
| مجلس الوزراء | `uaecabinet.ae` | government | 2 |
| سلطة دبي للخدمات المالية (DFSA) | `dfsa.ae` | regulator | 2 |
| سوق أبوظبي العالمي (ADGM) | `adgm.com` | regulator | 2 |
| مجلس الأمن السيبراني | `csc.gov.ae` | government | 3 |

### Kuwait (8)

| Authority | Domain | Type | P |
|---|---|---|---|
| الكويت اليوم — الجريدة الرسمية | `e.gov.kw` | gazette | 1 |
| هيئة أسواق المال | `cma.gov.kw` | regulator | 1 |
| بنك الكويت المركزي | `cbk.gov.kw` | regulator | 1 |
| وزارة العدل | `moj.gov.kw` | government | 2 |
| الأمانة العامة لمجلس الوزراء | `cmgs.gov.kw` | government | 2 |
| وزارة التجارة والصناعة | `moci.gov.kw` | government | 2 |
| مجلس الأمة | `kna.kw` | government | 3 |
| الهيئة العامة للقوى العاملة | `manpower.gov.kw` | regulator | 3 |

### Qatar (7)

| Authority | Domain | Type | P |
|---|---|---|---|
| الميزان — البوابة القانونية | `almeezan.qa` | gazette | 1 |
| مصرف قطر المركزي | `qcb.gov.qa` | regulator | 1 |
| هيئة قطر للأسواق المالية (QFMA) | `qfma.org.qa` | regulator | 1 |
| وزارة العدل | `moj.gov.qa` | government | 2 |
| الأمانة العامة لمجلس الوزراء | `gco.gov.qa` | government | 2 |
| هيئة تنظيم مركز قطر للمال (QFCRA) | `qfcra.com` | regulator | 2 |
| الهيئة العامة للضرائب | `gta.gov.qa` | regulator | 2 |

### Oman (6)

| Authority | Domain | Type | P |
|---|---|---|---|
| وزارة العدل والشؤون القانونية — الجريدة الرسمية | `mjla.gov.om` | gazette | 1 |
| البنك المركزي العماني | `cbo.gov.om` | regulator | 1 |
| الهيئة العامة لسوق المال | `fsa.gov.om` | regulator | 1 |
| جهاز الضرائب | `taxoman.gov.om` | regulator | 2 |
| وزارة العمل | `mol.gov.om` | government | 3 |
| وزارة التجارة والصناعة وترويج الاستثمار | `moci.gov.om` | government | 3 |

### Bahrain (6)

| Authority | Domain | Type | P |
|---|---|---|---|
| هيئة التشريع والرأي القانوني — الجريدة الرسمية | `legalaffairs.gov.bh` | gazette | 1 |
| بوابة التشريعات (LLOC) | `lloc.gov.bh` | government | 1 |
| مصرف البحرين المركزي | `cbb.gov.bh` | regulator | 1 |
| وزارة العدل والشؤون الإسلامية والأوقاف | `moj.gov.bh` | government | 2 |
| الجهاز الوطني للإيرادات (NBR) | `nbr.gov.bh` | regulator | 2 |
| هيئة تنظيم سوق العمل (LMRA) | `lmra.gov.bh` | regulator | 3 |

### GCC-wide (2)

| Authority | Domain | Type | P |
|---|---|---|---|
| الأمانة العامة لمجلس التعاون | `gcc-sg.org` | gcc | 3 |
| هيئة التقييس لدول مجلس التعاون (GSO) | `gso.org.sa` | gcc | 4 |

---

## Things to resolve at activation

Recorded in each source's `notes` column so they surface in the admin panel.

**Kuwait Al-Youm is `requires_subscription`.** The gazette is distributed
by paid electronic subscription and a Ministry of Information mobile app; the
`e.gov.kw` entry is the subscription service, not a readable index. An
ingestion route must be agreed with the Legal Department — it may need a
subscribed account. This is the one source that may not be automatable at all,
and it is Kuwait's authoritative gazette, so it deserves an early decision.

**Bahrain may be listed twice.** `legalaffairs.gov.bh` and `lloc.gov.bh` are
both operated by the Legislation and Legal Opinion Commission. If one mirrors
the other, monitoring both will double-ingest the same instrument under two
`content_hash` values — the hash includes the URL, so deduplication will not
catch it. Decide which is canonical and deactivate the other.

**Three authorities use commercial or non-government domains** — `adgm.com`,
`qfcra.com`, `cma.org.sa`, `qfma.org.qa`, `gso.org.sa`. All are believed
legitimate, but confirm each is the genuine authority site before trusting it,
precisely because the domain gives no assurance.

**Oman's FSA was renamed** from the Capital Market Authority. Confirm
`fsa.gov.om` is current.

**Umm Al-Qura polls every 12 hours,** not hourly, because it publishes weekly on
Fridays. Kuwait Al-Youm is the same. Everything else inherits its priority tier.

---

## Validation

`03_source_registry_checks.sql`, run by `run_local_checks.sh`, covers the seven
required checks plus the M3 safety guarantee:

| Check | Asserts |
|---|---|
| S1–S2 | all 7 jurisdictions covered; 52 sources |
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
| S17 | re-seeding adds nothing and preserves admin edits |
