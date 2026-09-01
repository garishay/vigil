/**
 * The resolution vocabulary (scope §7.1) — configuration beside the contacts, ruled on #3:
 * doctrine is configuration, and a disposition is the outcome label any learned scoring will
 * need later (§8.3b), so the set is closed and edited here rather than typed free-hand.
 */

export interface Disposition {
  id: string
  label: string
}

export const DISPOSITIONS = [
  { id: 'benign', label: 'Benign' },
  { id: 'departed-ao', label: 'Departed AO' },
  { id: 'handled-by-target', label: 'Handled by escalation target' },
  { id: 'undetermined', label: 'Undetermined' },
] as const satisfies readonly Disposition[]

export type DispositionId = (typeof DISPOSITIONS)[number]['id']
