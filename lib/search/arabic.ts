/**
 * Arabic text normalisation — the client half of a contract shared with Postgres.
 *
 * ┌─ THIS MUST MATCH THE DATABASE EXACTLY ─────────────────────────────────────┐
 * │                                                                            │
 * │ legal_updates.search_vector is a GENERATED column defined in migration      │
 * │ 0003 as:                                                                    │
 * │                                                                             │
 * │   to_tsvector('simple', translate(<text>,                                   │
 * │     U&'\0623\0625\0622\0671\0629\0649\0624\0626                             │
 * │        \064B\064C\064D\064E\064F\0650\0651\0652\0670\0640',                 │
 * │     U&'\0627\0627\0627\0627\0647\064A\0648\064A'))                          │
 * │                                                                             │
 * │ The stored vector therefore holds FOLDED text. A query term that has not    │
 * │ been through the identical transformation will silently fail to match —     │
 * │ searching 'ضريبة' against a vector holding 'ضريبه' returns nothing, with    │
 * │ no error to signal the mistake.                                             │
 * │                                                                             │
 * │ Parity between this function and the SQL is asserted by                     │
 * │ scripts/verify-normalization-parity.mjs, which runs both over a shared      │
 * │ corpus and diffs the output. Change one, and that check fails.              │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

/** Characters folded to a canonical form, mirroring the SQL translate() pairs. */
const FOLD_MAP: ReadonlyMap<string, string> = new Map([
  ['أ', 'ا'], // أ  hamza above  → ا
  ['إ', 'ا'], // إ  hamza below  → ا
  ['آ', 'ا'], // آ  madda        → ا
  ['ٱ', 'ا'], // ٱ  wasla        → ا
  ['ة', 'ه'], // ة  teh marbuta  → ه
  ['ى', 'ي'], // ى  alef maksura → ي
  ['ؤ', 'و'], // ؤ  hamza on waw → و
  ['ئ', 'ي'], // ئ  hamza on yeh → ي
])

/**
 * Characters removed outright: tashkeel (harakat), superscript alef, and the
 * tatweel elongation character, which carries no semantic content.
 */
const STRIP_SET: ReadonlySet<string> = new Set([
  'ً', // ً  fathatan
  'ٌ', // ٌ  dammatan
  'ٍ', // ٍ  kasratan
  'َ', // َ  fatha
  'ُ', // ُ  damma
  'ِ', // ِ  kasra
  'ّ', // ّ  shadda
  'ْ', // ْ  sukun
  'ٰ', // ٰ  superscript alef
  'ـ', // ـ  tatweel
])

/**
 * Folds Arabic orthographic variation exactly as the database does.
 *
 * Iterates by code point rather than UTF-16 code unit so text containing
 * astral-plane characters is not corrupted mid-surrogate.
 */
export function normalizeArabic(input: string): string {
  let out = ''
  for (const char of input) {
    if (STRIP_SET.has(char)) continue
    out += FOLD_MAP.get(char) ?? char
  }
  return out
}

/**
 * Prepares a user's search box input for `to_tsquery`-family matching.
 *
 * Normalises, collapses whitespace, and trims. Deliberately does NOT attempt to
 * build tsquery syntax: the query layer hands the result to PostgREST's
 * `plainto_tsquery` mode, which treats the whole string as literal terms. That
 * removes any possibility of a user typing operator characters and either
 * causing a syntax error or steering the query.
 */
export function normalizeSearchQuery(input: string): string {
  return normalizeArabic(input).replace(/\s+/g, ' ').trim()
}

/**
 * Escapes the LIKE metacharacters `%`, `_` and `\` for the trigram fallback.
 *
 * Without this, a user typing `%` would match every row — surprising, and on a
 * large archive, slow.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Minimum term length before the trigram fallback is worth running. Below three
 * characters a substring match returns most of the archive, which is noise
 * rather than a result.
 */
export const MIN_FUZZY_LENGTH = 3
