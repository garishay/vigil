import { useEffect, useRef, useState } from 'react'
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
 *
 * The card's two controls (S8b, #202): **Open** is the card's face — it answers the card and
 * opens its track, so the detail, the row and the marker are where the card pointed — and the
 * quiet **×** clears the card and moves nothing, for "seen, not now". Both are workflow actions
 * under #77, refused behind the track's own frontier the way the drawer's buttons are, with the
 * same static state line saying why. What each writes is the shell's; the word Acknowledge is
 * on no card.
 */
export function AlertStack({
  alerts,
  identOf,
  clock,
  tSec,
  frontierOf,
  onOpen,
  onClear,
}: {
  /** Newest first — the order the module keeps. */
  alerts: readonly Alert[]
  /** The track's on-screen ident (`TRK-05`, `UAS-A341`), by id. */
  identOf: (trackId: string) => string
  /** Sim time as the record prints it. */
  clock: (tSec: number) => string
  tSec: number
  /** The sim time of the track's last record entry — behind it, both controls are refused. */
  frontierOf: (trackId: string) => number
  /** Open: answer the card and open its track. `keyboard` is the click's modality (#54). */
  onOpen: (trackId: string, keyboard: boolean) => void
  /** The quiet clear: the card goes and nothing moves. */
  onClear: (trackId: string) => void
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
  // A cleared card leaves under the finger: a keyboard operator lands on the card that took its
  // place — the one below, or the last — never on body, the drawer's own rule for its buttons.
  // A pointer clear leaves focus where the pointer put it (#54's gate), and a clear that empties
  // the stack is the shell's to land, on the list.
  const listRef = useRef<HTMLOListElement>(null)
  const landRef = useRef<number | null>(null)
  useEffect(() => {
    const index = landRef.current
    if (index === null) return
    landRef.current = null
    if (document.activeElement !== document.body) return
    const opens = listRef.current?.querySelectorAll<HTMLButtonElement>('.alert__open') ?? []
    opens[Math.min(index, opens.length - 1)]?.focus?.()
  }, [alerts])
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
      <ol className="alerts__list" ref={listRef}>
        {alerts.map((alert, index) => {
          const cardFrontier = frontierOf(alert.trackId)
          const disabled = tSec < cardFrontier
          const timesId = `alert-times-${alert.trackId}-${alert.kind}`
          const describedBy = disabled ? `alerts-rewound-state ${timesId}` : undefined
          const ident = identOf(alert.trackId)
          return (
            <li key={`${alert.trackId}:${alert.kind}`} className="alert" data-kind={alert.kind}>
              <button
                type="button"
                className="alert__open"
                disabled={disabled}
                aria-describedby={describedBy}
                onClick={(event) => onOpen(alert.trackId, event.detail === 0)}
              >
                <span className="alert__word">{alert.word}</span>{' '}
                <span className="alert__ident">{ident}</span>{' '}
                <span className="alert__time">{clock(alert.tSec)}</span>{' '}
                <span className="alert__verb">Open</span>
              </button>
              {disabled && (
                <span id={timesId} className="visually-hidden">
                  Clock {clock(tSec)} · record {clock(cardFrontier)}
                </span>
              )}
              <button
                type="button"
                className="alert__clear"
                disabled={disabled}
                aria-describedby={describedBy}
                aria-label={`Clear card — ${alert.word} ${ident}`}
                onClick={(event) => {
                  landRef.current = event.detail === 0 ? index : null
                  onClear(alert.trackId)
                }}
              >
                ×
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
