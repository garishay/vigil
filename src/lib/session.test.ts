import { describe, expect, it } from 'vitest'
import { BUILD_DEFAULTS, SessionRefusal, parseFeedRef, resolveSession } from './session'
import { DEFAULT_RECORDING, RECORDINGS } from '../config/recordings'
import { SCENARIO } from '../config/scenario'

/** `on` is the registry's first — the default deal, named default (S3b, #135; #36 [26] A). */
const ON = { on: true, name: 'default', seed: SCENARIO.seed }
const OFF = { on: false }
const rec = (id: string) => ({ kind: 'recording', id })

/** The refusal's words, or null when the session resolves — one shape for every row. */
const refusal = (search: string, env = {}) => {
  try {
    resolveSession(search, env)
    return null
  } catch (error) {
    expect(error).toBeInstanceOf(SessionRefusal)
    return (error as Error).message
  }
}

describe('resolveSession (#115, ruling 6)', () => {
  it('opens the demo with no query and no env: the default recording, the scenario on', () => {
    expect(BUILD_DEFAULTS).toEqual({ feeds: 'recording:vigil-phl-001', scenario: 'on' })
    expect(resolveSession('')).toEqual({
      feeds: [rec(DEFAULT_RECORDING.id)],
      scenario: ON,
      mode: 'vigil',
      study: null,
    })
    expect(resolveSession('?other=1')).toEqual({
      feeds: [rec('vigil-phl-001')],
      scenario: ON,
      mode: 'vigil',
      study: null,
    })
  })

  it('reads the build’s env as layer (a), and the URL over it as layer (c)', () => {
    const env = { VITE_DEFAULT_FEEDS: 'recording:vigil-phl-002', VITE_DEFAULT_SCENARIO: 'off' }
    expect(resolveSession('', env)).toEqual({
      feeds: [rec('vigil-phl-002')],
      scenario: OFF,
      mode: 'vigil',
      study: null,
    })
    expect(resolveSession('?feed=recording:vigil-phl-001&scenario=on', env)).toEqual({
      feeds: [rec('vigil-phl-001')],
      scenario: ON,
      mode: 'vigil',
      study: null,
    })
    // Each variable on its own: the other keeps the build's fallback.
    expect(resolveSession('', { VITE_DEFAULT_SCENARIO: 'off' })).toEqual({
      feeds: [rec('vigil-phl-001')],
      scenario: OFF,
      mode: 'vigil',
      study: null,
    })
  })

  it('keeps ?recording=<id> as the alias for ?feed=recording:<id> — the Tuesday link', () => {
    expect(resolveSession('?recording=vigil-phl-002')).toEqual({
      feeds: [rec('vigil-phl-002')],
      scenario: ON,
      mode: 'vigil',
      study: null,
    })
    expect(resolveSession('?feed=recording:vigil-phl-002&scenario=off')).toEqual({
      feeds: [rec('vigil-phl-002')],
      scenario: OFF,
      mode: 'vigil',
      study: null,
    })
  })

  it('folds the alias away beside a ?feed= that names the same recording, and refuses a different one (A6, amended)', () => {
    expect(resolveSession('?feed=recording:vigil-phl-002&recording=vigil-phl-002')).toEqual({
      feeds: [rec('vigil-phl-002')],
      scenario: ON,
      mode: 'vigil',
      study: null,
    })
    expect(refusal('?feed=recording:vigil-phl-001&recording=vigil-phl-002')).toBe(
      '?recording= and ?feed= name different recordings — say one',
    )
  })

  it('refuses an unknown feed kind, in the ref’s own words', () => {
    expect(refusal('?feed=sonar:1')).toBe('Feed "sonar:1" — unknown feed kind "sonar"')
    expect(() => parseFeedRef('sonar')).toThrow('Feed "sonar" — unknown feed kind "sonar"')
    expect(parseFeedRef('recording:vigil-phl-001')).toEqual(rec('vigil-phl-001'))
    expect(parseFeedRef('adsb')).toEqual({ kind: 'adsb', id: '' })
    // The first colon splits; an id may carry its own.
    expect(parseFeedRef('cot:tak:server')).toEqual({ kind: 'cot', id: 'tak:server' })
  })

  it('refuses a live kind this build has no feed for, naming the Issue that brings it', () => {
    expect(refusal('?feed=adsb')).toBe('Feed "adsb" — no adsb feed in this build (#72)')
    expect(refusal('?feed=cot:tak')).toBe('Feed "cot:tak" — no cot feed in this build (#116)')
  })

  it('refuses a recording beside a live feed before either is built — one clock kind (ruling 4)', () => {
    expect(refusal('?feed=recording:vigil-phl-001,adsb')).toBe(
      'A recording and a live feed cannot share a session — one clock kind (#115)',
    )
    expect(refusal('?feed=cot,recording:vigil-phl-002')).toBe(
      'A recording and a live feed cannot share a session — one clock kind (#115)',
    )
  })

  it('refuses two recordings, an empty feed set, and a recording the registry lacks', () => {
    expect(refusal('?feed=recording:vigil-phl-001,recording:vigil-phl-002')).toBe(
      'One recording per session',
    )
    expect(refusal('?feed=')).toBe('No feed named — a session needs at least one feed')
    expect(refusal('?feed=,')).toBe('No feed named — a session needs at least one feed')
    expect(refusal('?recording=vigil-phl-003')).toBe('No recording named "vigil-phl-003"')
    expect(refusal('?feed=recording')).toBe('No recording named ""')
    expect(refusal('', { VITE_DEFAULT_FEEDS: 'recording:vigil-phl-009' })).toBe(
      'No recording named "vigil-phl-009"',
    )
  })

  it('reads ?scenario= as on, off, or a scenario name, in the URL or the env, and lists the names it knows in the refusal (S3b, #135; #36 [26] A)', () => {
    // A name opens that scenario file — the study's link as #131 writes it; `on` is the first.
    expect(resolveSession('?feed=recording:vigil-phl-002&scenario=02a').scenario).toEqual({
      on: true,
      name: '02a',
      seed: 'study-02a',
    })
    expect(resolveSession('?recording=vigil-phl-002&scenario=02b').scenario).toEqual({
      on: true,
      name: '02b',
      seed: 'study-02b',
    })
    expect(resolveSession('?scenario=default').scenario).toEqual(ON)
    // The env reads the same grammar, and the URL still wins over it.
    expect(resolveSession('', { VITE_DEFAULT_SCENARIO: '02b' }).scenario).toEqual({
      on: true,
      name: '02b',
      seed: 'study-02b',
    })
    expect(resolveSession('?scenario=on', { VITE_DEFAULT_SCENARIO: '02b' }).scenario).toEqual(ON)
    expect(resolveSession('?scenario=off', { VITE_DEFAULT_SCENARIO: '02b' }).scenario).toEqual(OFF)
    // Anything else is refused in a sentence that names the registry — so the sentence is the
    // registry's, never a stale list.
    const names = 'default, 02a, 02b'
    expect(refusal('?scenario=maybe')).toBe(
      `?scenario= reads on, off, or a scenario name — ${names} — not "maybe"`,
    )
    expect(refusal('?scenario=')).toBe(
      `?scenario= reads on, off, or a scenario name — ${names} — not ""`,
    )
    expect(refusal('', { VITE_DEFAULT_SCENARIO: 'yes' })).toBe(
      `VITE_DEFAULT_SCENARIO reads on, off, or a scenario name — ${names} — not "yes"`,
    )
  })

  it('lets every other alias combination fall through to its own refusal (#125 round 1)', () => {
    // The cross-check fires only on a genuine disagreement — both name a recording and they
    // differ; a ?feed= naming no recording, or two, is refused for what it is.
    expect(refusal('?feed=adsb&recording=vigil-phl-001')).toBe(
      'Feed "adsb" — no adsb feed in this build (#72)',
    )
    expect(
      refusal('?feed=recording:vigil-phl-001,recording:vigil-phl-002&recording=vigil-phl-001'),
    ).toBe('One recording per session')
    expect(
      refusal('?feed=recording:vigil-phl-001,recording:vigil-phl-002&recording=vigil-phl-003'),
    ).toBe('One recording per session')
  })

  it('reads a declared-but-empty env variable as unset — the build set nothing (#125 round 1)', () => {
    // The env is the one layer the operator cannot correct from the URL: an empty string falls
    // back to the demo rather than refusing every visitor.
    expect(resolveSession('', { VITE_DEFAULT_FEEDS: '', VITE_DEFAULT_SCENARIO: '' })).toEqual({
      feeds: [rec('vigil-phl-001')],
      scenario: ON,
      mode: 'vigil',
      study: null,
    })
  })

  it('refuses a repeated ?feed= rather than picking one (#125 round 1, ruled; #36 [24] wording)', () => {
    expect(refusal('?feed=recording:vigil-phl-001&feed=recording:vigil-phl-002')).toBe(
      '?feed= is given more than once — give it once, comma-separated',
    )
    expect(refusal('?feed=recording:vigil-phl-001&feed=recording:vigil-phl-001')).toBe(
      '?feed= is given more than once — give it once, comma-separated',
    )
    // "Twice" was wrong at three; the sentence names the count it can vouch for.
    expect(refusal('?feed=adsb&feed=adsb&feed=adsb')).toBe(
      '?feed= is given more than once — give it once, comma-separated',
    )
  })

  it('refuses a repeated ?recording= rather than picking one (#36 [24], ruled)', () => {
    // The alias is the parameter an operator hand-edits: a pasted duplicate is a guess there
    // before anywhere else. Same recording or not, never picked from.
    expect(refusal('?recording=vigil-phl-001&recording=vigil-phl-002')).toBe(
      '?recording= is given more than once — give it once',
    )
    expect(refusal('?recording=vigil-phl-002&recording=vigil-phl-002')).toBe(
      '?recording= is given more than once — give it once',
    )
  })

  it('refuses a repeated ?scenario= rather than picking one (#36 [24], ruled)', () => {
    expect(refusal('?scenario=on&scenario=off')).toBe(
      '?scenario= is given more than once — give it once',
    )
    expect(refusal('?feed=recording:vigil-phl-002&scenario=off&scenario=off')).toBe(
      '?scenario= is given more than once — give it once',
    )
  })

  it('tolerates blanks in the comma list and takes the registry as a parameter', () => {
    expect(resolveSession('?feed= recording:vigil-phl-002 ,')).toEqual({
      feeds: [rec('vigil-phl-002')],
      scenario: ON,
      mode: 'vigil',
      study: null,
    })
    expect(() => resolveSession('?recording=vigil-phl-002', {}, RECORDINGS.slice(0, 1))).toThrow(
      'No recording named "vigil-phl-002"',
    )
    // The scenario registry is a parameter too: `on` is whatever it lists first.
    const other = [{ name: 'other', config: { ...SCENARIO, seed: 'other-seed' } }]
    expect(resolveSession('', {}, RECORDINGS, other).scenario).toEqual({
      on: true,
      name: 'other',
      seed: 'other-seed',
    })
    expect(() => resolveSession('?scenario=02a', {}, RECORDINGS, other)).toThrow(
      '?scenario= reads on, off, or a scenario name — other — not "02a"',
    )
  })
})

