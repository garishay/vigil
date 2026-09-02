import { useCallback, useEffect, useState } from 'react'
import { REPLAY } from '../config/replay'

/**
 * How a tick is scheduled: run `tick` every `everyMs`, and return the cancel. The default is
 * `setInterval`; a test hands in a scheduler it drives by hand, so nothing here ever waits on
 * real time — the flake the acceptance on #6 names. Ticks *are* the clock: each one advances
 * the sim clock by exactly one second and wall time is never read, so a throttled tab slows
 * the replay rather than jumping it.
 */
export type Schedule = (tick: () => void, everyMs: number) => () => void

export const intervalSchedule: Schedule = (tick, everyMs) => {
  const id = setInterval(tick, everyMs)
  return () => clearInterval(id)
}

export interface Playback {
  /** Sim time, seconds from the recording's start. */
  tSec: number
  playing: boolean
  /** The recording's last frame time, or null before the recording is in. */
  durationS: number | null
  play: () => void
  pause: () => void
  seek: (tSec: number) => void
}

/**
 * The replay clock (PR 06a). Plays from load, one second per tick, and pauses at the end of the
 * recording rather than looping — a loop would rewrite what the record means. Seek clamps to the
 * recording and keeps whatever play state it finds; Play at the end starts over.
 */
export function usePlayback(
  durationS: number | null,
  schedule: Schedule = intervalSchedule,
  tickMs: number = REPLAY.tickMs,
): Playback {
  const [tSec, setTSec] = useState(0)
  const [wantPlaying, setWantPlaying] = useState(true)
  // Derived, not stored: reaching the end pauses without an effect writing state back.
  const ended = durationS !== null && tSec >= durationS
  const playing = wantPlaying && !ended

  useEffect(() => {
    if (!playing || durationS === null) return
    return schedule(() => setTSec((t) => Math.min(t + 1, durationS)), tickMs)
  }, [playing, durationS, schedule, tickMs])

  const play = useCallback(() => {
    if (ended) setTSec(0)
    setWantPlaying(true)
  }, [ended])
  const pause = useCallback(() => setWantPlaying(false), [])
  const seek = useCallback(
    (to: number) => {
      // The state a seek finds at the end is paused; leaving the end must not silently resume.
      if (ended) setWantPlaying(false)
      setTSec(Math.max(0, Math.min(Math.floor(to), durationS ?? 0)))
    },
    [durationS, ended],
  )

  return { tSec, playing, durationS, play, pause, seek }
}
