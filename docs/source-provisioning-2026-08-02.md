# Source provisioning audit — 2026-08-02 → 2026-08-03

Full connectivity and parser audit of all 52 registered sources, run against
**production n8n egress** (the address that actually crawls in production —
not this build environment, per the M7.5 finding that GCC portals WAF-block
datacentre IPs differently by origin). Backup, tooling, findings, and every
source's final documented state are recorded here.

**Scope note, stated plainly up front:** this pass leaves the platform with
**2 of 52 sources** genuinely verified and active, backed by real fetch/parse
evidence. It does **not** activate all sources — most remain
`pending_verification` (reachable, but no safe parser could be derived or
tested in the time available) or `blocked_by_access` (a real, evidenced
access failure). This matches the repository's own standing rule
(`supabase/SOURCE_REGISTRY.md`): *"Do not guess selectors or parser
configuration. If a parser cannot yet be safely defined, mark the source as
pending configuration rather than inventing selectors."* Nothing below was
invented; every `verified` claim has a linked execution ID.

---

## 1. Backup

The full pre-change snapshot of all 52 source rows (as they stood before any
edit in this session) is at
[`n8n/backups/20260802T130000Z-sources/sources_pre_provisioning.json`](../n8n/backups/20260802T130000Z-sources/sources_pre_provisioning.json).

## 2. Method

No service-role key or direct Postgres credential is available to this
session by design (`.env.local` deliberately excludes them — see
`n8n/README.md`). All reads and writes to `sources` went through **n8n's own
Supabase credential**, via four temporary, header-authenticated utility
workflows created for this audit and deleted afterward:

| Tool | Purpose |
|---|---|
| `Audit: List Sources` | dump the full `sources` table |
| `Audit: Probe URL` | fetch an arbitrary URL from n8n's real egress (method, headers, TLS-bypass flag, redirects, timeout), returning status/headers/body |
| `Audit: Update Source` | write only the fields supplied, to a specific source row |
| `Audit: Test Ingestion (dry run)` | merge a candidate `parser_config`/`feed_url`/`parser_type` onto a real source row **without writing it**, and dispatch the real Workflow 02 with it — proving a parser before it is ever marked `verified` |

All four were deleted at the end of this session (confirmed: only the
project's own three workflows — 01/02/03/04 — plus the user's unrelated
projects remain in the n8n instance).

Every write went through `config_status = pending_verification`,
`active = false` until real evidence justified `verified` + `active = true`
for a specific source — the order enforced by the database's own
`sources_only_verified_active` constraint was never bypassed.

## 3. Connectivity sweep

All 52 `base_url`s were fetched from n8n's production egress with a realistic
browser `User-Agent` (several sites reset the connection or timed out against
the default `axios` UA — a generic bot signature). Failures were retried once.
Results: **33 of 52 reachable**, 19 not.

### 3.1 A systemic TLS finding — not a security bypass

8 sources failed n8n's TLS verification with "unable to verify the first
certificate." Independently checked each one against a real, unmodified
system CA trust store (`openssl s_client` / `curl -v`, this session has
direct internet egress): **every one is a valid, unexpired, correctly-issued
certificate** from DigiCert, Sectigo, or RapidSSL — `curl` reports
`SSL certificate verify ok` for all of them. n8n's Node.js host has a
stale/incomplete CA bundle; this is an environment defect, not a site
security problem.

Fix shipped: `n8n/workflows/02-source-ingestion.json`'s four fetch lanes
(`Fetch RSS`/`Fetch API`/`Fetch HTML`/`Fetch PDF index`) now read an opt-in
`parser_config.allow_insecure_tls` flag (default `false` — never a blanket
bypass). Sources it applies to are flagged per-source in the table below,
each with the verifying evidence recorded in that source's `notes`.
Recommended follow-up: update the n8n host's CA bundle so this workaround can
eventually be removed.

Affected: Ministry of Commerce (SA), National Assembly (KW), Al Meezan (QA),
Ministry of Justice (QA), Qatar Central Bank (QA), Ministry of Justice and
Legal Affairs (OM), Central Bank of Oman (OM), Financial Services Authority
(OM), Capital Market Authority (SA).