describe('?mode= — the study’s condition (S4a, #136, ruled A1)', () => {
  it('reads raw or vigil, vigil when absent, and refuses anything else in the resolver’s words', () => {
    expect(resolveSession('?feed=recording:vigil-phl-002&scenario=02a&mode=raw')).toEqual({
      feeds: [rec('vigil-phl-002')],
      scenario: { on: true, name: '02a', seed: 'study-02a' },
      mode: 'raw',
      study: null,
    })
    expect(resolveSession('?mode=vigil').mode).toBe('vigil')
    expect(resolveSession('').mode).toBe('vigil')
    expect(refusal('?mode=fast')).toBe('?mode= reads raw or vigil, not "fast"')
    expect(refusal('?mode=')).toBe('?mode= reads raw or vigil, not ""')
    expect(refusal('?mode=raw&mode=vigil')).toBe('?mode= is given more than once — give it once')
    // URL only: the env carries no mode — a run's parameter, not a build's.
    expect(resolveSession('', { VITE_DEFAULT_SCENARIO: '02a' }).mode).toBe('vigil')
  })
})

describe('?subject= and ?run= — a study run (S4b, #137, ruled A1; #131)', () => {
  it('reads both into the session, in either mode; neither is the demo', () => {
    expect(
      resolveSession('?feed=recording:vigil-phl-002&scenario=02a&mode=raw&subject=S03&run=1'),
    ).toEqual({
      feeds: [rec('vigil-phl-002')],
      scenario: { on: true, name: '02a', seed: 'study-02a' },
      mode: 'raw',
      study: { subject: 'S03', run: 1 },
    })
    expect(resolveSession('?scenario=02b&subject=p-7&run=12').study).toEqual({
      subject: 'p-7',
      run: 12,
    })
    expect(resolveSession('?scenario=02a&mode=vigil').study).toBeNull()
  })

  it('refuses one without the other, a name for a code, a run index not from 1, and a repeat — in so many words', () => {
    expect(refusal('?subject=S03')).toBe('a run link names both ?subject= and ?run=')
    expect(refusal('?run=1')).toBe('a run link names both ?subject= and ?run=')
    expect(refusal('?subject=&run=1')).toBe('?subject= is a subject code, not ""')
    expect(refusal('?subject=Gary Smith&run=1')).toBe(
      '?subject= is a subject code, not "Gary Smith"',
    )
    expect(refusal('?subject=S03&run=0')).toBe('?run= is a run number from 1, not "0"')
    expect(refusal('?subject=S03&run=')).toBe('?run= is a run number from 1, not ""')
    expect(refusal('?subject=S03&run=1.5')).toBe('?run= is a run number from 1, not "1.5"')
    expect(refusal('?subject=S03&run=two')).toBe('?run= is a run number from 1, not "two"')
    // Past the safe integer range two links would read as one run (#149 round 1).
    expect(refusal('?subject=S03&run=99999999999999999999')).toBe(
      '?run= is a run number from 1, not "99999999999999999999"',
    )
    expect(resolveSession('?scenario=02a&subject=S03&run=9007199254740991').study?.run).toBe(
      9007199254740991,
    )
    expect(refusal('?subject=S03&run=1&run=2')).toBe('?run= is given more than once — give it once')
    expect(refusal('?subject=S03&subject=S04&run=1')).toBe(
      '?subject= is given more than once — give it once',
    )
    // URL only, as the mode is: the env names no subject.
    expect(resolveSession('', { VITE_DEFAULT_SCENARIO: '02a' }).study).toBeNull()
  })
})
