import { useEffect, useRef, useState } from 'react'
import { Rewound } from './Rewound'
import { useCopy } from './useCopy'
import type {
  AreaOfOperations,
  FriendlyArea,
  ProtectedSite,
  SiteKind,
  SiteTier,
} from '../config/ao'
import { siteKindLine, siteOriginLine } from '../lib/display'
import {
  SITE_LIMITS,
  canAdd,
  canRemove,
  edited,
  sitePlanText,
  siteProblem,
  type SessionArea,
  type SessionSite,
  type SitePatch,
  type SiteSet,
} from '../lib/sites'

/** What the next map click does: place a new site of a kind, or move the centre of one. */
export type Placing = { kind: 'add'; site: SiteKind } | { kind: 'move'; id: string } | null

/** A row of the list: a protected site or a friendly area, each carrying its kind. */
type Row = (SessionSite & { kind: 'protected' }) | (SessionArea & { kind: 'friendly' })

/** `39.84510, −75.30200` — latitude first, as a person reads a position, with a real minus. */
const formatCentre = ([lon, lat]: [number, number]) =>
  `${lat.toFixed(5)}, ${lon.toFixed(5)}`.replace(/-/g, '−')

/**
 * One site's inline editor: name, tier (a protected site only), radius, the centre read-only
 * with Move re-arming the map click, and Remove. Drafts are local so a half-typed radius is
 * shown and explained rather than applied — and committed only on blur or Enter, since `150`
 * on the way to `1500` would re-score the picture and write a crossing at a ring nobody meant
 * (#87 review); each field commits itself alone. Keyed by site id by the caller.
 */
function SiteEditor({
  site,
  ao,
  removable,
  onUpdate,
  onMove,
  onRemove,
}: {
  site: Row
  ao: AreaOfOperations
  removable: boolean
  onUpdate: (patch: SitePatch) => void
  onMove: () => void
  onRemove: () => void
}) {
  const [name, setName] = useState(site.name)
  const [radius, setRadius] = useState(String(site.radiusM))
  const problem = siteProblem({ name, radiusM: Number(radius), center: site.center }, ao)
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
      {site.kind === 'protected' && (
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
      )}
      <div className="sites__field">
        <label htmlFor={`${site.id}-radius`}>Radius</label>
        <input
          id={`${site.id}-radius`}
          type="number"
          value={radius}
          min={SITE_LIMITS.radiusMinM}
          max={SITE_LIMITS.radiusMaxM}
          step={50}
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
 * The Sites surface's rail (08a, 08b, ruled on #86): the session's protected sites and friendly
 * launch areas as a list of three-line rows in the Queue row's style — the name; the kind and
 * tier; the ring and where it came from — with the selected row's editor expanded beneath it. A
 * site is placed by a map click: *+ Protected site* or *+ Friendly launch area* arms the map and
 * the hint says so; the click makes a whole site at the defaults, selected for editing. Every
 * edit is a workflow action and refuses behind the record's frontier with the drawer's own
 * reason (#77); the status line says whether the set is still config's, Reset returns it, and
 * the site plan copies out and loads back in with the handoff's mechanics — copy only, nothing
 * transmitted. Session state only — a reload returns to config.
 */
export function SitesPanel({
  set,
  config,
  configAreas = [],
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
  onLoad,
}: {
  set: SiteSet
  /** The configured sites and areas — what "edited" is measured against. */
  config: readonly ProtectedSite[]
  configAreas?: readonly FriendlyArea[]
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
  /** Applies a pasted plan as one edit; returns the reason it was refused, or null. */
  onLoad: (text: string) => string | null
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

  // The plan: copied with the handoff's mechanics — the textarea below is the fallback's
  // selection, so a copy fills it with the current plan first — and loaded from whatever was
  // pasted into it, with the module's reason printed under it when refused.
  const planRef = useRef<HTMLTextAreaElement>(null)
  const { copy, copied } = useCopy(planRef)
  const [planDraft, setPlanDraft] = useState('')
  const [loadProblem, setLoadProblem] = useState<string | null>(null)
  const plan = sitePlanText(set, ao)
  const copyPlan = () => {
    setPlanDraft(plan)
    if (planRef.current) planRef.current.value = plan
    void copy(plan)
  }

  const adding = placing?.kind === 'add' ? placing.site : null
  const isEdited = edited(set, config, configAreas)
  const rows: Row[] = [
    ...set.sites.map((site): Row => ({ ...site, kind: 'protected' })),
    ...set.areas.map((area): Row => ({ ...area, kind: 'friendly' })),
  ]
  // The ids of the reason above, for every control the rewound state disables (#79 review).
  const describedBy = rewound ? 'sites-rewound-state sites-rewound-times' : undefined
  const addButton = (kind: SiteKind, label: string) => (
    <button
      type="button"
      className="sites__button"
      disabled={rewound || (adding !== kind && !canAdd(set))}
      aria-pressed={adding === kind}
      onClick={() => onPlacing(adding === kind ? null : { kind: 'add', site: kind })}
    >
      {adding === kind ? 'Cancel' : label}
    </button>
  )
  return (
    <>
      <div
        className="drawer__actions"
        role="group"
        aria-label="Add a site"
        aria-describedby={describedBy}
      >
        {addButton('protected', '+ Protected site')}
        {addButton('friendly', '+ Friendly launch area')}
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
        {rows.map((site) => {
          const selected = site.id === selectedId
          const classes = ['sites__row']
          if (selected) classes.push('sites__row--selected')
          if (site.kind === 'friendly') classes.push('sites__row--friendly')
          return (
            <li key={site.id} className={classes.join(' ')} data-id={site.id}>
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
                    removable={canRemove(set, site.id)}
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
        {rows.length} {rows.length === 1 ? 'site' : 'sites'} ·{' '}
        {isEdited ? 'edited from config' : 'config'}
      </p>
      <div
        className="drawer__actions"
        role="group"
        aria-label="Site set"
        aria-describedby={describedBy}
      >
        <button type="button" className="sites__button" onClick={copyPlan}>
          {copied(plan) ? 'Copied' : 'Copy site plan'}
        </button>
        <button
          type="button"
          className="sites__button"
          disabled={rewound || !isEdited}
          onClick={onReset}
        >
          Reset to config
        </button>
      </div>
      <div className="sites__plan">
        <label htmlFor="sites-plan">Load site plan</label>
        <textarea
          id="sites-plan"
          ref={planRef}
          className="sites__plantext"
          value={planDraft}
          disabled={rewound}
          aria-describedby={describedBy}
          onChange={(event) => {
            setPlanDraft(event.target.value)
            setLoadProblem(null)
          }}
        />
        <div className="drawer__actions" role="group" aria-label="Site plan">
          <button
            type="button"
            className="sites__button"
            disabled={rewound || planDraft.trim() === ''}
            onClick={() => setLoadProblem(onLoad(planDraft))}
          >
            Load
          </button>
        </div>
        <p className="sites__problem" role="status">
          {loadProblem}
        </p>
      </div>
    </>
  )
}
