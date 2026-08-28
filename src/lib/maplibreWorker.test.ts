import { describe, expect, it, vi } from 'vitest'

const { setWorkerUrl } = vi.hoisted(() => ({ setWorkerUrl: vi.fn() }))

vi.mock('maplibre-gl', () => ({ setWorkerUrl }))

describe('maplibre worker wiring', () => {
  it('hands MapLibre a bundled worker URL', async () => {
    await import('./maplibreWorker')
    expect(setWorkerUrl).toHaveBeenCalledTimes(1)
    expect(setWorkerUrl).toHaveBeenCalledWith(expect.stringContaining('worker'))
  })
})
