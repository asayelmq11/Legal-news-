# Egress verification (M7.5) — record

**Status: not yet performed.** This file is the template and the record. It must
be filled in from the **production n8n egress address** before M8 begins.

Until then all 52 sources stay `pending_verification`, `blocked_by_access` or
`requires_subscription`, and none can be activated — the
`sources_only_verified_active` constraint enforces that.

---

## Why this exists

M3 attempted to verify source structures and could not. Every GCC government
portal probed returned `403` **from the site itself**, not from an intermediate
proxy: `zatca.gov.sa`, `moj.gov.sa`, `sama.gov.sa`, `cma.org.sa`,
`uaelegislation.gov.ae`, `almeezan.qa`. These are WAFs rejecting datacentre IP
ranges.

Writing parsers against sites the production environment cannot reach would
produce workflows that pass review and fail in service. So reachability is
established first, from the environment that will actually run.

---

## Rules

**Permitted**

- Official RSS and Atom feeds
- Documented public APIs
- Bulk or downloadable files the authority publishes
- Paid or free subscriptions taken out in the company's name
- Written allow-list access granted by the authority
- Honouring `robots.txt` and any declared crawl-delay

**Prohibited, without exception**

- CAPTCHA solving or bypass
- Anti-bot circumvention: browser-fingerprint spoofing, challenge replay,
  headless-detection evasion
- Residential or rotating proxy networks used to disguise request origin
- Credential sharing, or any access beyond what an authority has granted
- Ignoring `robots.txt`
- Request rates that degrade a public service

A source that cannot be reached lawfully **stays inactive**. That is an
acceptable outcome, recorded as `blocked_by_access` or `requires_subscription`.

For a Legal Department, how information was obtained is itself a compliance
question. Visible gaps beat covert access nobody sanctioned.

---

## Method

Run from the production n8n egress. An address that differs from production
tells you nothing.

For each source, request `base_url`, then any candidate feed path, and record:

| Column | What to record |
|---|---|
| Source | country + authority |
| Date / egress IP | so a re-test is comparable |
| Status | HTTP status of `base_url` |
| Redirects | final URL; a redirect to a portal login means blocked |
| WAF | none / challenge page / JS interstitial / rate limit / geo-block / silent empty 200 |
| robots.txt | disallowed paths relevant to the target; crawl-delay |
| Auth | none / account / paid subscription / signed agreement |
| Fixed IP | whether an allow-listed source address is required |
| Route found | rss / api / html / pdf / none |
| Outcome | `verified` · `blocked_by_access` · `requires_subscription` |

---

## Results

_Empty — to be completed in M7.5._

| Source | Date | Status | Redirects | WAF | robots | Auth | Fixed IP | Route | Outcome |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

---

## Known obstacles carried over from M3

| Source | Obstacle | Action needed |
|---|---|---|
| **Kuwait Al-Youm** (KW gazette) | No public crawlable endpoint. Distributed by paid electronic subscription and a Ministry of Information mobile app. Already set to `requires_subscription`. | Legal Department decision on taking out a subscription, or accepting the gap. This is Kuwait's authoritative gazette — it deserves an early answer. |
| **Bahrain LLOC pair** | `legalaffairs.gov.bh` and `lloc.gov.bh` are both operated by the Legislation and Legal Opinion Commission and may be mirrors. Grouped under `exclusion_group = 'bh-lloc'`; the database permits at most one active. | Compare by hand, pick the canonical one. Note the other cannot simply also be enabled — the partial unique index refuses it. |
| **Five non-government domains** — `adgm.com`, `qfcra.com`, `cma.org.sa`, `qfma.org.qa`, `gso.org.sa` | A `.com`/`.org` domain carries no implicit assurance. Flagged with `requires_authority_check = true`. | Confirm each is the genuine authority before trusting anything it publishes. |
| **Saudi WAFs** (ZATCA, MOJ, SAMA, CMA) | `403` to datacentre IPs. | Likely needs a fixed egress IP and an allow-list request to each authority. Establish before writing parsers. |

---

## Exit criteria

1. Every source has a dated fetch result from the production egress.
2. A source reaches `verified` **only** after a successful end-to-end fetch —
   reachable, parseable, lawfully accessible — from that environment.
3. Blocked and subscription-gated sources record the specific obstacle and the
   action needed to clear it.
4. Anything needing commercial or legal commitment is escalated to the Legal
   Department, not assumed.
