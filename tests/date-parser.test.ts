import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Executes the actual `parseDateSafe` function as deployed inside
 * n8n/workflows/02-source-ingestion.json — extracted verbatim from the real
 * jsCode string of each RawItem node, not a hand-duplicated copy that could
 * silently drift from what production actually runs.
 *
 * Context: `new Date(raw)` (the function this replaces) either throws away
 * an unparseable date (safe) or, for an ambiguous day-first numeric date
 * like "05/08/2026" (meant 5 August), silently reinterprets it as 8 May
 * under its US-style MM/DD heuristic — a real incident found during the
 * 2026-08-10 source-verification pass (CMA Kuwait, MOJ Bahrain). This suite
 * exists specifically to prevent that bug from coming back.
 */

const WORKFLOW_PATH = new URL('../n8n/workflows/02-source-ingestion.json', import.meta.url)

interface Node {
  name: string
  parameters: { jsCode?: string; [key: string]: unknown }
}

interface Connection {
  main?: Array<Array<{ node: string }>>
}

function loadWorkflow(): { nodes: Node[]; connections: Record<string, Connection> } {
  return JSON.parse(readFileSync(WORKFLOW_PATH, 'utf8'))
}

/** Extracts the `function parseDateSafe(raw) { ... }` block via balanced-brace scanning — no regex guesswork over nested braces/template literals. */
function extractParseDateSafe(jsCode: string): string {
  const marker = 'function parseDateSafe(raw) {'
  const start = jsCode.indexOf(marker)
  if (start === -1) throw new Error('parseDateSafe not found in node code')
  let depth = 0
  let i = start + marker.length - 1 // position of the opening brace
  for (; i < jsCode.length; i++) {
    if (jsCode[i] === '{') depth++
    else if (jsCode[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return jsCode.slice(start, i + 1)
}

function loadParseDateSafe(nodeName: string): (raw: unknown) => string | null {
  const wf = loadWorkflow()
  const node = wf.nodes.find((n) => n.name === nodeName)
  if (!node?.parameters.jsCode) throw new Error(`node "${nodeName}" not found or has no jsCode`)
  const fnSource = extractParseDateSafe(node.parameters.jsCode)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(`${fnSource}\nreturn parseDateSafe;`)
  return factory()
}

const RAW_ITEM_NODES = ['RSS → RawItem', 'API → RawItem', 'HTML → RawItem']

describe('parseDateSafe — deployed in every RawItem lane', () => {
  it('is present, syntactically self-contained, and byte-identical across all three lanes', () => {
    const wf = loadWorkflow()
    const sources = RAW_ITEM_NODES.map((name) => {
      const node = wf.nodes.find((n) => n.name === name)
      if (!node?.parameters.jsCode) throw new Error(`${name}: missing`)
      return extractParseDateSafe(node.parameters.jsCode)
    })
    expect(sources[0]).toBe(sources[1])
    expect(sources[1]).toBe(sources[2])
  })

  describe.each(RAW_ITEM_NODES)('as deployed in "%s"', (nodeName) => {
    const parseDateSafe = loadParseDateSafe(nodeName)

    describe('positive cases — exact formats requested for regression coverage', () => {
      it.each([
        ['10/08/2026', '2026-08-10'],
        ['08/10/2026', '2026-10-08'], // day-first rule, deterministic — never a guess, see file header
        ['10-08-2026', '2026-08-10'],
        ['09.07.2026', '2026-07-09'], // dot-separated — the real SAIP media-center format, found live 2026-08-10
        ['تاريخ النشر: 09.07.2026', '2026-07-09'],
        ['2026-08-10', '2026-08-10'],
        ['10 أغسطس 2026', '2026-08-10'],
        ['2026-08-10T10:00:00Z', '2026-08-10'],
        ['2026-08-10T10:00:00.123+03:00', '2026-08-10'],
        ['Wed, 05 Aug 2026 10:00:00 GMT', '2026-08-05'],
        ['August 5, 2026', '2026-08-05'],
        ['5 August 2026', '2026-08-05'],
        ['05 Aug 2026', '2026-08-05'],
      ])('%s -> %s', (raw, expected) => {
        expect(parseDateSafe(raw)).toBe(expected)
      })

      it('does not require the date to be the entire string — label-prefixed values still parse (the real CMA Kuwait case)', () => {
        expect(parseDateSafe('القرارات  10/08/2026')).toBe('2026-08-10')
      })

      it('Eastern Arabic-Indic digits are normalised before parsing', () => {
        expect(parseDateSafe('١٠/٠٨/٢٠٢٦')).toBe('2026-08-10')
      })
    })

    describe('the silent-corruption regression — day-first, never MM/DD, regardless of which value is <=12', () => {
      it('a day <=12 no longer gets silently reinterpreted as month-first (the original bug)', () => {
        // Under the old `new Date(raw)`, "05/08/2026" (meant 5 Aug) became 8 May.
        expect(parseDateSafe('05/08/2026')).toBe('2026-08-05')
      })

      it('MOJ Bahrain real-world case: "02-07-2026" is 2 July, never 7 February', () => {
        expect(parseDateSafe('02-07-2026')).toBe('2026-07-02')
      })

      it('an unambiguous day >12 was already safe and stays correct', () => {
        expect(parseDateSafe('31/07/2026')).toBe('2026-07-31')
      })
    })

    describe('Hijri dates — recognised, never converted (no verified converter in this project)', () => {
      it('a Hijri month name returns null rather than a guessed conversion', () => {
        expect(parseDateSafe('27-شوال-1445')).toBeNull()
      })

      it('a "هـ" marker returns null even when a Gregorian month word coincidentally appears', () => {
        expect(parseDateSafe('10 أغسطس 1448 هـ')).toBeNull()
      })
    })

    describe('negative / malformed cases', () => {
      it.each([
        [null],
        [undefined],
        [''],
        ['   '],
        ['غير معروف'],
        ['لا يوجد تاريخ في هذا النص على الإطلاق'],
        ['not a date'],
        ['32/13/2026'], // day and month both out of range
        ['31/02/2026'], // February never has 31 days
        ['00/00/0000'],
        ['99/99/9999'],
        ['31.02.2026'], // dot-separated, same invalid-day-for-month rule
      ])('%s -> null', (raw) => {
        expect(parseDateSafe(raw as never)).toBeNull()
      })
    })
  })
})

describe('HTML → RawItem: prefers a <time datetime> attribute over its text content', () => {
  const wf = loadWorkflow()
  const node = wf.nodes.find((n) => n.name === 'HTML → RawItem')
  const jsCode = node?.parameters.jsCode ?? ''

  it('pick() special-cases the time tag before falling back to inner text', () => {
    expect(jsCode).toContain("if (tag === 'time')")
    expect(jsCode).toMatch(/datetime=\["']/)
  })

  it('executes correctly: a <time datetime> value wins over its human-readable text', () => {
    const marker = 'const pick = (html, selector) => {'
    const start = jsCode.indexOf(marker)
    let depth = 0
    let i = start + marker.length - 1
    for (; i < jsCode.length; i++) {
      if (jsCode[i] === '{') depth++
      else if (jsCode[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const pickSource = jsCode.slice(start, i + 2) // include trailing `;`
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const pick = new Function(`${pickSource}\nreturn pick;`)() as (html: string, selector: string) => string

    const row = '<div><time datetime="2026-08-10">10 أغسطس 2026</time></div>'
    expect(pick(row, 'time')).toBe('2026-08-10')

    // A tag other than `time` is unaffected — still plain text extraction.
    const spanRow = '<div><span data-date="2026-08-10">10 أغسطس 2026</span></div>'
    expect(pick(spanRow, 'span')).toBe('10 أغسطس 2026')
  })
})

describe('API → RawItem: resolves a relative url field, mirroring the HTML lane', () => {
  const wf = loadWorkflow()
  const node = wf.nodes.find((n) => n.name === 'API → RawItem')
  const jsCode = node?.parameters.jsCode ?? ''

  it('source_url passes through absolute() before being stored', () => {
    expect(jsCode).toContain('source_url: absolute(resolveUrl(cfg.url, it))')
  })

  it('a site-relative Url field (the real QFMA response shape) resolves to a fetchable absolute URL', () => {
    const marker = 'const dig = (obj, path) =>'
    const start = jsCode.indexOf(marker)
    const end = jsCode.indexOf('const payload = ')
    const helpers = jsCode.slice(start, end)
    const src = { base_url: 'https://www.qfma.org.qa', id: 'x' }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const absolute = new Function(
      `const src = ${JSON.stringify(src)};\n${helpers}\nreturn absolute;`,
    )() as (href: unknown) => string
    expect(absolute('/English/Legislation/Legal_decisions/Documents/Rules.pdf')).toBe(
      'https://www.qfma.org.qa/English/Legislation/Legal_decisions/Documents/Rules.pdf',
    )
    // An already-absolute URL from some other API source passes through unchanged.
    expect(absolute('https://example.gov.qa/doc.pdf')).toBe('https://example.gov.qa/doc.pdf')
  })
})

describe('Fetch API: opt-in POST/body support never changes existing GET-source behaviour', () => {
  const wf = loadWorkflow()
  const node = wf.nodes.find((n) => n.name === 'Fetch API') as
    | { parameters: Record<string, unknown> }
    | undefined

  it('defaults to GET with no body when a source has no http_method/http_body configured', () => {
    expect(node?.parameters.method).toBe(
      "={{ $json.source.parser_config.http_method === 'POST' ? 'POST' : 'GET' }}",
    )
    expect(node?.parameters.sendBody).toBe(
      "={{ $json.source.parser_config.http_method === 'POST' && !!$json.source.parser_config.http_body }}",
    )
  })

  it('method is a strict GET/POST allow-list — no other verb can ever reach the request, however parser_config is set', () => {
    // http_method is free text in the DB (no CHECK constraint on that jsonb
    // key); the workflow itself must be the thing that refuses to forward
    // anything but GET/POST, since a stray value (a typo, or something like
    // "TRACE"/"DELETE") must never become an outbound method choice.
    expect(node?.parameters.method).not.toContain('|| \'GET\'')
    expect(node?.parameters.method).toContain("=== 'POST' ? 'POST' : 'GET'")
  })

  it('the body sent, when present, is only ever the source\'s own registry config — never free user input', () => {
    expect(node?.parameters.jsonBody).toBe(
      '={{ JSON.stringify($json.source.parser_config.http_body || {}) }}',
    )
  })

  it('http_body is a distinct key from cfg.body (which API → RawItem already uses for the item content field path)', () => {
    const apiRawItem = wf.nodes.find((n) => n.name === 'API → RawItem') as
      | { parameters: { jsCode?: string } }
      | undefined
    expect(apiRawItem?.parameters.jsCode).toContain('content_raw: String(dig(it, cfg.body)')
  })

  it('existing headers/TLS/timeout options are untouched', () => {
    expect(node?.parameters.sendHeaders).toBe(true)
    expect(node?.parameters.jsonHeaders).toBe(
      '={{ JSON.stringify($json.source.parser_config.headers || {}) }}',
    )
    const options = node?.parameters.options as { timeout?: number } | undefined
    expect(options?.timeout).toBe(30000)
  })
})

/**
 * Extracts a `const NAME = (...) => { ... };` block via balanced-brace
 * scanning, same technique as extractParseDateSafe above — real deployed
 * source, not a hand copy.
 */
function extractConstArrowBlock(jsCode: string, constName: string): string {
  const marker = `const ${constName} = `
  const start = jsCode.indexOf(marker)
  if (start === -1) throw new Error(`${constName} not found in node code`)
  const braceStart = jsCode.indexOf('{', start)
  let depth = 0
  let i = braceStart
  for (; i < jsCode.length; i++) {
    if (jsCode[i] === '{') depth++
    else if (jsCode[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return jsCode.slice(start, i + 1) + ';'
}

function loadHtmlLaneHelpers() {
  const wf = loadWorkflow()
  const node = wf.nodes.find((n) => n.name === 'HTML → RawItem')
  if (!node?.parameters.jsCode) throw new Error('HTML → RawItem: missing')
  const jsCode = node.parameters.jsCode
  const pickSrc = extractConstArrowBlock(jsCode, 'pick')
  const splitSrc = extractConstArrowBlock(jsCode, 'splitListItem')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const pick = new Function(`${pickSrc}\nreturn pick;`)() as (html: string, selector: string) => string
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const splitListItem = new Function(`${splitSrc}\nreturn splitListItem;`)() as (
    html: string,
    tag: string,
  ) => string[]
  return { pick, splitListItem, jsCode }
}

describe('pick() — occurrence index and id-substring targeting (M14, SELECTOR-ARCH sources)', () => {
  const { pick } = loadHtmlLaneHelpers()

  it('title/link/date all in the same flat container — unchanged default (occurrence 1), the existing verified-source shape', () => {
    const row = '<tr><td><u>Circular title</u></td><td><p>31/07/2026</p></td><td><a href="/x.pdf">link</a></td></tr>'
    expect(pick(row, 'u')).toBe('Circular title')
    expect(pick(row, 'p')).toBe('31/07/2026')
    expect(pick(row, 'a@href')).toBe('/x.pdf')
  })

  it('title/link/date in nested elements — SAIP: date is a <div> reached only past two ancestor <div> wrappers', () => {
    const row =
      '<div class="relative"><img alt="x" src="a.png"/></div>' +
      '<div class="flex h-full"><div class="flex flex-col">' +
      '<h3>SAIP TITLE</h3><div class="text-text-secondary-paragraph">تاريخ النشر: 09.07.2026</div>' +
      '<div class="font-body">BODY</div></div></div>' +
      '<a href="/ar/media-center/2889">read more</a>'
    expect(pick(row, 'h3')).toBe('SAIP TITLE')
    expect(pick(row, 'a@href')).toBe('/ar/media-center/2889')
    // occurrence 1 (default, no ":N") would incorrectly resolve to the
    // unrelated image-wrapper div — this is exactly the SELECTOR-ARCH bug.
    expect(pick(row, 'div')).toBe('')
    expect(pick(row, 'div:2')).toBe('تاريخ النشر: 09.07.2026')
  })

  it('a sibling-occurrence collision — HRSD: 3 sibling <span> tags, only the 3rd is the real (Gregorian) date', () => {
    const row =
      '<div class="views-row"><h2><a href="/x/145268">HRSD TITLE</a></h2>' +
      '<div class="hijri-dual-date-formatter">' +
      '<span class="hijri-date">27-شوال-1445</span><span class="date-separator">-</span>' +
      '<span class="gregorian-date">06-مايو-2024</span></div></div>'
    expect(pick(row, 'span:1')).toBe('27-شوال-1445')
    expect(pick(row, 'span:2')).toBe('-')
    expect(pick(row, 'span:3')).toBe('06-مايو-2024')
  })

  it('a label+date sibling-span collision — CMA Kuwait: pick(row,"span") alone grabs the label, not the date', () => {
    const row =
      '<div class="inner-cont-box"><h6><span class="typeDisplay">القرارات  </span>' +
      '<span class="text-bold">10/08/2026</span></h6>' +
      '<a href="https://www.cma.gov.kw/detail/1979860"><span><span>CMA TITLE </span></span></a></div>'
    expect(pick(row, 'span')).toBe('القرارات')
    expect(pick(row, 'span:2')).toBe('10/08/2026')
  })

  it('a selector that finds nothing returns empty, never throws or fabricates a value', () => {
    expect(pick('<div>no matching tags in here</div>', 'span')).toBe('')
    expect(pick('<div><span>only one</span></div>', 'span:5')).toBe('')
    expect(pick('<div><span>x</span></div>', 'span#nonexistent-id')).toBe('')
  })

  it('an unclosed/malformed tag resolves to empty rather than a garbled match', () => {
    expect(pick('<div><span>unclosed', 'span')).toBe('')
  })

  it('id-substring targeting survives a long ASP.NET-style generated prefix — MOJ Kuwait\'s real id shape', () => {
    const detail =
      '<span id="ctl00_ctl32_g_df5e4730_9caa_4e1c_b196_5987035d0c08_ctl00_ctl00_ItemDate" class="mi-article-media-block__date">03-أغسطس-2026</span>' +
      '<span id="ctl00_ctl32_g_df5e4730_9caa_4e1c_b196_5987035d0c08_ctl00_ctl00_ItemViews" class="mi-article-media-block__date">عدد المشاهدات : 534</span>'
    expect(pick(detail, 'span#ItemDate')).toBe('03-أغسطس-2026')
  })

  it('id-substring targeting distinguishes two same-id-prefixed spans — Al-Meezan\'s issuance date vs. publication date', () => {
    const detail =
      '<span id="ContentPlaceHolder1_lbldate"><em>التاريخ: </em>16/04/2026 الموافق 28/10/1447 هجري</span>' +
      '<span id="ContentPlaceHolder1_lblojpubdate"><em>تاريخ النشر: </em>07/05/2026 الموافق 20/11/1447 هجري</span>'
    expect(pick(detail, 'span#lblojpubdate')).toContain('07/05/2026')
    expect(pick(detail, 'span#lbldate')).not.toContain('07/05/2026')
  })

  it('backward compatible: occurrence-1 default reproduces the exact output of every currently-active source\'s real config shape', () => {
    // SAMA — list=table.circulars tbody tr, title=u, date=p, link=a@href
    const sama = '<tr><td><u>Sama Circular</u></td><td><p>31/07/2026</p></td><td><a href="/c.pdf">l</a></td></tr>'
    expect(pick(sama, 'u')).toBe('Sama Circular')
    expect(pick(sama, 'p')).toBe('31/07/2026')
    expect(pick(sama, 'a@href')).toBe('/c.pdf')
    // CMA Saudi Arabia — list=td.carditem, title=h3, date=span, link=a@href, body=p
    const cmaSa = '<td class="carditem"><h3>CMA SA Title</h3><span>05-أغسطس-2026</span><a href="/y">x</a><p>body text</p></td>'
    expect(pick(cmaSa, 'h3')).toBe('CMA SA Title')
    expect(pick(cmaSa, 'span')).toBe('05-أغسطس-2026')
    expect(pick(cmaSa, 'a@href')).toBe('/y')
    // QFCRA — list=table tbody tr, title=a, date=nobr, link=a@href
    const qfcra = '<tr><td><a href="/z">QFCRA Title</a></td><td><nobr>12 Aug 2026</nobr></td></tr>'
    expect(pick(qfcra, 'a')).toBe('QFCRA Title')
    expect(pick(qfcra, 'nobr')).toBe('12 Aug 2026')
    // MOJ Bahrain — list=table tbody tr, title=a, date=span, link=a@href
    const mojBh = '<tr><td><a href="/w">MOJ BH Title</a></td><td><span>10/08/2026</span></td></tr>'
    expect(pick(mojBh, 'a')).toBe('MOJ BH Title')
    expect(pick(mojBh, 'span')).toBe('10/08/2026')
  })

  it('a <time datetime> preference still applies through the new occurrence-aware matcher', () => {
    const row = '<div><time datetime="2026-08-10">10 أغسطس 2026</time></div>'
    expect(pick(row, 'time')).toBe('2026-08-10')
  })
})

describe('list_item — sub-splits a wrapper-less list match (M14, LMRA Bahrain)', () => {
  const { splitListItem, pick } = loadHtmlLaneHelpers()

  it('splits a flat blob of sibling <a> elements into individually addressable rows, each keeping its own opening tag', () => {
    const blob =
      '<a class="list-group-item" href="https://www.lmra.gov.bh/ar/announcement/show/429" title="إعلان عن انقطاع الخدمة"><span class="badge">29-07-2026</span>إعلان عن انقطاع الخدمة</a>' +
      '<a class="list-group-item" href="https://www.lmra.gov.bh/ar/announcement/show/428" title="إعلان"><span class="badge">24-06-2026</span>إعلان</a>'
    const rows = splitListItem(blob, 'a')
    expect(rows).toHaveLength(2)
    const [row0, row1] = rows as [string, string]
    // Unlike the native listing extractor (inner-html only), each fragment
    // keeps its own opening tag, so the row's OWN attributes are reachable —
    // the actual problem LMRA has (title only exists as the row's own
    // `title` attribute, no dedicated child element for it at all).
    expect(pick(row0, 'a@title')).toBe('إعلان عن انقطاع الخدمة')
    expect(pick(row0, 'a@href')).toBe('https://www.lmra.gov.bh/ar/announcement/show/429')
    expect(pick(row0, 'span')).toBe('29-07-2026')
    expect(pick(row1, 'a@title')).toBe('إعلان')
    expect(pick(row1, 'a@href')).toBe('https://www.lmra.gov.bh/ar/announcement/show/428')
  })

  it('is fully opt-in: absent cfg.list_item, HTML → RawItem uses $input items unchanged', () => {
    const wf = loadWorkflow()
    const node = wf.nodes.find((n) => n.name === 'HTML → RawItem')
    const code = String(node?.parameters.jsCode ?? '')
    expect(code).toContain('const blocks = cfg.list_item')
    expect(code).toContain('? rawBlocks.flatMap((block) => splitListItem(block, cfg.list_item))')
    expect(code).toContain(': rawBlocks;')
  })
})

describe('opt-in per-item detail-page date fetch (M14: MOJ Kuwait, Al-Meezan — Category B/C NO-DATE sources)', () => {
  const wf = loadWorkflow()

  function loadDetailDateHelpers() {
    const node = wf.nodes.find((n) => n.name === 'Extract date from detail page')
    if (!node?.parameters.jsCode) throw new Error('Extract date from detail page: missing')
    const jsCode = node.parameters.jsCode
    const extractSrc = extractConstArrowBlock(jsCode, 'extractDetailDate')
    const pickSrc = extractConstArrowBlock(jsCode, 'pick')
    const parseSrc = (() => {
      const marker = 'function parseDateSafe(raw) {'
      const start = jsCode.indexOf(marker)
      let depth = 0
      let i = jsCode.indexOf('{', start)
      for (; i < jsCode.length; i++) {
        if (jsCode[i] === '{') depth++
        else if (jsCode[i] === '}') {
          depth--
          if (depth === 0) break
        }
      }
      return jsCode.slice(start, i + 1)
    })()
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const extractDetailDate = new Function(`${extractSrc}\nreturn extractDetailDate;`)() as (
      html: string,
    ) => string | null
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const pick = new Function(`${pickSrc}\nreturn pick;`)() as (html: string, selector: string) => string
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const parseDateSafe = new Function(`${parseSrc}\nreturn parseDateSafe;`)() as (
      raw: unknown,
    ) => string | null
    return { extractDetailDate, pick, parseDateSafe, jsCode }
  }

  it('date present in JSON-LD', () => {
    const { extractDetailDate } = loadDetailDateHelpers()
    const html = '<script type="application/ld+json">{"@type":"Article","datePublished":"2026-08-05T10:00:00Z"}</script>'
    expect(extractDetailDate(html)).toBe('2026-08-05T10:00:00Z')
  })

  it('date present in a meta tag (article:published_time)', () => {
    const { extractDetailDate } = loadDetailDateHelpers()
    const html = '<meta property="article:published_time" content="2026-08-05">'
    expect(extractDetailDate(html)).toBe('2026-08-05')
  })

  it('date present only on the detail page — MOJ Kuwait real shape: no JSON-LD/meta/time, only a class-shared, id-distinguished span', () => {
    const { extractDetailDate, pick, parseDateSafe } = loadDetailDateHelpers()
    const html =
      '<meta property="og:type" content="article">' +
      '<span id="ctl00_ctl32_..._ItemDate" class="mi-article-media-block__date">03-أغسطس-2026</span>' +
      '<span id="ctl00_ctl32_..._ItemViews" class="mi-article-media-block__date">عدد المشاهدات : 534</span>'
    expect(extractDetailDate(html)).toBeNull()
    const fallback = pick(html, 'span#ItemDate')
    expect(parseDateSafe(fallback)).toBe('2026-08-03')
  })

  it('no date present anywhere — none of JSON-LD/meta/time/fallback selector resolve', () => {
    const { extractDetailDate, pick } = loadDetailDateHelpers()
    const html = '<div>no date anywhere on this page</div>'
    expect(extractDetailDate(html)).toBeNull()
    expect(pick(html, 'span#ItemDate')).toBe('')
  })

  it('the fallback selector only runs when structured signals are absent — the wiring node calls it strictly after extractDetailDate fails', () => {
    const { jsCode } = loadDetailDateHelpers()
    expect(jsCode).toContain('let extracted = extractDetailDate(html);')
    expect(jsCode).toContain('if (!extracted && cfg.detail_date_selector)')
  })

  it('the gate is opt-in per source and only fires when the listing date was missing — never an extra request otherwise', () => {
    const ifNode = wf.nodes.find((n) => n.name === 'Needs detail-page date?') as
      | { parameters: { conditions?: { conditions?: Array<{ leftValue?: string }> } } }
      | undefined
    const condition = ifNode?.parameters.conditions?.conditions?.[0]?.leftValue ?? ''
    expect(condition).toContain('!$json.publication_date')
    expect(condition).toContain('source.parser_config.date_from_detail')
  })

  it('detail-page fetch failure leaves the item exactly as it was (date null), never crashes the item', () => {
    const node = wf.nodes.find((n) => n.name === 'Detail fetch failed — keep original')
    const code = String(node?.parameters.jsCode ?? '')
    expect(code).toContain("$('Normalise RawItem').itemMatching(i).json")
  })

  it('processes every item in the batch, not just the first — a source with N items needing a detail-page date must get all N processed', () => {
    // Regression test for a real bug found during live testing (2026-08-10):
    // both detail-page nodes originally used `.item.json` (single-item
    // context) while running in the node's default "run once for all items"
    // mode, so only the first of N items was ever processed — the other
    // N-1 silently vanished. Both nodes must loop over $input.all().
    const extractNode = wf.nodes.find((n) => n.name === 'Extract date from detail page')
    const extractCode = String(extractNode?.parameters.jsCode ?? '')
    expect(extractCode).toContain('$input.all().map((item, i) =>')
    expect(extractCode).toContain("$('Normalise RawItem').itemMatching(i).json")
    expect(extractCode).not.toContain("$('Normalise RawItem').item.json")

    const failNode = wf.nodes.find((n) => n.name === 'Detail fetch failed — keep original')
    const failCode = String(failNode?.parameters.jsCode ?? '')
    expect(failCode).toContain('$input.all().map((item, i) =>')
  })

  it('both the success and failure branches converge on the same merge node before "Has items?"', () => {
    const conns = wf.connections
    const extractOut = conns['Extract date from detail page']?.main?.[0]?.[0]?.node
    const failOut = conns['Detail fetch failed — keep original']?.main?.[0]?.[0]?.node
    const ifFalseOut = conns['Needs detail-page date?']?.main?.[1]?.[0]?.node
    expect(extractOut).toBe('Merge detail-page date')
    expect(failOut).toBe('Merge detail-page date')
    expect(ifFalseOut).toBe('Merge detail-page date')
    expect(conns['Merge detail-page date']?.main?.[0]?.[0]?.node).toBe('Has items?')
  })
})

describe('parseDateSafe — dual-calendar connector ("الموافق"), the Al-Meezan finding', () => {
  const parseDateSafe = loadParseDateSafe('HTML → RawItem')

  it('extracts the Gregorian date preceding "الموافق" even though a Hijri date and marker follow it', () => {
    expect(parseDateSafe('16/04/2026 الموافق 28/10/1447 هجري')).toBe('2026-04-16')
    expect(parseDateSafe('تاريخ النشر: 07/05/2026 الموافق 20/11/1447 هجري')).toBe('2026-05-07')
  })

  it('does not affect a bare Hijri date with no "الموافق" connector — still null (the original guard, unchanged)', () => {
    expect(parseDateSafe('10 أغسطس 1448 هـ')).toBeNull()
    expect(parseDateSafe('27-شوال-1445')).toBeNull()
  })
})
