import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SitesPanel, type Placing } from './SitesPanel'
import { AO } from '../config/ao'
import { simClock } from '../lib/display'
import { addSite, fromConfig, sitePlanText, type SiteSet } from '../lib/sites'

const clock = (tSec: number) => simClock('02:30', tSec)
const CONFIG = AO.protectedSites
const [west, south, east, north] = AO.bbox
const INSIDE: [number, number] = [(west + east) / 2 + 0.1, (south + north) / 2 + 0.1]
/** Config plus one site the operator added at 02:40:00. */
const grown = () => addSite(fromConfig(CONFIG), INSIDE, 600, AO)

function renderPanel(
  set: SiteSet,
  over: Partial<Parameters<typeof SitesPanel>[0]> = {},
): Parameters<typeof SitesPanel>[0] {
  const props: Parameters<typeof SitesPanel>[0] = {
    set,
    config: CONFIG,
    ao: AO,
    selectedId: null,
    placing: null,
    notice: null,
    rewound: false,
    clock,
    tSec: 600,
    frontier: 0,
    onSelect: vi.fn(),
    onPlacing: vi.fn(),
    onUpdate: vi.fn(),
    onRemove: vi.fn(),
    onReset: vi.fn(),
    onLoad: vi.fn(() => null),
    ...over,
  }
  render(<SitesPanel {...props} />)
  return props
}

const rows = () => within(screen.getByRole('list', { name: 'Site set' })).getAllByRole('listitem')

