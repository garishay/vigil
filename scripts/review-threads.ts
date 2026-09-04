/**
 * Lists a pull request's unresolved inline review threads (CLAUDE.md, "Enforced, not written";
 * #45 [G28]). `gh pr view` shows a PR's conversation and misses the threads on its Files tab,
 * and an unresolved thread blocks the merge — so "clean" is a computed claim rather than a
 * recollection: this prints every open thread with its file, line, author, and first line, and
 * exits 1 while any remain, 0 when none do.
 *
 *   node scripts/review-threads.ts <pr-number>
 *
 * The reading is a pure function of the GraphQL payload, so the test feeds it payloads and
 * never reaches the network; the one call is `gh`'s, made only by `main`. The first hundred
 * threads are read — no PR here has come near that.
 */

import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

export interface ReviewThread {
  path: string
  line: number | null
  author: string
  /** The first non-empty line of the thread's first comment. */
  summary: string
}

interface ThreadNode {
  isResolved: boolean
  path: string
  line: number | null
  comments: { nodes: { author: { login: string } | null; body: string }[] }
}

export interface ThreadsPayload {
  data?: {
    repository?: {
      pullRequest?: { reviewThreads?: { nodes?: ThreadNode[] } } | null
    }
  }
}

/** The open threads, in the order GitHub lists them. */
export function unresolvedThreads(payload: ThreadsPayload): ReviewThread[] {
  const nodes = payload.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
  return nodes
    .filter((thread) => !thread.isResolved)
    .map((thread) => {
      const first = thread.comments.nodes[0]
      return {
        path: thread.path,
        line: thread.line,
        author: first?.author?.login ?? 'unknown',
        summary:
          (first?.body ?? '')
            .split('\n')
            .find((line) => line.trim() !== '')
            ?.trim() ?? '',
      }
    })
}

/** One line per thread, or the clean claim. */
export function report(threads: readonly ReviewThread[]): string {
  if (threads.length === 0) return 'No unresolved review threads.'
  return [
    `${threads.length} unresolved review thread${threads.length === 1 ? '' : 's'}:`,
    ...threads.map((t) => `  ${t.path}:${t.line ?? '-'}  [${t.author}] ${t.summary}`),
  ].join('\n')
}

const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes { isResolved path line comments(first: 1) { nodes { author { login } body } } }
      }
    }
  }
}`

function main(): void {
  const number = Number(process.argv[2])
  if (!Number.isInteger(number) || number <= 0) {
    process.stderr.write('usage: node scripts/review-threads.ts <pr-number>\n')
    process.exit(2)
  }
  const repo = JSON.parse(
    execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], { encoding: 'utf8' }),
  ) as { nameWithOwner: string }
  const [owner, name] = repo.nameWithOwner.split('/')
  const payload = JSON.parse(
    execFileSync(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${QUERY}`,
        '-f',
        `owner=${owner}`,
        '-f',
        `name=${name}`,
        '-F',
        `number=${number}`,
      ],
      { encoding: 'utf8' },
    ),
  ) as ThreadsPayload
  const threads = unresolvedThreads(payload)
  process.stdout.write(`${report(threads)}\n`)
  process.exit(threads.length === 0 ? 0 : 1)
}

if (process.argv[1] && basename(process.argv[1]) === 'review-threads.ts') main()
