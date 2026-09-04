import { useEffect, useRef, useState } from 'react'
import { Rewound } from './Rewound'
import type { AreaOfOperations, ProtectedSite, SiteTier } from '../config/ao'
import { siteKindLine, siteOriginLine } from '../lib/display'
import {
  SITE_LIMITS,
  canAdd,
  canRemove,
  edited,
  siteProblem,
  type SessionSite,
  type SitePatch,
  type SiteSet,
} from '../lib/sites'

/** What the next map click does: place a new site, or move the centre of an existing one. */
export type Placing = { kind: 'add' } | { kind: 'move'; id: string } | null

/** `39.84510, −75.30200` — latitude first, as a person reads a position, with a real minus. */
const formatCentre = ([lon, lat]: [number, number]) =>
  `${lat.toFixed(5)}, ${lon.toFixed(5)}`.replace(/-/g, '−')

/**
 * One site's inline editor: name, tier, radius, the centre read-only with Move re-arming the map
 * click, and Remove. Drafts are local so a half-typed radius is shown and explained rather than
 * applied: the set only ever holds a site the rules allow, and the reason a field is refused
 * prints under it in the module's own words. Keyed by site id by the caller.
 */
function SiteEditor({
  site,
  ao,
  removable,
  onUpdate,
  onMove,
  onRemove,
}: {
  site: SessionSite
  ao: AreaOfOperations
  removable: boolean
  onUpdate: (patch: SitePatch) => void
  onMove: () => void
  onRemove: () => void
}) {
  const [name, setName] = useState(site.name)
  const [radius, setRadius] = useState(String(site.radiusM))
  const problem = siteProblem({ name, radiusM: Number(radius), center: site.center }, ao)
  // Each field commits only itself: a name keystroke never carries a half-typed radius along.
  const commitName = (value: string) => {
    if (siteProblem({ name: value, radiusM: site.radiusM, center: site.center }, ao) === null)
      onUpdate({ name: value })
  }
  const commitRadius = () => {
    const radiusM = Number(radius)
    if (siteProblem({ name: site.name, radiusM, center: site.center }, ao) === null)
      onUpdate({ radiusM })
  }
  return (
    <div className="sites__editor" role="group" aria-label={`Edit ${site.name}`}>
      <div className="sites__field">
        <label htmlFor={`${site.id}-name`}>Name</label>
        <input
          id={`${site.id}-name`}
          type="text"
          value={name}
          maxLength={SITE_LIMITS.nameMax}
          onChange={(event) => {
            setName(event.target.value)
            commitName(event.target.value)
          }}
        />
      </div>
      <fieldset className="sites__tier">
        <legend>Tier</legend>
        {([1, 2] as SiteTier[]).map((tier) => (
          <label className="drawer__option" key={tier}>
            <input
              type="radio"
              name={`tier-${site.id}`}
              value={tier}
              checked={site.tier === tier}
              onChange={() => onUpdate({ tier })}
            />
            {tier}
          </label>
        ))}
      </fieldset>
      <div className="sites__field">
        <label htmlFor={`${site.id}-radius`}>Radius</label>
        <input
          id={`${site.id}-radius`}
          type="number"
          value={radius}
          min={SITE_LIMITS.radiusMinM}
          max={SITE_LIMITS.radiusMaxM}
          step={50}
          // Shown and explained on every keystroke, committed only when the operator is done:
          // `150` on the way to `1500` would otherwise re-score the picture and write a
          // crossing into the record at a ring nobody meant (#87 review).
          onChange={(event) => setRadius(event.target.value)}
          onBlur={commitRadius}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRadius()
          }}
        />
        <span>m</span>
      </div>
      <p className="sites__field">
        <span>Centre</span>
        <span className="sites__centre">{formatCentre(site.center)}</span>
      </p>
      <p className="sites__problem" role="status">
        {problem}
      </p>
      <div className="drawer__actions">
        <button type="button" className="sites__button" onClick={onMove}>
          Move on map
        </button>
        <button
          type="button"
          className="sites__button"
          disabled={!removable}
          title={removable ? undefined : 'The last protected site stays'}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </div>
  )
}

/**
 * The Sites surface's rail (08a, ruled on #86): the session's protected sites as a list of
 * three-line rows in the Queue row's style — the name; the kind and tier; the ring and where it
 * came from — with the selected row's editor expanded beneath it. A site is placed by a map
 * click: *+ Protected site* arms the map and the hint says so; the click makes a whole site at
 * the defaults, selected for editing. Every edit is a workflow action and refuses behind the
 * record's frontier with the drawer's own reason (#77); the status line says whether the set
 * is still config's, and Reset returns it. Session state only — a reload returns to config.
 */