describe('SitesPanel (08a)', () => {
  it('lists each site as three lines — name, kind and tier, ring and origin', () => {
    renderPanel(grown())
    const [config, added] = rows()
    expect(config).toHaveTextContent('PHL Airfield')
    expect(config).toHaveTextContent('Protected · tier 1')
    expect(config).toHaveTextContent('5.0 km ring · config')
    expect(added).toHaveTextContent('Site 2')
    expect(added).toHaveTextContent('1.0 km ring · 02:40:00')
    expect(screen.getByText('2 sites · edited from config')).toBeInTheDocument()
  })

  it('reads config on the untouched set, with Reset disabled', () => {
    renderPanel(fromConfig(CONFIG))
    expect(screen.getByText('1 site · config')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset to config' })).toBeDisabled()
  })

  it('selects a row to open its editor, and the row reads expanded', () => {
    const props = renderPanel(grown())
    expect(screen.queryByRole('group', { name: /^Edit / })).not.toBeInTheDocument()
    fireEvent.click(within(rows()[1]).getByRole('button', { name: /Site 2/ }))
    expect(props.onSelect).toHaveBeenCalledWith('site-2')
  })

  it('applies a valid field edit and explains a refused one without applying it', () => {
    const props = renderPanel(grown(), { selectedId: 'site-2' })
    const editor = screen.getByRole('group', { name: 'Edit Site 2' })
    expect(within(rows()[1]).getByRole('button', { name: /Site 2/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Stadium' } })
    expect(props.onUpdate).toHaveBeenLastCalledWith('site-2', { name: 'Stadium' })
    // A radius under the floor is shown and explained, and the set is not asked to hold it.
    vi.mocked(props.onUpdate).mockClear()
    fireEvent.change(within(editor).getByLabelText('Radius'), { target: { value: '50' } })
    expect(props.onUpdate).not.toHaveBeenCalled()
    expect(within(editor).getByRole('status')).toHaveTextContent('Radius is 100–20,000 m')
    // A legal intermediate value is not committed either: 150 on the way to 1500 would re-score
    // the picture and write a crossing at a ring nobody meant (#87 review). Blur or Enter commits.
    fireEvent.change(within(editor).getByLabelText('Radius'), { target: { value: '150' } })
    expect(props.onUpdate).not.toHaveBeenCalled()
    fireEvent.change(within(editor).getByLabelText('Radius'), { target: { value: '1500' } })
    expect(props.onUpdate).not.toHaveBeenCalled()
    expect(within(editor).getByRole('status')).toHaveTextContent('')
    fireEvent.blur(within(editor).getByLabelText('Radius'))
    expect(props.onUpdate).toHaveBeenLastCalledWith('site-2', { radiusM: 1500 })
    fireEvent.change(within(editor).getByLabelText('Radius'), { target: { value: '2000' } })
    fireEvent.keyDown(within(editor).getByLabelText('Radius'), { key: 'Enter' })
    expect(props.onUpdate).toHaveBeenLastCalledWith('site-2', { radiusM: 2000 })
    // The tier applies directly.
    fireEvent.click(within(editor).getByRole('radio', { name: '2' }))
    expect(props.onUpdate).toHaveBeenLastCalledWith('site-2', { tier: 2 })
    // The centre is read-only, printed latitude first with a real minus; Move re-arms the map.
    expect(within(editor).getByText(/^\d+\.\d{5}, −\d+\.\d{5}$/)).toBeInTheDocument()
    fireEvent.click(within(editor).getByRole('button', { name: 'Move on map' }))
    expect(props.onPlacing).toHaveBeenCalledWith({ kind: 'move', id: 'site-2' })
  })

  it('removes a site, but keeps the last protected site with the reason on the button', () => {
    const props = renderPanel(grown(), { selectedId: 'site-2' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(props.onRemove).toHaveBeenCalledWith('site-2')
    // Focus lands on the list, not on document.body, as the row unmounts under the finger.
    expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Site set' }))
  })

  it('will not remove the last protected site', () => {
    renderPanel(fromConfig(CONFIG), { selectedId: CONFIG[0].id })
    const remove = screen.getByRole('button', { name: 'Remove' })
    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('title', 'The last protected site stays')
  })

  it('arms the map from the add button, says so in the live line, and cancels from the button or Escape', () => {
    const props = renderPanel(fromConfig(CONFIG))
    expect(document.querySelector('.sites__hint')).toHaveTextContent('')
    fireEvent.click(screen.getByRole('button', { name: '+ Protected site' }))
    expect(props.onPlacing).toHaveBeenCalledWith({ kind: 'add', site: 'protected' })
    // Armed: the button reads Cancel and the hint says what the click does.
    const placing: Placing = { kind: 'add', site: 'protected' }
    vi.mocked(props.onPlacing).mockClear()
    render(<SitesPanel {...props} placing={placing} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Click the map to place the centre')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onPlacing).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onPlacing).toHaveBeenLastCalledWith(null)
  })

  it('prints a refused placement’s reason in the live line, over the hint', () => {
    renderPanel(fromConfig(CONFIG), {
      placing: { kind: 'add', site: 'protected' },
      notice: 'Centre is outside the AO',
    })
    expect(screen.getByText('Centre is outside the AO')).toBeInTheDocument()
    expect(screen.queryByText('Click the map to place the centre')).not.toBeInTheDocument()
  })

  it('refuses every edit behind the record’s frontier, with the drawer’s reason and both times', () => {
    renderPanel(grown(), { selectedId: 'site-2', rewound: true, tSec: 30, frontier: 600 })
    expect(
      screen.getByText('Rewound — the workflow acts at the record’s frontier'),
    ).toBeInTheDocument()
    expect(screen.getByText('Clock 02:30:30 · record 02:40:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Protected site' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset to config' })).toBeDisabled()
    for (const name of ['Move on map', 'Remove']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(screen.getByLabelText('Name')).toBeDisabled()
    expect(screen.getByLabelText('Radius')).toBeDisabled()
    // `disabled` takes the controls out of the tab order, so each group points at the reason.
    for (const name of ['Add a site', 'Site set']) {
      expect(screen.getByRole('group', { name })).toHaveAttribute(
        'aria-describedby',
        'sites-rewound-state sites-rewound-times',
      )
    }
  })

  it('resets to config from the footer', () => {
    const props = renderPanel(grown())
    fireEvent.click(screen.getByRole('button', { name: 'Reset to config' }))
    expect(props.onReset).toHaveBeenCalled()
  })
})

describe('SitesPanel — friendly launch areas and the site plan (08b)', () => {
  it('arms the map for a friendly area from its own button, and lists it without a tier', () => {
    const props = renderPanel(addSite(fromConfig(CONFIG), INSIDE, 720, AO, 'friendly'), {
      selectedId: 'area-2',
    })
    fireEvent.click(screen.getByRole('button', { name: '+ Friendly launch area' }))
    expect(props.onPlacing).toHaveBeenCalledWith({ kind: 'add', site: 'friendly' })
    const row = rows()[1]
    expect(row).toHaveTextContent('Launch area 2')
    expect(row).toHaveTextContent('Friendly launch area')
    expect(row).toHaveTextContent('1.0 km ring · 02:42:00')
    expect(row).toHaveClass('sites__row--friendly')
    const editor = screen.getByRole('group', { name: 'Edit Launch area 2' })
    expect(within(editor).queryByRole('radio')).not.toBeInTheDocument()
    expect(within(editor).getByRole('button', { name: 'Remove' })).toBeEnabled()
    expect(screen.getByText('2 sites · edited from config')).toBeInTheDocument()
  })

  it('copies the plan with the handoff’s mechanics, filling the plan field first', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const set = grown()
    renderPanel(set)
    fireEvent.click(screen.getByRole('button', { name: 'Copy site plan' }))
    expect(writeText).toHaveBeenCalledWith(sitePlanText(set, AO))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect((screen.getByLabelText('Load site plan') as HTMLTextAreaElement).value).toBe(
      sitePlanText(set, AO),
    )
    vi.unstubAllGlobals()
  })

  it('loads a pasted plan, prints the reason when refused, and refuses nothing behind the frontier', () => {
    const onLoad = vi.fn((text: string) => (text.includes('bad') ? 'Plan is not JSON' : null))
    renderPanel(fromConfig(CONFIG), { onLoad })
    const field = screen.getByLabelText('Load site plan')
    const load = screen.getByRole('button', { name: 'Load' })
    expect(load).toBeDisabled()
    fireEvent.change(field, { target: { value: 'bad' } })
    fireEvent.click(load)
    expect(onLoad).toHaveBeenCalledWith('bad')
    expect(screen.getByText('Plan is not JSON')).toBeInTheDocument()
    fireEvent.change(field, { target: { value: '{"ao":"phl"}' } })
    expect(screen.queryByText('Plan is not JSON')).not.toBeInTheDocument()
    fireEvent.click(load)
    expect(onLoad).toHaveBeenLastCalledWith('{"ao":"phl"}')
  })

  it('disables the plan field and Load while rewound', () => {
    renderPanel(grown(), { rewound: true, tSec: 30, frontier: 600 })
    expect(screen.getByLabelText('Load site plan')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Load' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '+ Friendly launch area' })).toBeDisabled()
  })
})
