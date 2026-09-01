import { render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TrackVisuals } from './TrackVisuals'
import type { Photo, PhotoLookup } from '../data/photos'
import type { AdsbTrack, InjectTrack } from '../lib/tracks'

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

const HEARD: InjectTrack = {
  id: 'inject-01',
  source: 'inject',
  behavior: 'transit',
  remoteId: 'broadcasting',
  uaType: 'multirotor',
  identity: 'cooperative',
  callsign: 'UAS-7CD5',
  position: [-75.2, 39.8],
  altitudeFt: 56,
  onGround: false,
  groundSpeedKt: 12,
  headingDeg: 90,
  verticalRateFpm: 0,
  lastSeenSec: 0,
}

const PHOTO: Photo = {
  src: 'https://t.plnspttrs.net/29312/1937237_5d0d7eeadb_t.jpg',
  width: 200,
  height: 133,
  link: 'https://www.planespotters.net/photo/1937237/n120dn?utm_source=api',
  photographer: 'OMGcat',
}

const resolved = (photo: Photo | null): PhotoLookup => vi.fn(async () => photo)
const silhouette = () => document.querySelector('.visuals__image svg')

describe('TrackVisuals — the photo tier (03d)', () => {
  it('holds the silhouette while the lookup is pending, with no indicator and no credit', () => {
    const pending: PhotoLookup = vi.fn(() => new Promise<Photo | null>(() => {}))
    render(<TrackVisuals track={DAL989} lookupPhoto={pending} />)
    expect(pending).toHaveBeenCalledWith(DAL989)
    expect(silhouette()).not.toBeNull()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(/Planespotters/)).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    // The 03c lines beneath are untouched by the tier above them.
    expect(screen.getByText('Narrowbody')).toBeInTheDocument()
    expect(screen.getByText('from type code A321 (registry lookup)')).toBeInTheDocument()
  })

  it('swaps the photo in as one plain anchor to its page, credited beside it, on a hit', async () => {
    render(<TrackVisuals track={DAL989} lookupPhoto={resolved(PHOTO)} />)
    const link = await screen.findByRole('link', { name: '© OMGcat · Planespotters.net' })
    // The link URL from the API response, unchanged; a new tab; `noopener`, never `nofollow`.
    expect(link).toHaveAttribute('href', PHOTO.link)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener')
    expect(link.getAttribute('rel')).not.toMatch(/nofollow/)
    // The image loads from their URL, unchanged, and says nothing twice: the credit names the
    // anchor and the class line beside it names the airframe.
    const img = link.querySelector('img')
    expect(img).toHaveAttribute('src', PHOTO.src)
    expect(img).toHaveAttribute('width', '200')
    expect(img).toHaveAttribute('height', '133')
    expect(img).toHaveAttribute('alt', '')
    expect(silhouette()).toBeNull()
    expect(screen.getByText('Narrowbody')).toBeInTheDocument()
    expect(screen.getByText('from type code A321 (registry lookup)')).toBeInTheDocument()
  })

  it('holds the silhouette on a miss, byte-for-byte the pending state', async () => {
    const lookup = resolved(null)
    render(<TrackVisuals track={DAL989} lookupPhoto={lookup} />)
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(silhouette()).not.toBeNull()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(document.querySelector('.visuals')?.textContent).not.toMatch(/error|unavailable|photo/i)
  })

  it('never asks about an inject', async () => {
    const lookup = resolved(PHOTO)
    render(<TrackVisuals track={HEARD} lookupPhoto={lookup} />)
    await Promise.resolve()
    expect(lookup).not.toHaveBeenCalled()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(silhouette()).not.toBeNull()
  })

  it('ignores a result that lands after unmount, and does not abort the shared request', async () => {
    let settle: (photo: Photo | null) => void = () => {}
    const lookup: PhotoLookup = vi.fn(
      () => new Promise<Photo | null>((resolve) => (settle = resolve)),
    )
    const { unmount } = render(<TrackVisuals track={DAL989} lookupPhoto={lookup} />)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    unmount()
    settle(PHOTO)
    await Promise.resolve()
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('survives a lookup that forgets to fail soft', async () => {
    const rejecting: PhotoLookup = vi.fn(async () => {
      throw new Error('a stub that rejects')
    })
    render(<TrackVisuals track={DAL989} lookupPhoto={rejecting} />)
    await waitFor(() => expect(rejecting).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(silhouette()).not.toBeNull()
  })

  // Review round 1: the hook guards this itself; App's per-track key is a convention, not the rule.
  it('drops the last track’s photo the moment the track changes, inject or ADS-B', async () => {
    const lookup = resolved(PHOTO)
    const { rerender } = render(<TrackVisuals track={DAL989} lookupPhoto={lookup} />)
    await screen.findByRole('link', { name: '© OMGcat · Planespotters.net' })

    // Same instance, now an inject: no photo may sit above an inject's class line, ever.
    rerender(<TrackVisuals track={HEARD} lookupPhoto={lookup} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(silhouette()).not.toBeNull()
    expect(screen.getByText('Small multirotor')).toBeInTheDocument()
    expect(lookup).toHaveBeenCalledTimes(1)

    // Back to an ADS-B track whose lookup is still pending: the silhouette, not the old photo.
    const pending: PhotoLookup = vi.fn(() => new Promise<Photo | null>(() => {}))
    rerender(<TrackVisuals track={DAL989} lookupPhoto={lookup} />)
    await screen.findByRole('link', { name: '© OMGcat · Planespotters.net' })
    rerender(
      <TrackVisuals
        track={{ ...DAL989, id: 'adsb-c00b80', icaoHex: 'c00b80' }}
        lookupPhoto={pending}
      />,
    )
    expect(pending).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(silhouette()).not.toBeNull()
  })

  it('asks once per mount under StrictMode — the cache, not the hook, de-duplicates', async () => {
    const lookup = resolved(PHOTO)
    render(
      <StrictMode>
        <TrackVisuals track={DAL989} lookupPhoto={lookup} />
      </StrictMode>,
    )
    await screen.findByRole('link', { name: '© OMGcat · Planespotters.net' })
    // Two effect runs, two calls, one request: `lookupPhoto` shares the in-flight promise.
    expect(lookup).toHaveBeenCalledTimes(2)
  })
})
