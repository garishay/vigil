import { describe, expect, it } from 'vitest'
import { readThreads, report, type ThreadsPayload } from './review-threads.ts'

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

const payload = (nodes: ReturnType<typeof thread>[], hasNextPage = false): ThreadsPayload => ({
  data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage }, nodes } } } },
})

describe('review-threads (#45 [G28])', () => {
  it('lists only the unresolved threads, in order, with the first line of the first comment', () => {
    const reading = readThreads(
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
    expect(reading).toEqual({
      more: false,
      threads: [
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
      ],
    })
  })

  it('reads a PR with only resolved threads as clean', () => {
    expect(readThreads(payload([thread(true, 'a.ts', 1, 'done')]))).toEqual({
      threads: [],
      more: false,
    })
    expect(readThreads(payload([]))).toEqual({ threads: [], more: false })
  })

  it('refuses to read an absent PR as clean — a wrong number is a null, not an error (#97 review)', () => {
    expect(readThreads({})).toBeNull()
    expect(readThreads({ data: { repository: { pullRequest: null } } })).toBeNull()
    expect(readThreads({ data: { repository: null } })).toBeNull()
  })

  it('says when a page was left unread rather than claiming clean over one page (#97 review)', () => {
    const reading = readThreads(payload([thread(true, 'a.ts', 1, 'done')], true))
    expect(reading).toEqual({ threads: [], more: true })
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
