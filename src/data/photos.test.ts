import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPhotoCache, lookupPhoto, type Photo } from './photos'
import type { AdsbTrack } from '../lib/tracks'

// Frame 0's DAL989, a real hex probed on 2026-09-01; the body below is the API's answer for it.
const DAL989: AdsbTrack = {
  id: 'adsb-a0540a',
  source: 'adsb',
  icaoHex: 'a0540a',
  identity: 'cooperative',
  callsign: 'DAL989',
  position: [-75.0, 39.9],
  altitudeFt: 24825,
  onGround: false,
  groundSpeedKt: 420,
  headingDeg: 250,
  verticalRateFpm: 0,
  lastSeenSec: 0,
  category: 'A3',
  registry: { typeCode: 'A321', registration: 'N120DN' },
}

const other = (hex: string): AdsbTrack => ({ ...DAL989, id: `adsb-${hex}`, icaoHex: hex })

const HIT = {
  photos: [
    {
      id: '1937237',
      thumbnail: {
        src: 'https://t.plnspttrs.net/29312/1937237_5d0d7eeadb_t.jpg',
        size: { width: 200, height: 133 },
      },
      thumbnail_large: {
        src: 'https://t.plnspttrs.net/29312/1937237_5d0d7eeadb_280.jpg',
        size: { width: 419, height: 280 },
      },
      link: 'https://www.planespotters.net/photo/1937237/n120dn-delta-air-lines-airbus-a321-211-wl?utm_source=api',
      photographer: 'OMGcat',
    },
  ],
}

const PHOTO: Photo = {
  src: 'https://t.plnspttrs.net/29312/1937237_5d0d7eeadb_t.jpg',
  width: 200,
  height: 133,
  link: 'https://www.planespotters.net/photo/1937237/n120dn-delta-air-lines-airbus-a321-211-wl?utm_source=api',
  photographer: 'OMGcat',
}

/** A fetcher answering with a JSON body; `json` rejects for a body that is not JSON. */
const respondWith = (body: unknown, status = 200) =>
  vi.fn(
    async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
          if (body === undefined) throw new SyntaxError('not JSON')
          return body
        },
      }) as unknown as Response,
  )

beforeEach(clearPhotoCache)
afterEach(() => vi.useRealTimers())

describe('lookupPhoto', () => {
  it('keeps exactly the four fields the terms need from a hit, and asks by hex', async () => {
    const fetcher = respondWith(HIT)
    await expect(lookupPhoto(DAL989, fetcher)).resolves.toEqual(PHOTO)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.planespotters.net/pub/photos/hex/a0540a')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  // Fail-soft keys on the body's shape, never on the status alone: every row here is a 200.
  it.each([
    ['a true miss', { photos: [] }],
    ['a malformed hex — an error body with no photos key', { error: 'Hex invalid or missing' }],
    ['a body that is not JSON', undefined],
    ['a body that is not an object', 'photos'],
    [
      'an entry with no photographer to credit',
      { photos: [{ ...HIT.photos[0], photographer: 1 }] },
    ],
    ['an entry with no page to link', { photos: [{ ...HIT.photos[0], link: undefined }] }],
    ['an entry with no thumbnail', { photos: [{ ...HIT.photos[0], thumbnail: null }] }],
  ])('answers null for %s', async (_case, body) => {
    await expect(lookupPhoto(DAL989, respondWith(body))).resolves.toBeNull()
  })

  it('answers null for a client error', async () => {
    await expect(lookupPhoto(DAL989, respondWith({ error: 'forbidden' }, 403))).resolves.toBeNull()
    await expect(lookupPhoto(other('c00b80'), respondWith(undefined, 404))).resolves.toBeNull()
  })

  it('never asks about a TIS-B/MLAT track — a `~` hex has no registry behind it', async () => {
    const fetcher = respondWith(HIT)
    await expect(lookupPhoto(other('~a0540a'), fetcher)).resolves.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('answers null for a thrown fetch, and never rejects', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expect(lookupPhoto(DAL989, fetcher)).resolves.toBeNull()
  })

  it('gives up after five seconds, holding the silhouette rather than a spinner', async () => {
    vi.useFakeTimers()
    // A fetcher that answers only when aborted — the shape of a stalled network.
    const fetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')))
        }),
    ) as unknown as typeof fetch
    const result = lookupPhoto(DAL989, fetcher)
    await vi.advanceTimersByTimeAsync(4999)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBeNull()
  })

  describe('the session cache', () => {
    it('makes no second request for a hex already answered — hit or definitive miss', async () => {
      const hit = respondWith(HIT)
      await lookupPhoto(DAL989, hit)
      await expect(lookupPhoto(DAL989, hit)).resolves.toEqual(PHOTO)
      expect(hit).toHaveBeenCalledTimes(1)

      for (const body of [{ photos: [] }, { error: 'Hex invalid or missing' }]) {
        clearPhotoCache()
        const miss = respondWith(body)
        await lookupPhoto(DAL989, miss)
        await lookupPhoto(DAL989, miss)
        expect(miss).toHaveBeenCalledTimes(1)
      }
    })

    it('shares one request between concurrent callers for the same hex', async () => {
      const fetcher = respondWith(HIT)
      const [first, second] = await Promise.all([
        lookupPhoto(DAL989, fetcher),
        lookupPhoto(DAL989, fetcher),
      ])
      expect(first).toEqual(PHOTO)
      expect(second).toEqual(PHOTO)
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('keys by hex, so a different track asks once more', async () => {
      const fetcher = respondWith(HIT)
      await lookupPhoto(DAL989, fetcher)
      await lookupPhoto(other('c00b80'), fetcher)
      expect(fetcher).toHaveBeenCalledTimes(2)
    })

    // Ruled on #22 (assumption 8): a thrown fetch or a timeout says nothing definitive about the
    // hex. The next open may ask once more, so a session that started offline recovers.
    it('does not remember a thrown fetch, a rate limit, or a server failure', async () => {
      const thrown = vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof fetch
      await lookupPhoto(DAL989, thrown)
      await lookupPhoto(DAL989, thrown)
      expect(thrown).toHaveBeenCalledTimes(2)

      for (const status of [429, 503]) {
        clearPhotoCache()
        const failing = respondWith(undefined, status)
        await expect(lookupPhoto(DAL989, failing)).resolves.toBeNull()
        await lookupPhoto(DAL989, failing)
        expect(failing).toHaveBeenCalledTimes(2)
      }
    })

    it('does not remember a timeout either', async () => {
      vi.useFakeTimers()
      const stalled = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('', 'AbortError')),
            )
          }),
      ) as unknown as typeof fetch
      const first = lookupPhoto(DAL989, stalled)
      await vi.advanceTimersByTimeAsync(5000)
      await expect(first).resolves.toBeNull()
      const second = lookupPhoto(DAL989, stalled)
      await vi.advanceTimersByTimeAsync(5000)
      await expect(second).resolves.toBeNull()
      expect(stalled).toHaveBeenCalledTimes(2)
    })

    it('is cleared for tests, and only for tests — nothing is persisted', async () => {
      const fetcher = respondWith(HIT)
      await lookupPhoto(DAL989, fetcher)
      clearPhotoCache()
      await lookupPhoto(DAL989, fetcher)
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(Object.keys(localStorage)).toHaveLength(0)
    })
  })
})
