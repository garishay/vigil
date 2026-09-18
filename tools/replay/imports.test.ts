import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The sheet's path is bundled for a browser (S6a-i, #165, ruled A7, R1), so two things about it
 * are pinned rather than remembered: nothing on it reaches for Node, and the study's roles table
 * — the answer key — is not on the app's own static graph.
 *
 * The walk follows *value* imports. `verbatimModuleSyntax` drops `import type … from` entirely
 * and keeps everything else, including `import { type X } from`, which still emits `import {}`
 * and so still pulls the module in. The walk keeps that rule exactly, so it over-includes rather
 * than under-includes: a graph this says is clean is clean in the bundle.
 */

const ROOT = process.cwd()
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

/** `import … from '…'` and `export … from '…'`, less the ones the emit drops whole. */
function valueSpecifiers(source: string): string[] {
  const out: string[] = []
  for (const match of source.matchAll(/^\s*import\s+(type\s+)?[\s\S]*?from\s+['"]([^'"]+)['"]/gm)) {
    if (match[1] === undefined) out.push(match[2])
  }
  for (const match of source.matchAll(
    /^\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/gm,
  )) {
    out.push(match[1])
  }
  return out
}

const resolveSpecifier = (from: string, specifier: string): string | null => {
  for (const extension of EXTENSIONS) {
    const candidate = resolve(dirname(from), specifier + extension)
    // A source file, not a directory of that name and not a stylesheet: `./config/scenarios`
    // resolves to `scenarios/` on disk and to `scenarios.ts` under the bundler's rules.
    if (/\.tsx?$/.test(candidate) && existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

interface Module {
  /** Repo-relative, forward slashes — the name this file's expectations use. */
  path: string
  /** The `node:` specifiers the module imports, if any. */
  builtins: string[]
  /** Whether it reads `process` at the top level, which a bundle has no `process` for. */
  reachesProcess: boolean
  /** The module that first reached it. */
  from: string
}

/** Every module on the value graph from an entry, keyed by its repo-relative path. */
function graphFrom(entry: string): Map<string, Module> {
  const found = new Map<string, Module>()
  const walk = (file: string, from: string) => {
    const path = relative(ROOT, file).replaceAll('\\', '/')
    if (found.has(path)) return
    const source = readFileSync(file, 'utf8')
    found.set(path, {
      path,
      builtins: [...source.matchAll(/from\s+['"](node:[^'"]+)['"]/g)].map((match) => match[1]),
      reachesProcess: /^[^\n]*\bprocess\./m.test(source),
      from,
    })
    for (const specifier of valueSpecifiers(source)) {
      if (specifier.startsWith('node:') || !specifier.startsWith('.')) continue
      const next = resolveSpecifier(file, specifier)
      if (next !== null) walk(next, path)
    }
  }
  walk(resolve(ROOT, entry), '(entry)')
  return found
}

const notBrowserSafe = (graph: Map<string, Module>) =>
  [...graph.values()]
    .filter((module) => module.builtins.length > 0 || module.reachesProcess)
    .map((module) => `${module.path} ← ${module.from}`)

describe('the sheet renders in a browser (S6a-i, #165, ruled A7, R1)', () => {
  it('reaches no node: import and no process on the value graph from the sheet', () => {
    const graph = graphFrom('tools/replay/sheet.ts')
    // The walk found the tool, not a stub of it: the renderer, the metrics and the engine are on
    // it, so a clean result is a statement about the real path (#165's gate measured 37).
    expect([...graph.keys()]).toEqual(
      expect.arrayContaining([
        'tools/replay/sheet.ts',
        'tools/replay/frame.ts',
        'tools/replay/metrics.ts',
        'tools/replay/engine.ts',
        'tools/replay/figure.ts',
        'tools/replay/pair.ts',
        'tools/replay/regenerate.ts',
        'tools/replay/load.ts',
        'src/lib/injects.ts',
        'src/lib/scoring.ts',
      ]),
    )
    expect(graph.size).toBeGreaterThan(30)
    // On `main` this fails, naming both: `scripts/study.ts ← tools/replay/metrics.ts` (node:fs,
    // node:path, and a top-level process.argv block a bundler cannot drop) and
    // `tools/replay/load.ts ← tools/replay/metrics.ts` (node:fs).
    expect(notBrowserSafe(graph)).toEqual([])
    // The roles table is still read, from the pure module; the disk is reached from `files.ts`,
    // which is the CLI's and is not on this path.
    expect(graph.has('scripts/study-spec.ts')).toBe(true)
    expect(graph.has('scripts/study.ts')).toBe(false)
    expect(graph.has('tools/replay/files.ts')).toBe(false)
  })

  it('keeps the roles table and the tool off the app’s own static graph (R1)', () => {
    const graph = graphFrom('src/main.tsx')
    expect(graph.has('src/App.tsx')).toBe(true)
    // The answer key names each scenario's threats. A build a subject runs must not carry it on
    // the run's own path: at S6a-ii the sheet page is reached by a dynamic `import()`, which is a
    // chunk of its own and is not a static edge, so this stays true when the page lands.
    expect(graph.has('scripts/study-spec.ts')).toBe(false)
    expect([...graph.keys()].filter((path) => path.startsWith('tools/'))).toEqual([])
    expect(notBrowserSafe(graph)).toEqual([])
  })

  it('follows a value import through a type-modified binding, and drops an import type line', () => {
    // The two shapes the rule turns on, so a walk that got them backwards would fail here rather
    // than quietly call a dirty graph clean.
    expect(valueSpecifiers("import { STUDY_CAST, type Family } from './spec.ts'")).toEqual([
      './spec.ts',
    ])
    expect(valueSpecifiers("import { type Family } from './spec.ts'")).toEqual(['./spec.ts'])
    expect(valueSpecifiers("import type { Family } from './spec.ts'")).toEqual([])
    expect(valueSpecifiers("import type {\n  Family,\n} from './spec.ts'")).toEqual([])
    expect(valueSpecifiers("export * from './spec.ts'")).toEqual(['./spec.ts'])
    expect(valueSpecifiers("export { STUDY_CAST } from './spec.ts'")).toEqual(['./spec.ts'])
  })
})