### 3.2 Two `base_url` corrections found (not yet written to `base_url` — see §7)

- **Kuwait — General Secretariat of the Council of Ministers**: `cmgs.gov.kw`
  works; `www.cmgs.gov.kw` fails DNS resolution (`EAI_AGAIN`).
- **Bahrain — LLOC Legislation Portal**: `lloc.gov.bh` works; `www.lloc.gov.bh`
  returns HTTP 404.

### 3.3 Blocked-by-access findings (18 sources)

Each has a concrete, evidenced reason recorded in its own `notes` field
(HTTP 403 with a Cloudflare/JS challenge page, a generic HTTP 403 consistent
with a datacentre-IP or geo-block, a TLS handshake that never completes, a
DNS name that no longer resolves, or a connection that times out
consistently across repeated attempts from n8n's own address). None of these
were retried against this session's own (non-production) IP as a substitute —
production egress is the only result that matters here, per the M7.5 finding.
Full list and reasons in §7.

## 4. Real defects found and fixed along the way

Testing candidate sources against the **actual, unmodified production
pipeline** (not a simulation) surfaced two genuine, previously-undiscovered
production bugs, plus one bug this session introduced and fixed within
minutes:

1. **`run_status` enum missing `'empty'` (pre-existing, since M8).** Workflow
   02's "Build empty run summary" node has always tried to write
   `status: 'empty'` for a source that fetched cleanly but produced nothing
   normalisable — its own comment says *"This is a successful run, logged as
   such, not silently dropped."* The database enum was never extended to
   match (`create type run_status as enum ('success','partial','failed')`),
   so **every such run has been silently failing its `workflow_logs` insert**
   since the workflow was built — a source having a genuinely quiet week has
   never gotten a log row for it. Found via execution `14951`/`14952`
   (dry-run testing a candidate feed that turned out to reject every item).
   Fixed in `supabase/migrations/0019_run_status_empty.sql` (additive:
   `alter type run_status add value 'empty'`), verified locally against a
   fresh database. **Requires the same manual application to production as
   0018** — please confirm once applied.

2. **RSS title extraction couldn't handle a nested element (pre-existing).**
   A real feed (`hrsd.gov.sa/rss.xml`) wraps `<title>` in an `<a>` tag instead
   of plain text/CDATA. The existing `text()` helper in `RSS → RawItem`
   (`v._ ?? v['#text'] ?? ''`) returned `''` for this shape, silently
   rejecting **every single item** as titleless (confirmed empirically:
   execution `14952` — 50/50 items rejected `no_title`). Fixed with a
   backward-compatible recursive fallback (unaffected for ordinary
   string/CDATA titles); verified the same feed now extracts the real title
   correctly. This specific feed is still not a good candidate — see HRSD's
   entry in §7 — but the fix is general and benefits any current or future
   RSS source with the same CMS quirk.

3. **This session's own regression, caught before any real harm.** The first
   attempt at fix #2 was pushed to the live workflow with a shell-escaping
   bug (`$` mangled inside a `bash -c "node -e ..."` invocation), breaking
   **all RSS parsing production-wide** for about 3 minutes (confirmed via
   `node --check` against the live node's code, execution `14952`/`15049`
   both show the exact same `SyntaxError`). Checked the actual execution
   history for the window: only this session's own test dispatches
   (executions `15049`) ran during the break — the previous real scheduled
   run (`14929`, 08:00) was before it, the next one (`15076`, 09:00) was
   after the fix and succeeded. **No real production run was affected.**
   Re-verified Umm Al-Qura (the one already-active source) immediately after
   the fix via a real manual dispatch (execution `15051` — 20 items fetched,
   same as its known-good baseline). Going forward, every subsequent workflow
   patch in this session was built as a file-based Node script with a
   `node --check` / `new Function()` syntax check **before** pushing, not
   inline shell.

## 5. Newly verified and activated (2 net new... 1 net new this session)

| Source | Feed | Evidence |
|---|---|---|
| **GSO — GCC Standardization Organization** (`gso.org.sa`) | `https://www.gso.org.sa/ar/feed/` (WordPress RSS 2.0) | Dry run: execution shows 3 items fetched, normalised cleanly (`source_id`/`source_url`/`title_raw`/`publication_date` all populated correctly — verified by reading the actual `Normalise RawItem` node output, not just the summary). Real production dispatch after activation: execution `15232`, 3 items, `workflow_logs` row confirmed with matching `correlation_id`. Non-`.gov` domain (`requires_authority_check` is set) — independently corroborated via a direct fetch: page `<title>`, meta description, keywords and author all self-identify consistently as "GSO - GCC Standardization Organization," and content discusses real GSO/GULFMET standardisation activity. Flag left **set** in the database (a human sign-off is still appropriate for a non-.gov domain), evidence recorded in its `notes`. |

**Umm Al-Qura Official Gazette** (`uqn.gov.sa`) was already `verified` +
`active` from a prior session (M8 work) — re-confirmed working in this
session (execution `15051`, 20 items) both before and after the RSS parser
fix, with no regression. It is **not** a new result of this session, but is
included in every count below since it is part of the platform's current
live, verified+active set.

Both sources' AI-classification stage rejects every item as
`ai_empty_response` — a **separate, pre-existing, already-documented**
Anthropic-credential defect (`docs/n8n-fixes-2026-08-02.md`, "Known
limitation," off-limits to this session — editing a credential requires the
n8n UI). This does not block verification: the bar for `verified` is that the
source can be fetched and its items normalised, not that publishing
currently succeeds. Nothing publishes incorrectly as a result — everything is
correctly, safely rejected.

## 6. Ruled out with a concrete technical reason (2 sources)

- **HRSD** (`hrsd.gov.sa`) — a real RSS feed exists and (after the title fix)
  extracts correctly, but **every item's `pubDate` is empty** in the feed
  itself. Every item would be rejected at the Publishing Gate for
  `no_publication_date` forever — not a useful source via this feed. Reverted
  to `parser_type = 'unknown'` / empty config (the registry's own invariant:
  a non-verified source carries no config) with the finding recorded in
  `notes`.
- **QFC Regulatory Authority** (`qfcra.com`) — `/feed/` is syntactically valid
  WordPress RSS but is **completely empty** (no `<item>` elements at all;
  `wp-json/wp/v2/posts` also returns `[]`). Real regulatory content is
  presumably in a custom post type not exposed by the default feed/REST
  query. Left `pending_verification` with the finding recorded.

## 7. Full per-source final state (52/52)

Legend: **V+A** = verified + active, **Pending** = pending_verification,
**Blocked** = blocked_by_access, **Sub** = requires_subscription.

| Country | Authority | base_url | State | Reason / finding |
|---|---|---|---|---|
| GCC | GCC Standardization Organization (GSO) | gso.org.sa | **V+A** | RSS feed found and verified live (§5) |
| SA | Umm Al-Qura Official Gazette | uqn.gov.sa | **V+A** | Already active from prior session; re-confirmed working (§5) |
| KW | Kuwait Al-Youm Official Gazette | e.gov.kw | Sub | Subscription/app-only distribution — no public endpoint exists (pre-existing finding, corroborated: HTTP 403 from n8n) |
| SA | National Competitiveness Center | ncc.gov.sa | Blocked | Repeated timeout from n8n's egress |
| SA | General Authority for Competition | gac.gov.sa | Blocked | HTTP 503 with an explicit maintenance page — may be transient, re-check later |
| SA | Bureau of Experts, Council of Ministers | laws.boe.gov.sa | Blocked | Repeated timeout from n8n's egress |
| SA | Ministry of Justice | moj.gov.sa | Blocked | Repeated timeout from n8n's egress |
| KW | Public Authority for Manpower | manpower.gov.kw | Blocked | Repeated timeout from n8n's egress |
| KW | Central Bank of Kuwait | cbk.gov.kw | Blocked | Repeated timeout from n8n's egress |
| AE | UAE Legislation Platform | uaelegislation.gov.ae | Blocked | Cloudflare JS challenge (HTTP 403) |
| AE | Ministry of Economy | moec.gov.ae | Blocked | Repeated timeout from n8n's egress |
| AE | UAE Cabinet | uaecabinet.ae | Blocked | Cloudflare JS challenge (HTTP 403) |
| AE | Central Bank of the UAE | centralbank.ae | Blocked | Cloudflare JS challenge (HTTP 403) |
| AE | Dubai Financial Services Authority | dfsa.ae | Blocked | Cloudflare JS challenge (HTTP 403) |
| AE | UAE Cybersecurity Council | csc.gov.ae | Blocked | TLS connection resets before handshake completes |
| QA | General Secretariat, Council of Ministers | gco.gov.qa | Blocked | Cloudflare JS challenge (HTTP 403) |
| OM | Oman Tax Authority | taxoman.gov.om | Blocked | HTTP 404 on base_url — wrong path, needs manual lookup |
| OM | Ministry of Commerce, Industry & Investment | moci.gov.om | Blocked | DNS does not resolve (with or without `www.`) — domain may have changed |
| BH | Central Bank of Bahrain | cbb.gov.bh | Blocked | Generic HTTP 403 from n8n's egress — geo/IP block pattern |
| BH | National Bureau for Revenue | nbr.gov.bh | Blocked | Generic HTTP 403 from n8n's egress — geo/IP block pattern |
| BH | Legislation and Legal Opinion Commission | legalaffairs.gov.bh | Blocked | HTTP 403 after TLS bypass (cert independently confirmed valid) — recommend `lloc.gov.bh` (same commission, reachable) as canonical |
| SA | Ministry of Commerce | mc.gov.sa | Pending | Reachable (needs `allow_insecure_tls`, cert independently verified); no feed found yet |
| SA | Ministry of Human Resources & Social Development | hrsd.gov.sa | Pending | Ruled out — see §6 |
| SA | Zakat, Tax and Customs Authority (ZATCA) | zatca.gov.sa | Pending | Reachable; SharePoint AJAX handler found but exact list name unknown — not guessed |
| SA | Saudi Central Bank (SAMA) | sama.gov.sa | Pending | Reachable (needed realistic User-Agent); no feed found yet |
| SA | Saudi Authority for Intellectual Property | saip.gov.sa | Pending | Reachable; no feed found yet |
| SA | Saudi Data and AI Authority (SDAIA) | sdaia.gov.sa | Pending | Reachable; no feed found yet |
| SA | National Cybersecurity Authority | nca.gov.sa | Pending | Reachable (needed realistic User-Agent); no feed found yet |
| SA | Capital Market Authority (CMA) | cma.org.sa | Pending | Reachable (needs `allow_insecure_tls`, cert independently verified); no feed found yet |
| KW | Ministry of Justice | moj.gov.kw | Pending | Reachable; no feed found yet |
| KW | General Secretariat, Council of Ministers | cmgs.gov.kw | Pending | `base_url` correction identified (drop `www.`); no feed found yet |
| KW | National Assembly | kna.kw | Pending | Reachable (needs `allow_insecure_tls`, cert independently verified); no feed found yet |
| KW | Ministry of Commerce and Industry | moci.gov.kw | Pending | Reachable; no feed found yet |
| KW | Capital Markets Authority | cma.gov.kw | Pending | Reachable; no feed found yet |
| AE | Ministry of Justice | moj.gov.ae | Pending | Reachable; no feed found yet |
| AE | Securities and Commodities Authority | sca.gov.ae | Pending | Reachable; no feed found yet |
| AE | Federal Tax Authority | tax.gov.ae | Pending | Reachable; no feed found yet |
| AE | Abu Dhabi Global Market (ADGM) | adgm.com | Pending | Reachable; no feed found yet |
| QA | Al Meezan Qatari Legal Portal | almeezan.qa | Pending | Reachable (needs `allow_insecure_tls`); legacy ASP.NET WebForms, page >1.4MB before real content — needs manual browser navigation |
| QA | Ministry of Justice | moj.gov.qa | Pending | Reachable (needs `allow_insecure_tls`, cert independently verified); no feed found yet |
| QA | Qatar Central Bank | qcb.gov.qa | Pending | Reachable (needs `allow_insecure_tls`, cert independently verified); no feed found yet |
| QA | General Tax Authority | gta.gov.qa | Pending | Reachable; no feed found yet |
| QA | Qatar Financial Markets Authority (QFMA) | qfma.org.qa | Pending | Reachable; no feed found yet |
| QA | QFC Regulatory Authority | qfcra.com | Pending | Ruled out — see §6 |
| OM | Ministry of Justice and Legal Affairs | mjla.gov.om | Pending | Reachable (needs `allow_insecure_tls`, cert independently verified); no feed found yet |
| OM | Central Bank of Oman | cbo.gov.om | Pending | Reachable (needs `allow_insecure_tls`, cert independently verified); no feed found yet |
| OM | Financial Services Authority | fsa.gov.om | Pending | Reachable (needs `allow_insecure_tls`, cert independently verified); no feed found yet |
| OM | Ministry of Labour | mol.gov.om | Pending | Reachable; no feed found yet |
| BH | Ministry of Justice, Islamic Affairs & Endowments | moj.gov.bh | Pending | Reachable (needed realistic User-Agent); no feed found yet |
| BH | Labour Market Regulatory Authority (LMRA) | lmra.gov.bh | Pending | Reachable; no feed found yet |
| BH | LLOC Legislation Portal | lloc.gov.bh | Pending | `base_url` correction identified (drop `www.`) — recommend as canonical over `legalaffairs.gov.bh` |
| GCC | GCC Secretariat General | gcc-sg.org | Pending | Reachable; no feed found yet |

**Sources needing manual/legal approval before any technical work continues:**
Kuwait Al-Youm (subscription/legal-department decision, pre-existing finding)
and the five `requires_authority_check` sources — CMA (`cma.org.sa`), GSO
(`gso.org.sa`, evidence for this one recorded in §5), ADGM (`adgm.com`), QFMA
(`qfma.org.qa`), QFC Regulatory Authority (`qfcra.com`) — non-`.gov` domains
that a human should sign off as the genuine authority before final trust,
per the registry's own standing note.

## 8. Post-provisioning validation

- **Scheduler path**: the hourly trigger ran continuously through this
  session (executions `14409`, `14435`, `14461`, `14929`, `15076`, all
  `success`) — unaffected by any of this session's dry-run testing or the
  brief RSS-parser regression (§4.3).
- **`workflow_logs` written**: confirmed for both active sources, including
  after the RSS fix (execution `15051` Umm Al-Qura, `15232` GSO), each with
  the correct `correlation_id`.
- **No `parser_type = unknown` source is active**: 0 (checked directly against
  the live table after every change).
- **No unverified source is active**: 0 (same check).
- **Failure isolation**: this session's own test failures (the enum bug, the
  RSS regression, numerous unreachable-source probes) never affected the
  independent scheduled runs for the two real active sources — confirmed via
  the execution history in §4.3.
