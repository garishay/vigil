import { useState } from 'react'
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
 * What a screen reader hears is one hidden polite line, mounted from the first frame and
 * written once per raise — the newest card's word, ident, and time as they stood when it was
 * raised. The cards themselves are not live: an intermittent broadcast flips a card's ident
 * between its callsign and `TRK-nn` on ticks where nothing was raised, and a region over the
 * cards would read the card out again each time (#111 review). A raise is a text change in a
 * region that already exists, which is the case every reader announces; a region inserted with
 * its text is not (#79).
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
  // The announcement: keyed on the newest card's identity and stamp, so a raise or a re-stamp
  // writes it once and a later ident flip leaves it alone. Guarded set-during-render, the
  // repo's derived-state idiom, so one commit writes it once.
  const [announced, setAnnounced] = useState({ key: '', text: '' })
  const top = alerts[0]
  const key = top ? `${top.trackId}:${top.kind}:${top.seq}:${top.tSec}` : ''
  if (top && key !== announced.key) {
    setAnnounced({ key, text: `${top.word} ${identOf(top.trackId)} ${clock(top.tSec)}` })
  }
  const behind = alerts.filter((alert) => tSec < frontierOf(alert.trackId))
  const rewound = behind.length > 0
  // The shared line names the earliest record any disabled card is behind — the first moment
  // one of them becomes actionable — and each disabled button is described by its own.
  const frontier = rewound ? Math.min(...behind.map((alert) => frontierOf(alert.trackId))) : tSec
  return (
    <section className="alerts" aria-label="Alerts">
      <p className="visually-hidden" aria-live="polite">
        {announced.text}
      </p>
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
          const cardFrontier = frontierOf(alert.trackId)
          const disabled = tSec < cardFrontier
          const timesId = `alert-times-${alert.trackId}-${alert.kind}`
          return (
            <li key={`${alert.trackId}:${alert.kind}`} className="alert" data-kind={alert.kind}>
              <button type="button" className="alert__open" onClick={() => onOpen(alert.trackId)}>
                <span className="alert__word">{alert.word}</span>
                <span className="alert__ident">{identOf(alert.trackId)}</span>
                <span className="alert__time">{clock(alert.tSec)}</span>
              </button>
              {disabled && (
                <span id={timesId} className="visually-hidden">
                  Clock {clock(tSec)} · record {clock(cardFrontier)}
                </span>
              )}
              <button
                type="button"
                className="alert__ack"
                disabled={disabled}
                aria-describedby={disabled ? `alerts-rewound-state ${timesId}` : undefined}
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
