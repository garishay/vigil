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
 * A study run's window on the recording (S4b, #137, ruled A2–A4): the clock opens held at
 * `fromS` — Begin's tick — and does not play until `play`, which is Begin; it then ticks to
 * `toS`, or the recording's end if that comes first, and stops there for good: Play at the end
 * restarts nothing, and a seek stays inside the window.
 */
export interface PlaybackWindow {
  fromS: number
  toS: number
}

/**
 * The replay clock (PR 06a). Plays from load, one second per tick, and pauses at the end of the
 * recording rather than looping — a loop would rewrite what the record means. Seek clamps to the
 * recording and keeps whatever play state it finds; Play at the end starts over. Given a window,
 * the clock is a run's instead: held at its start, ended at its end.
 */
export function usePlayback(
  durationS: number | null,
  schedule: Schedule = intervalSchedule,
  tickMs: number = REPLAY.tickMs,
  window: PlaybackWindow | null = null,
): Playback {
  const fromS = window?.fromS ?? 0
  const bounded = window !== null
  const [tSec, setTSec] = useState(fromS)
  const [wantPlaying, setWantPlaying] = useState(!bounded)
  const [lastMove, setLastMove] = useState<PlaybackMove>('seek')
  // Derived, not stored: reaching the end pauses without an effect writing state back, and a
  // clock with no recording to run on is not playing, however much it wants to (#73 review).
  const endS = durationS === null ? null : window ? Math.min(window.toS, durationS) : durationS
  const ended = endS !== null && tSec >= endS
  const playing = wantPlaying && endS !== null && !ended

  useEffect(() => {
    if (!playing || endS === null) return
    return schedule(() => {
      setTSec((t) => Math.min(t + 1, endS))
      setLastMove('tick')
    }, tickMs)
  }, [playing, endS, schedule, tickMs])

  const play = useCallback(() => {
    if (ended) {
      // A run that has ended is over: the ended clock cannot be restarted (ruled A3).
      if (bounded) return
      setTSec(0)
      setLastMove('seek')
    }
    setWantPlaying(true)
  }, [ended, bounded])
  const pause = useCallback(() => setWantPlaying(false), [])
  const seek = useCallback(
    (to: number) => {
      // The state a seek finds at the end is paused; leaving the end must not silently resume.
      if (ended) setWantPlaying(false)
      setTSec(Math.max(fromS, Math.min(Math.floor(to), endS ?? fromS)))
      setLastMove('seek')
    },
    [endS, ended, fromS],
  )

  return { tSec, playing, lastMove, durationS, play, pause, seek }
}
