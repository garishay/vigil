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

/**
 * How the clock last moved (#101, 101a): a tick of the scheduler, or a seek — the slider, or
 * Play pressed at the end, which starts over. The alert layer reads it: an entry the record
 * writes on a tick interrupts the operator, one written on a seek is a replay and does not.
 */
export type PlaybackMove = 'tick' | 'seek'

export interface Playback {
  /** Sim time, seconds from the recording's start. */
  tSec: number
  playing: boolean
  /** Whether `tSec` last moved by a tick or by a seek; a fresh clock reads `seek`. */
  lastMove: PlaybackMove
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
  const [lastMove, setLastMove] = useState<PlaybackMove>('seek')
  // Derived, not stored: reaching the end pauses without an effect writing state back, and a
  // clock with no recording to run on is not playing, however much it wants to (#73 review).
  const ended = durationS !== null && tSec >= durationS
  const playing = wantPlaying && durationS !== null && !ended

  useEffect(() => {
    if (!playing || durationS === null) return
    return schedule(() => {
      setTSec((t) => Math.min(t + 1, durationS))
      setLastMove('tick')
    }, tickMs)
  }, [playing, durationS, schedule, tickMs])

  const play = useCallback(() => {
    if (ended) {
      setTSec(0)
      setLastMove('seek')
    }
    setWantPlaying(true)
  }, [ended])
  const pause = useCallback(() => setWantPlaying(false), [])
  const seek = useCallback(
    (to: number) => {
      // The state a seek finds at the end is paused; leaving the end must not silently resume.
      if (ended) setWantPlaying(false)
      setTSec(Math.max(0, Math.min(Math.floor(to), durationS ?? 0)))
      setLastMove('seek')
    },
    [durationS, ended],
  )

  return { tSec, playing, lastMove, durationS, play, pause, seek }
}