export function SitesPanel({
  set,
  config,
  ao,
  selectedId,
  placing,
  notice,
  rewound,
  clock,
  tSec,
  frontier,
  onSelect,
  onPlacing,
  onUpdate,
  onRemove,
  onReset,
}: {
  set: SiteSet
  /** The configured set — what "edited" is measured against. */
  config: readonly ProtectedSite[]
  ao: AreaOfOperations
  selectedId: string | null
  placing: Placing
  /** The reason the last placement was refused, if it was; shown in the hint's live region. */
  notice: string | null
  rewound: boolean
  clock: (tSec: number) => string
  tSec: number
  frontier: number
  onSelect: (id: string | null) => void
  onPlacing: (placing: Placing) => void
  onUpdate: (id: string, patch: SitePatch) => void
  onRemove: (id: string) => void
  onReset: () => void
}) {
  const listRef = useRef<HTMLOListElement>(null)
  // Escape cancels a placement, as the button does — the map is armed and the operator may be
  // anywhere on the page.
  useEffect(() => {
    if (!placing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onPlacing(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placing, onPlacing])

  const adding = placing?.kind === 'add'
  const isEdited = edited(set, config)
  // The ids of the reason above, for every control the rewound state disables (#79 review).
  const describedBy = rewound ? 'sites-rewound-state sites-rewound-times' : undefined
  return (
    <>
      <div
        className="drawer__actions"
        role="group"
        aria-label="Add a site"
        aria-describedby={describedBy}
      >
        <button
          type="button"
          className="sites__button"
          disabled={rewound || (!adding && !canAdd(set))}
          aria-pressed={adding}
          onClick={() => onPlacing(adding ? null : { kind: 'add' })}
        >
          {adding ? 'Cancel' : '+ Protected site'}
        </button>
      </div>
      {/* One live line for the placement hint and a refused placement's reason; mounted always
          with only the text toggling, as `rail__empty` is (#51 review). */}
      <p className="sites__hint" role="status">
        {notice ??
          (placing
            ? placing.kind === 'add'
              ? 'Click the map to place the centre'
              : 'Click the map to move the centre'
            : null)}
      </p>
      <Rewound
        base="sites__rewound"
        idPrefix="sites-rewound"
        rewound={rewound}
        clock={clock}
        tSec={tSec}
        frontier={frontier}
      />
      <ol className="sites" aria-label="Site set" ref={listRef} tabIndex={-1}>
        {set.sites.map((site) => {
          const selected = site.id === selectedId
          return (
            <li
              key={site.id}
              className={`sites__row${selected ? ' sites__row--selected' : ''}`}
              data-id={site.id}
            >
              <button
                type="button"
                className="sites__rowbutton"
                aria-current={selected ? 'true' : undefined}
                aria-expanded={selected}
                onClick={() => onSelect(selected ? null : site.id)}
              >
                <span className="sites__name">
                  <span className="sites__chevron" aria-hidden="true">
                    {selected ? '▾' : '▸'}
                  </span>
                  {site.name}
                </span>
                <span className="sites__kind">{siteKindLine(site)}</span>
                <span className="sites__origin">{siteOriginLine(site, clock)}</span>
              </button>
              {selected && (
                // Disabled as a whole while rewound: every field and button goes grey together,
                // described by the reason above (#79 review).
                <fieldset
                  className="sites__fieldset"
                  disabled={rewound}
                  aria-describedby={describedBy}
                >
                  <SiteEditor
                    key={site.id}
                    site={site}
                    ao={ao}
                    removable={canRemove(set)}
                    onUpdate={(patch) => onUpdate(site.id, patch)}
                    onMove={() => onPlacing({ kind: 'move', id: site.id })}
                    onRemove={() => {
                      // The row unmounts under the finger; keep the operator on the list rather
                      // than dropping them on document.body (#47 review).
                      listRef.current?.focus?.()
                      onRemove(site.id)
                    }}
                  />
                </fieldset>
              )}
            </li>
          )
        })}
      </ol>
      <p className="sites__status">
        {set.sites.length} {set.sites.length === 1 ? 'site' : 'sites'} ·{' '}
        {isEdited ? 'edited from config' : 'config'}
      </p>
      <div
        className="drawer__actions"
        role="group"
        aria-label="Site set"
        aria-describedby={describedBy}
      >
        <button
          type="button"
          className="sites__button"
          disabled={rewound || !isEdited}
          onClick={onReset}
        >
          Reset to config
        </button>
      </div>
    </>
  )
}
