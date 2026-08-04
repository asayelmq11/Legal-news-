/**
 * Every `'use server'` module must export async functions and nothing else.
 *
 * Next.js turns each export of such a file into a callable RPC endpoint, so an
 * exported object is not merely untidy — it is rejected at module evaluation,
 * and the page that imports it crashes at runtime with
 *
 *     A "use server" file can only export async functions, found object.
 *
 * That is a *runtime* failure. `tsc` is happy, `next build` is happy, the route
 * compiles — and then the Ops page dies the first time somebody opens it. This
 * test is the check that build success cannot provide.
 *
 * It discovers the files itself, so a new action module is covered the moment
 * it is written, without anyone remembering to add it here.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const ROOTS = ['app', 'components', 'lib']

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path)
    }
  }
  return found
}

function hasUseServerDirective(file: ts.SourceFile): boolean {
  const [first] = file.statements
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server'
  )
}

/** Describes each export that is not an async function declaration. */
function offendingExports(file: ts.SourceFile): string[] {
  const offenders: string[] = []

  for (const statement of file.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : []
    const exported = modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

    // `export { … }` / `export * from …` — allowed only when type-only, since
    // those disappear before runtime.
    if (ts.isExportDeclaration(statement)) {
      if (!statement.isTypeOnly) offenders.push('export { … } (value re-export)')
      continue
    }

    if (ts.isExportAssignment(statement)) {
      offenders.push('export default')
      continue
    }

    if (!exported) continue

    // Types and interfaces are erased — they never become an RPC endpoint.
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue

    if (ts.isFunctionDeclaration(statement)) {
      const isAsync = modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
      if (!isAsync) offenders.push(`function ${statement.name?.text ?? '(anonymous)'} (not async)`)
      continue
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        offenders.push(`const/let ${declaration.name.getText(file)}`)
      }
      continue
    }

    if (ts.isClassDeclaration(statement)) {
      offenders.push(`class ${statement.name?.text ?? '(anonymous)'}`)
      continue
    }

    if (ts.isEnumDeclaration(statement)) {
      offenders.push(`enum ${statement.name.text}`)
      continue
    }

    offenders.push(ts.SyntaxKind[statement.kind])
  }

  return offenders
}

const serverActionModules = ROOTS.flatMap(sourceFiles)
  .map((path) => ({
    path,
    file: ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  }))
  .filter(({ file }) => hasUseServerDirective(file))

/* -------------------------------------------------------------------------- */

describe("'use server' modules export async functions only", () => {
  it('finds the action modules to check', () => {
    // A discovery bug would make every assertion below vacuously pass.
    expect(serverActionModules.length).toBeGreaterThanOrEqual(2)
    expect(serverActionModules.map((m) => m.path)).toContain(join('lib', 'admin', 'actions.ts'))
    expect(serverActionModules.map((m) => m.path)).toContain(join('lib', 'auth', 'actions.ts'))
  })

  it.each(serverActionModules.map((m) => m.path))('%s exports only async functions', (path) => {
    const target = serverActionModules.find((m) => m.path === path)
    expect(target).toBeDefined()
    expect(offendingExports(target!.file)).toEqual([])
  })

  it('every export is reachable as a Server Action', () => {
    for (const { path, file } of serverActionModules) {
      const exportedFunctions = file.statements.filter(
        (statement) =>
          ts.isFunctionDeclaration(statement) &&
          (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
      )
      expect(exportedFunctions.length, `${path} exports no actions`).toBeGreaterThan(0)
    }
  })
})

describe('the detector actually detects', () => {
  function parse(code: string): ts.SourceFile {
    return ts.createSourceFile('probe.ts', code, ts.ScriptTarget.Latest, true)
  }

  it('flags a non-async export sitting beside a valid action', () => {
    const offenders = offendingExports(
      parse(`'use server'
export const IDLE = { ok: false, message: null }
export async function doThing() {}`),
    )

    expect(offenders).toEqual(['const/let IDLE'])
  })

  it('flags a non-async exported function', () => {
    expect(offendingExports(parse(`'use server'\nexport function helper() {}`))).toEqual([
      'function helper (not async)',
    ])
  })

  it('flags an exported class, enum, default export and value re-export', () => {
    expect(offendingExports(parse(`'use server'\nexport class Thing {}`))).toEqual(['class Thing'])
    expect(offendingExports(parse(`'use server'\nexport enum Kind { A }`))).toEqual(['enum Kind'])
    expect(offendingExports(parse(`'use server'\nexport default 1`))).toEqual(['export default'])
    expect(offendingExports(parse(`'use server'\nexport { x } from './x'`))).toEqual([
      'export { … } (value re-export)',
    ])
  })

  it('allows types, interfaces and type-only re-exports — they are erased', () => {
    expect(
      offendingExports(
        parse(`'use server'
export type State = { ok: boolean }
export interface Other { a: string }
export type { Thing } from './thing'
export async function act() {}`),
      ),
    ).toEqual([])
  })

  it('ignores a module with no use-server directive', () => {
    expect(hasUseServerDirective(parse(`export const IDLE = {}`))).toBe(false)
    expect(hasUseServerDirective(parse(`'use client'\nexport const IDLE = {}`))).toBe(false)
  })
})
