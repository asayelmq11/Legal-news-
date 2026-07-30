#!/usr/bin/env node
/**
 * Proves lib/search/arabic.ts folds text identically to the SQL translate()
 * inside legal_updates.search_vector.
 *
 *   node scripts/verify-normalization-parity.mjs "postgresql://..."
 *
 * A unit test can only check the TypeScript against expectations someone wrote
 * down. This runs BOTH implementations over the same corpus and diffs them, so
 * a divergence is caught even if the expectation itself was wrong.
 *
 * Exits non-zero on any mismatch.
 */
import pg from 'pg'

import { normalizeArabic } from '../lib/search/arabic.ts'

const connectionString = process.argv[2] ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error('usage: verify-normalization-parity.mjs <postgres-url>')
  process.exit(1)
}

/** The exact translate() arguments from migration 0003. */
const SQL_FROM =
  "U&'\\0623\\0625\\0622\\0671\\0629\\0649\\0624\\0626\\064B\\064C\\064D\\064E\\064F\\0650\\0651\\0652\\0670\\0640'"
const SQL_TO = "U&'\\0627\\0627\\0627\\0627\\0647\\064A\\0648\\064A'"

/**
 * Corpus: real legal phrasing, every folded character in isolation, mixed
 * scripts, and edge cases that would break a naive implementation.
 */
const CORPUS = [
  // realistic legal Arabic
  'تعديل أحكام اللائحة التنفيذية لنظام ضريبة القيمة المضافة',
  'مرسوم ملكي بالموافقة على نظام حماية البيانات الشخصية',
  'قرار وزاري بشأن تنظيم العمل عن بُعد',
  'تعميم هيئة السوق المالية إلى الأشخاص المرخص لهم',
  'اللائحه التنفيذيه لنظام الشركات',
  'إصدار الضوابط التنظيمية للأمن السيبراني',

  // every folded character alone
  'أ', 'إ', 'آ', 'ٱ', 'ة', 'ى', 'ؤ', 'ئ',
  // every stripped character alone
  'ً', 'ٌ', 'ٍ', 'َ', 'ُ', 'ِ', 'ّ', 'ْ', 'ٰ', 'ـ',

  // fully vocalised text
  'اَلْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',
  'مُرَسُّومٌ مَلَكِيٌّ',
  // tatweel padding
  'نظــــام الشركــــات',
  // combining marks on folded characters
  'أَحْكَام',
  'مُؤَسَّسَة',
  'هَيْئَة',

  // mixed script and punctuation
  'ZATCA — هيئة الزكاة والضريبة والجمارك',
  'VAT ضريبة 15% اعتباراً من 2020-07-01',
  'المادة (١٢) من النظام',
  'المادة (12) من النظام',

  // edge cases
  '',
  ' ',
  '   spaced   ',
  'no arabic at all',
  '١٢٣٤٥٦٧٨٩٠',
  '🇸🇦 قرار', // astral-plane pair must survive intact
  'مُحَمَّدٌ\nسطر ثانٍ',
  'a'.repeat(500),
]

const client = new pg.Client({ connectionString })
await client.connect()

let mismatches = 0
for (const [i, sample] of CORPUS.entries()) {
  const { rows } = await client.query(
    `select translate($1::text, ${SQL_FROM}, ${SQL_TO}) as folded`,
    [sample],
  )
  const sql = rows[0].folded
  const ts = normalizeArabic(sample)

  if (sql !== ts) {
    mismatches += 1
    console.error(`\n MISMATCH [${i}] input: ${JSON.stringify(sample)}`)
    console.error(`   SQL: ${JSON.stringify(sql)}`)
    console.error(`   TS : ${JSON.stringify(ts)}`)
  }
}

await client.end()

if (mismatches > 0) {
  console.error(`\n${mismatches} of ${CORPUS.length} samples diverged.`)
  console.error('lib/search/arabic.ts and migration 0003 are OUT OF SYNC.')
  console.error('Search will silently return wrong results until this is fixed.')
  process.exit(1)
}

console.warn(
  `normalisation parity OK — ${CORPUS.length} samples fold identically in TypeScript and Postgres`,
)
