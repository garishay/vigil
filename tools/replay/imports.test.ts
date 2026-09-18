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

/** A bare `import '…'`: no bindings, loaded for its side effects, and an edge like any other. */
const BARE = /^[ \t]*import\s+['"]([^'"]+)['"]/
/** `import … from '…'`, with the `type` modifier captured so the erased form can be dropped. */
const FROM = /^[ \t]*import\s+(type\s+)?[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/
/** `export * from '…'`, `export * as ns from '…'`, `export { … } from '…'`. */
const EXPORT_FROM =
  /^[ \t]*export\s+(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[\s\S]*?\})\s*from\s+['"]([^'"]+)['"]/

/**
 * Each `import`/`export` statement as its own text, from the line that opens it to the line that
 * opens the next. A statement is read inside its own slice and never across one: a pattern that
 * searched the whole file for the next `from` would let a bare `import '…'` be swallowed by the
 * named import below it, and take everything that module reaches off the graph with it.
 */
const statements = (source: string): string[] => {
  const starts = [...source.matchAll(/^[ \t]*(?:import|export)\b/gm)].map((match) => match.index)
  return starts.map((start, i) => source.slice(start, starts[i + 1] ?? source.length))
}

/** `import … from '…'` and `export … from '…'`, less the ones the emit drops whole. */
function valueSpecifiers(source: string): string[] {
  const out: string[] = []
  for (const statement of statements(source)) {
    const bare = BARE.exec(statement)
    if (bare !== null) {
      out.push(bare[1])
      continue
    }
    const reexport = EXPORT_FROM.exec(statement)
    if (reexport !== null) {
      out.push(reexport[1])
      continue
    }
    const from = FROM.exec(statement)
    if (from !== null && from[1] === undefined) out.push(from[2])
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
    // A module reached only by a bare `import '…'` is on the graph — `MapView.tsx` loads the
    // worker shim that way, and before round 1's fix the walk lost it and everything under it,
    // so a `node:` import anywhere in that subtree passed both pins (round 1, finding 1).
    expect(graph.has('src/lib/maplibreWorker.ts')).toBe(true)
    expect(notBrowserSafe(graph)).toEqual([])
    // `main.tsx` names the sheet page, but only through a dynamic `import()` — a chunk of its
    // own, which the app never fetches unless `?sheet` is opened (S6a-ii, ruled B2, R1).
    expect(readFileSync('src/main.tsx', 'utf8')).toContain("import('./components/SheetPage.tsx')")
    expect(graph.has('src/components/SheetPage.tsx')).toBe(false)
    // And the results view the same way, from the See your results click (S6a-iii-b): a
    // subject who never presses it never downloads the replay tool, nor the roles table.
    expect(readFileSync('src/App.tsx', 'utf8')).toContain("import('./components/RunResults.tsx')")
    expect(graph.has('src/components/RunResults.tsx')).toBe(false)
    expect(graph.has('src/data/sheet.ts')).toBe(false)
  })

  it('carries the roles table on the sheet page’s own graph, so R1 is not a vacuous pin', () => {
    // Said from the other end too: the page really does reach the answer key — it cannot draw a
    // sheet without it — so the test above is a statement about a separation rather than about a
    // module nothing imports. And the page's own graph is browser-safe, which is what S6a-i's
    // move was for.
    for (const entry of ['src/components/SheetPage.tsx', 'src/components/RunResults.tsx']) {
      const door = graphFrom(entry)
      expect(door.has('scripts/study-spec.ts')).toBe(true)
      expect(door.has('tools/replay/sheet.ts')).toBe(true)
      expect(notBrowserSafe(door)).toEqual([])
    }
    const page = graphFrom('src/components/SheetPage.tsx')
    expect(page.has('scripts/study-spec.ts')).toBe(true)
    expect(page.has('tools/replay/sheet.ts')).toBe(true)
    expect(page.has('tools/replay/files.ts')).toBe(false)
    expect(notBrowserSafe(page)).toEqual([])
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
    // A dynamic `import()` is deliberately not an edge: it is the seam a chunk is split on, and
    // R1's whole point is that what it reaches is not on the graph that reaches it.
    expect(valueSpecifiers("void import('./SheetPage.tsx').then((m) => m.SheetPage)")).toEqual([])
    expect(
      valueSpecifiers("import { a } from './a.ts'\nconst b = () => import('./b.tsx')\n"),
    ).toEqual(['./a.ts'])
  })

  it('records a bare import and a namespace re-export, and reads each statement in its own slice', () => {
    // `MapView.tsx`'s own shape, the case round 1 named: two bare imports above a named one.
    // Before the fix the first pattern's lazy clause ran from line 1 through line 2 to line 3's
    // `from`, so it returned ['./IdentityDot'] alone and both bare edges were lost.
    expect(
      valueSpecifiers(
        "import 'maplibre-gl/dist/maplibre-gl.css'\n" +
          "import '../lib/maplibreWorker'\n" +
          "import { IdentityLegend } from './IdentityDot'\n",
      ),
    ).toEqual(['maplibre-gl/dist/maplibre-gl.css', '../lib/maplibreWorker', './IdentityDot'])
    expect(valueSpecifiers("export * as spec from './spec.ts'")).toEqual(['./spec.ts'])
    // A multi-line clause still reads as one statement, and an export with no `from` is no edge.
    expect(valueSpecifiers("import {\n  A,\n  B,\n} from './a.ts'\nexport { A }\n")).toEqual([
      './a.ts',
    ])
    // A slice never reaches past the statement that opens the next one: a bare import followed
    // by a type-only import yields the bare edge and nothing else.
    expect(valueSpecifiers("import './side.ts'\nimport type { X } from './types.ts'\n")).toEqual([
      './side.ts',
    ])
  })
})
