#!/usr/bin/env node
/**
 * Generates types/database.ts by introspecting a live Postgres schema.
 *
 *   node scripts/generate-db-types.mjs "postgresql://user:pass@host:5432/db"
 *   npm run db:types                      # uses DATABASE_URL
 *
 * The Supabase CLI's `gen types` requires Docker, which is not available in
 * every environment. This reads the catalogue directly, so it works against a
 * local Postgres, a CI service container, or the real Supabase database using
 * the connection string from Project Settings → Database.
 *
 * Output matches the shape @supabase/supabase-js expects for its `Database`
 * generic, so client calls are type-checked end to end.
 */
import { writeFileSync } from 'node:fs'
import pg from 'pg'

const connectionString = process.argv[2] ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error('usage: generate-db-types.mjs <postgres-url>   (or set DATABASE_URL)')
  process.exit(1)
}

const OUT = new URL('../types/database.ts', import.meta.url)

/** Postgres type → TypeScript type. Anything unlisted falls back to unknown. */
const SCALARS = {
  uuid: 'string',
  text: 'string',
  varchar: 'string',
  bpchar: 'string',
  bool: 'boolean',
  int2: 'number',
  int4: 'number',
  int8: 'number',
  float4: 'number',
  float8: 'number',
  numeric: 'number',
  date: 'string',
  timestamp: 'string',
  timestamptz: 'string',
  time: 'string',
  timetz: 'string',
  json: 'Json',
  jsonb: 'Json',
  // Postgres full-text vectors have no useful client-side representation and
  // are never selected by the application.
  tsvector: 'unknown',
}

function tsType(udtName, enumNames) {
  if (udtName.startsWith('_')) {
    const inner = udtName.slice(1)
    return `${tsType(inner, enumNames)}[]`
  }
  if (enumNames.has(udtName)) return `Database['public']['Enums']['${udtName}']`
  return SCALARS[udtName] ?? 'unknown'
}

const client = new pg.Client({ connectionString })
await client.connect()

// ---- enums ------------------------------------------------------------------
const { rows: enumRows } = await client.query(`
  select t.typname as name, e.enumlabel as label
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  order by t.typname, e.enumsortorder
`)
const enums = new Map()
for (const r of enumRows) {
  if (!enums.has(r.name)) enums.set(r.name, [])
  enums.get(r.name).push(r.label)
}
const enumNames = new Set(enums.keys())

// ---- tables and columns -----------------------------------------------------
const { rows: colRows } = await client.query(`
  select
    c.relname                              as table_name,
    a.attname                              as column_name,
    a.attnum                               as ordinal,
    format_type(a.atttypid, null)          as sql_type,
    t.typname                              as udt_name,
    a.attnotnull                           as not_null,
    (a.attidentity <> '' or a.attgenerated <> '' or pg_get_expr(d.adbin, d.adrelid) is not null) as has_default,
    (a.attgenerated <> '')                 as is_generated
  from pg_attribute a
  join pg_class c      on c.oid = a.attrelid
  join pg_namespace n  on n.oid = c.relnamespace
  join pg_type t       on t.oid = a.atttypid
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  order by c.relname, a.attnum
`)

// ---- foreign keys -----------------------------------------------------------
const { rows: fkRows } = await client.query(`
  select
    con.conname                      as constraint_name,
    src.relname                      as table_name,
    sa.attname                       as column_name,
    tgt.relname                      as foreign_table,
    ta.attname                       as foreign_column
  from pg_constraint con
  join pg_class src  on src.oid = con.conrelid
  join pg_class tgt  on tgt.oid = con.confrelid
  join pg_namespace n on n.oid = src.relnamespace
  join pg_attribute sa on sa.attrelid = con.conrelid and sa.attnum = con.conkey[1]
  join pg_attribute ta on ta.attrelid = con.confrelid and ta.attnum = con.confkey[1]
  where con.contype = 'f' and n.nspname = 'public'
  order by src.relname, con.conname
`)

// ---- functions --------------------------------------------------------------
const { rows: fnRows } = await client.query(`
  select p.proname as name, t.typname as return_udt
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_type t on t.oid = p.prorettype
  where n.nspname = 'public'
  order by p.proname
`)

await client.end()

// ---- emit -------------------------------------------------------------------
const tables = new Map()
for (const c of colRows) {
  if (!tables.has(c.table_name)) tables.set(c.table_name, [])
  tables.get(c.table_name).push(c)
}

