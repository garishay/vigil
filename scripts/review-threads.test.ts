import { describe, expect, it } from 'vitest'
import { report, unresolvedThreads, type ThreadsPayload } from './review-threads.ts'

const thread = (
  isResolved: boolean,
  path: string,
  line: number | null,
  body: string,
  login: string | null = 'claude',
) => ({
  isResolved,
  path,
  line,
  comments: { nodes: [{ author: login === null ? null : { login }, body }] },
})

const payload = (nodes: ReturnType<typeof thread>[]): ThreadsPayload => ({
  data: { repository: { pullRequest: { reviewThreads: { nodes } } } },
})

describe('review-threads (#45 [G28])', () => {
  it('lists only the unresolved threads, in order, with the first line of the first comment', () => {
    const threads = unresolvedThreads(
      payload([
        thread(true, 'src/App.tsx', 12, '**Fixed already.**\nMore.'),
        thread(
          false,
          'src/lib/scoring.ts',
          315,
          '\n\n**The `not moving` early return**\n\nDetail.',
        ),
        thread(false, 'README.md', null, 'The diagram gained this edge but not the module.', null),
      ]),
    )
    expect(threads).toEqual([
      {
        path: 'src/lib/scoring.ts',
        line: 315,
        author: 'claude',
        summary: '**The `not moving` early return**',
      },
      {
        path: 'README.md',
        line: null,
        author: 'unknown',
        summary: 'The diagram gained this edge but not the module.',
      },
    ])
  })

  it('reads an empty or missing payload as clean rather than crashing', () => {
    expect(unresolvedThreads({})).toEqual([])
    expect(unresolvedThreads({ data: { repository: { pullRequest: null } } })).toEqual([])
    expect(unresolvedThreads(payload([thread(true, 'a.ts', 1, 'done')]))).toEqual([])
  })

  it('reports one line per open thread, and the clean claim when there are none', () => {
    expect(report([])).toBe('No unresolved review threads.')
    expect(
      report([
        { path: 'src/App.tsx', line: 661, author: 'claude', summary: 'A stale refusal.' },
        { path: 'README.md', line: null, author: 'claude', summary: 'Missing module.' },
      ]),
    ).toBe(
      [
        '2 unresolved review threads:',
        '  src/App.tsx:661  [claude] A stale refusal.',
        '  README.md:-  [claude] Missing module.',
      ].join('\n'),
    )
    expect(report([{ path: 'a.ts', line: 1, author: 'x', summary: 's' }]).split('\n')[0]).toBe(
      '1 unresolved review thread:',
    )
  })
})