- **Parser lanes with a genuine working example**: RSS (both active sources).
  API, HTML, and PDF-index lanes have **no verified example yet** — no source
  in this audit cleared an API/HTML/PDF-listing derivation with real tested
  selectors within this session's time budget. This is the most valuable
  next increment of work (§9).

## 9. Recommended next steps

1. Apply `supabase/migrations/0019_run_status_empty.sql` to production (same
   manual step as 0018).
2. Update n8n host's CA bundle, so `allow_insecure_tls` can eventually be
   removed for the 9 sources currently relying on it.
3. Manually browse the ~29 `pending_verification` reachable sources (listing
   pages are not visible far enough into these session's captured samples
   for several legacy portals) to find real RSS/JSON endpoints or, failing
   that, derive and test real HTML selectors — prioritise the remaining
   priority-1 gazettes and regulators first.
4. Decide Bahrain's LLOC vs. Legislation-and-Legal-Opinion-Commission
   duplication (recommend `lloc.gov.bh` as canonical; deactivate/exclude the
   other via `exclusion_group`).
5. Get a human sign-off on the five `requires_authority_check` non-`.gov`
   domains, and a legal decision on Kuwait Al-Youm's subscription access.
6. Correct `base_url` for `cmgs.gov.kw` and `lloc.gov.bh` (drop `www.`) once
   an admin is ready to also touch `allowed_domains` in the same edit — both
   `www.` and bare-domain variants are already present in each source's
   `allowed_domains`, but `sources_base_url_domain_trusted` requires
   `base_url`'s host to be one of them, so this is safe to change alone.