const lines = []
lines.push('/**')
lines.push(' * GENERATED FILE — do not edit by hand.')
lines.push(' *')
lines.push(' * Regenerate after any migration:')
lines.push(' *     npm run db:types -- "postgresql://user:pass@host:5432/db"')
lines.push(' *')
lines.push(' * Produced by scripts/generate-db-types.mjs, which introspects a live')
lines.push(' * schema. Keeping this in step with supabase/migrations is what makes the')
lines.push(' * query layer type-safe.')
lines.push(' */')
lines.push('')
lines.push('export type Json =')
lines.push('  | string')
lines.push('  | number')
lines.push('  | boolean')
lines.push('  | null')
lines.push('  | { [key: string]: Json | undefined }')
lines.push('  | Json[]')
lines.push('')
lines.push('export type Database = {')
lines.push('  public: {')
lines.push('    Tables: {')

for (const [table, cols] of [...tables].sort()) {
  lines.push(`      ${table}: {`)

  lines.push('        Row: {')
  for (const c of cols) {
    const t = tsType(c.udt_name, enumNames)
    lines.push(`          ${c.column_name}: ${t}${c.not_null ? '' : ' | null'}`)
  }
  lines.push('        }')

  lines.push('        Insert: {')
  for (const c of cols) {
    if (c.is_generated) continue // GENERATED ALWAYS — never writable
    const t = tsType(c.udt_name, enumNames)
    const optional = !c.not_null || c.has_default
    lines.push(`          ${c.column_name}${optional ? '?' : ''}: ${t}${c.not_null ? '' : ' | null'}`)
  }
  lines.push('        }')

  lines.push('        Update: {')
  for (const c of cols) {
    if (c.is_generated) continue
    const t = tsType(c.udt_name, enumNames)
    lines.push(`          ${c.column_name}?: ${t}${c.not_null ? '' : ' | null'}`)
  }
  lines.push('        }')

  const fks = fkRows.filter((f) => f.table_name === table)
  if (fks.length === 0) {
    lines.push('        Relationships: []')
  } else {
    lines.push('        Relationships: [')
    for (const f of fks) {
      lines.push('          {')
      lines.push(`            foreignKeyName: '${f.constraint_name}'`)
      lines.push(`            columns: ['${f.column_name}']`)
      lines.push('            isOneToOne: false')
      lines.push(`            referencedRelation: '${f.foreign_table}'`)
      lines.push(`            referencedColumns: ['${f.foreign_column}']`)
      lines.push('          },')
    }
    lines.push('        ]')
  }
  lines.push('      }')
}

lines.push('    }')
lines.push('    Views: Record<string, never>')

lines.push('    Functions: {')
for (const f of fnRows) {
  const ret = tsType(f.return_udt, enumNames)
  lines.push(`      ${f.name}: {`)
  lines.push('        Args: Record<PropertyKey, never>')
  lines.push(`        Returns: ${ret}`)
  lines.push('      }')
}
lines.push('    }')

lines.push('    Enums: {')
for (const [name, labels] of [...enums].sort()) {
  lines.push(`      ${name}: ${labels.map((l) => `'${l}'`).join(' | ')}`)
}
lines.push('    }')
lines.push('    CompositeTypes: Record<string, never>')
lines.push('  }')
lines.push('}')
lines.push('')
lines.push('/* ---- convenience aliases ------------------------------------------------ */')
lines.push('')
lines.push("export type Tables<T extends keyof Database['public']['Tables']> =")
lines.push("  Database['public']['Tables'][T]['Row']")
lines.push('')
lines.push("export type TablesInsert<T extends keyof Database['public']['Tables']> =")
lines.push("  Database['public']['Tables'][T]['Insert']")
lines.push('')
lines.push("export type TablesUpdate<T extends keyof Database['public']['Tables']> =")
lines.push("  Database['public']['Tables'][T]['Update']")
lines.push('')
lines.push("export type Enums<T extends keyof Database['public']['Enums']> =")
lines.push("  Database['public']['Enums'][T]")
lines.push('')

writeFileSync(OUT, lines.join('\n'))
console.warn(
  `types/database.ts written — ${tables.size} tables, ${enums.size} enums, ${fnRows.length} function(s)`,
)
