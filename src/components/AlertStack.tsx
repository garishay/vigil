import { Rewound } from './Rewound'
import type { Alert } from '../lib/alerts'

/**
 * The alert stack (#101, 101a): the cards the record has earned and the operator has not yet
 * answered, over the map on every surface, newest on top. A card names the track, the observed
 * or derived word — the band's, the pattern's, or Re-surfaced, never a generator label — and
 * the sim time of the entry that raised it. Its body selects the track, as a map dot does;
 * Acknowledge beside it is a workflow action under #77, refused behind the track's own frontier
 * the way the drawer's four buttons are, with the same static state line saying why.
 *
 * The region is polite: a raise is read out after whatever the reader is on, never over it.
 */
export function AlertStack({
  alerts,
  identOf,
  clock,
  tSec,
  frontierOf,
  onOpen,
  onAcknowledge,
}: {
  /** Newest first — the order the module keeps. */
  alerts: readonly Alert[]
  /** The track's on-screen ident (`TRK-05`, `UAS-A341`), by id. */
  identOf: (trackId: string) => string
  /** Sim time as the record prints it. */
  clock: (tSec: number) => string
  tSec: number
  /** The sim time of the track's last record entry — behind it, Acknowledge is refused. */
  frontierOf: (trackId: string) => number
  onOpen: (trackId: string) => void
  onAcknowledge: (trackId: string) => void
}) {
  const behind = alerts.filter((alert) => tSec < frontierOf(alert.trackId))
  const rewound = behind.length > 0
  const frontier = rewound ? Math.max(...behind.map((alert) => frontierOf(alert.trackId))) : tSec
  return (
    <section className="alerts" aria-label="Alerts" aria-live="polite">
      {/* The state line lives while the stack does: mounted with the first card, its text
          toggling from then on, so a scrub behind a card's frontier announces once (#79). */}
      {alerts.length > 0 && (
        <Rewound
          base="alerts__rewound"
          idPrefix="alerts-rewound"
          rewound={rewound}
          clock={clock}
          tSec={tSec}
          frontier={frontier}
        />
      )}
      <ol className="alerts__list">
        {alerts.map((alert) => {
          const disabled = tSec < frontierOf(alert.trackId)
          return (
            <li key={`${alert.trackId}:${alert.kind}`} className="alert" data-kind={alert.kind}>
              <button type="button" className="alert__open" onClick={() => onOpen(alert.trackId)}>
                <span className="alert__word">{alert.word}</span>
                <span className="alert__ident">{identOf(alert.trackId)}</span>
                <span className="alert__time">{clock(alert.tSec)}</span>
              </button>
              <button
                type="button"
                className="alert__ack"
                disabled={disabled}
                aria-describedby={
                  disabled ? 'alerts-rewound-state alerts-rewound-times' : undefined
                }
                onClick={() => onAcknowledge(alert.trackId)}
              >
                Acknowledge
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
