import type { Playback as PlaybackState } from '../data/usePlayback'
import { formatElapsed } from '../lib/display'

/**
 * The strip's playback field (§7, PR 06a): one Play/Pause toggle, a native range input for
 * seek — keyboard-accessible as built — and the position over the recording's length. Disabled
 * until the recording is in; the strip's other fields hold back their counts the same way.
 */
export function Playback({ playback }: { playback: PlaybackState }) {
  const { tSec, playing, durationS } = playback
  const ready = durationS !== null
  return (
    <div className="strip__field strip__field--playback">
      <dt>Playback</dt>
      <dd className="playback">
        <button
          type="button"
          className="playback__toggle"
          disabled={!ready}
          onClick={playing ? playback.pause : playback.play}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          className="playback__seek"
          aria-label="Seek"
          aria-valuetext={formatElapsed(tSec)}
          min={0}
          max={durationS ?? 0}
          step={1}
          value={tSec}
          disabled={!ready}
          onChange={(event) => playback.seek(Number(event.target.value))}
        />
        <span className="playback__time">
          {ready ? `${formatElapsed(tSec)} / ${formatElapsed(durationS)}` : '—'}
        </span>
      </dd>
    </div>
  )
}
