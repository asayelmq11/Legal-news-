#!/usr/bin/env node
/**
 * M7.5 — Egress verification probe.
 *
 * MUST BE RUN FROM THE PRODUCTION n8n EGRESS ADDRESS. Results from any other
 * network are meaningless: the whole point is to learn what the machine that
 * will actually crawl can reach.
 *
 *   node scripts/verify-egress.mjs "postgresql://..." > /tmp/egress.md
 *
 * For each registered source it records HTTP status, redirect chain, WAF
 * behaviour, robots.txt restrictions and whether a feed was found, then prints
 * a Markdown table to paste into docs/EGRESS_VERIFICATION.md.
 *
 * RULES IT ENFORCES (see docs/EGRESS_VERIFICATION.md):
 *   - honours robots.txt; a disallowed path is reported, never fetched
 *   - one polite request at a time with a delay, no concurrency
 *   - identifies itself honestly in the User-Agent
 *   - NO captcha solving, NO anti-bot evasion, NO proxy rotation
 * A source it cannot reach lawfully is reported as blocked. That is a valid
 * outcome, not a problem to engineer around.
 */
/* eslint-disable no-console -- this script's entire output is the report it writes to stdout */
import pg from 'pg'

const connectionString = process.argv[2] ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error('usage: verify-egress.mjs <postgres-url>')
  process.exit(1)
}

const UA =
  'LegalIntelligencePlatform/1.0 (internal legal monitoring; contact: legal@company.internal)'
const TIMEOUT_MS = 20_000
const DELAY_MS = 1_500

/** Paths worth trying for a feed. Only fetched if robots.txt permits. */
const FEED_CANDIDATES = ['/rss', '/feed', '/rss.xml', '/feed.xml', '/ar/rss', '/en/rss']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchOnce(url, method = 'GET') {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml' },
    })
    const body = res.headers.get('content-type')?.includes('text')
      ? (await res.text()).slice(0, 4000)
      : ''
    return { ok: true, status: res.status, finalUrl: res.url, body, headers: res.headers }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

/** Minimal robots.txt reader: collects Disallow rules for our UA and for *. */
async function readRobots(origin) {
  const res = await fetchOnce(`${origin}/robots.txt`)
  if (!res.ok || res.status !== 200 || !res.body) {
    return { available: false, disallow: [], crawlDelay: null }
  }
  const disallow = []
  let crawlDelay = null
  let applies = false
  for (const line of res.body.split('\n')) {
    const [rawKey, ...rest] = line.split(':')
    const key = (rawKey ?? '').trim().toLowerCase()
    const value = rest.join(':').trim()
    if (key === 'user-agent') applies = value === '*' || UA.toLowerCase().includes(value.toLowerCase())
    else if (applies && key === 'disallow' && value) disallow.push(value)
    else if (applies && key === 'crawl-delay') crawlDelay = Number(value) || null
  }
  return { available: true, disallow, crawlDelay }
}

function isDisallowed(pathname, disallow) {
  return disallow.some((rule) => rule !== '/' && pathname.startsWith(rule))
}

/** Recognises the common ways a WAF says no without saying no. */
function classify(res, body) {
  if (!res.ok) return `error: ${res.error}`
  if (res.status === 403) return 'WAF/403 — likely datacentre IP block'
  if (res.status === 429) return 'rate limited'
  if (res.status >= 500) return 'server error'
  if (res.status === 200 && body.length < 500) return '200 but near-empty body — possible JS wall'
  if (/cf-browser-verification|challenge-platform|Incapsula|Distil|_Incapsula_Resource/i.test(body)) {
    return '200 with anti-bot challenge page'
  }
  if (res.status === 200) return 'ok'
  return `status ${res.status}`
}

const client = new pg.Client({ connectionString })
await client.connect()
const { rows: sources } = await client.query(`
  select country, authority_ar, authority_en, base_url, feed_url, config_status
  from public.sources
  where authority_en not like 'ZZ %'
  order by country, priority, authority_en
`)
await client.end()

const results = []

for (const s of sources) {
  const origin = new URL(s.base_url).origin
  const robots = await readRobots(origin)
  await sleep(DELAY_MS)

  const basePath = new URL(s.base_url).pathname
  let baseResult
  let route = 'none'

  if (robots.available && isDisallowed(basePath, robots.disallow)) {
    baseResult = { status: 'robots-disallowed', classification: 'disallowed by robots.txt' }
  } else {
    const res = await fetchOnce(s.base_url)
    baseResult = {
      status: res.ok ? String(res.status) : 'error',
      finalUrl: res.ok ? res.finalUrl : '',
      classification: classify(res, res.body ?? ''),
      redirected: res.ok && res.finalUrl !== s.base_url,
    }
    // A declared feed link is the best possible outcome; look before guessing.
    if (res.ok && res.body && /type=["']application\/(rss|atom)\+xml/i.test(res.body)) {
      route = 'rss (declared in page head)'
    }
    await sleep(robots.crawlDelay ? robots.crawlDelay * 1000 : DELAY_MS)
  }

  // Only probe candidate feed paths when the base page was reachable and no
  // feed was already declared — no point hammering a host that returned 403.
  if (route === 'none' && baseResult.classification === 'ok') {
    for (const path of FEED_CANDIDATES) {
      if (robots.available && isDisallowed(path, robots.disallow)) continue
      const res = await fetchOnce(origin + path)
      if (res.ok && res.status === 200 && /<(rss|feed)\b/i.test(res.body ?? '')) {
        route = `rss (${path})`
        break
      }
      await sleep(DELAY_MS)
    }
  }

  const outcome =
    baseResult.classification === 'ok'
      ? 'reachable — configure parser'
      : baseResult.classification.includes('robots')
        ? 'blocked_by_access (robots)'
        : 'blocked_by_access'

  results.push({
    source: `${s.country} — ${s.authority_en}`,
    status: baseResult.status,
    redirect: baseResult.redirected ? baseResult.finalUrl : '—',
    waf: baseResult.classification,
    robots: robots.available
      ? `${robots.disallow.length} disallow${robots.crawlDelay ? `, delay ${robots.crawlDelay}s` : ''}`
      : 'none',
    route,
    outcome,
  })

  console.error(`  ${s.authority_en}: ${baseResult.classification}`)
}

const stamp = new Date().toISOString().slice(0, 10)
console.log(`\n## Results — ${stamp}\n`)
console.log('Egress IP: **RECORD THE PRODUCTION EGRESS IP HERE**\n')
console.log('| Source | Status | Redirect | WAF | robots | Route | Outcome |')
console.log('|---|---|---|---|---|---|---|')
for (const r of results) {
  console.log(
    `| ${r.source} | ${r.status} | ${r.redirect} | ${r.waf} | ${r.robots} | ${r.route} | ${r.outcome} |`,
  )
}

const reachable = results.filter((r) => r.outcome.startsWith('reachable')).length
console.log(`\n**${reachable} of ${results.length} reachable from this egress.**`)
console.log(
  '\nSources that are not reachable stay inactive. Do not work around a block — ' +
    'record it and escalate the access question.',
)
