import { describe, expect, it } from 'vitest'
import { BUILD_DEFAULTS, SessionRefusal, parseFeedRef, resolveSession } from './session'
import { DEFAULT_RECORDING, RECORDINGS } from '../config/recordings'
import { SCENARIO } from '../config/scenario'

const ON = { on: true, seed: SCENARIO.seed }
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
    expect(resolveSession('')).toEqual({ feeds: [rec(DEFAULT_RECORDING.id)], scenario: ON })
    expect(resolveSession('?other=1')).toEqual({ feeds: [rec('vigil-phl-001')], scenario: ON })
  })

  it('reads the build’s env as layer (a), and the URL over it as layer (c)', () => {
    const env = { VITE_DEFAULT_FEEDS: 'recording:vigil-phl-002', VITE_DEFAULT_SCENARIO: 'off' }
    expect(resolveSession('', env)).toEqual({ feeds: [rec('vigil-phl-002')], scenario: OFF })
    expect(resolveSession('?feed=recording:vigil-phl-001&scenario=on', env)).toEqual({
      feeds: [rec('vigil-phl-001')],
      scenario: ON,
    })
    // Each variable on its own: the other keeps the build's fallback.
    expect(resolveSession('', { VITE_DEFAULT_SCENARIO: 'off' })).toEqual({
      feeds: [rec('vigil-phl-001')],
      scenario: OFF,
    })
  })

  it('keeps ?recording=<id> as the alias for ?feed=recording:<id> — the Tuesday link', () => {
    expect(resolveSession('?recording=vigil-phl-002')).toEqual({
      feeds: [rec('vigil-phl-002')],
      scenario: ON,
    })
    expect(resolveSession('?feed=recording:vigil-phl-002&scenario=off')).toEqual({
      feeds: [rec('vigil-phl-002')],
      scenario: OFF,
    })
  })

  it('folds the alias away beside a ?feed= that names the same recording, and refuses a different one (A6, amended)', () => {
    expect(resolveSession('?feed=recording:vigil-phl-002&recording=vigil-phl-002')).toEqual({
      feeds: [rec('vigil-phl-002')],
      scenario: ON,
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

  it('reads ?scenario= as on or off and nothing else, in the URL or the env', () => {
    expect(refusal('?scenario=maybe')).toBe('?scenario= reads on or off, not "maybe"')
    expect(refusal('?scenario=')).toBe('?scenario= reads on or off, not ""')
    expect(refusal('', { VITE_DEFAULT_SCENARIO: 'yes' })).toBe(
      'VITE_DEFAULT_SCENARIO reads on or off, not "yes"',
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
    })
    expect(() => resolveSession('?recording=vigil-phl-002', {}, RECORDINGS.slice(0, 1))).toThrow(
      'No recording named "vigil-phl-002"',
    )
    expect(resolveSession('', {}, RECORDINGS, 'other-seed').scenario).toEqual({
      on: true,
      seed: 'other-seed',
    })
  })
})
