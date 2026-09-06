/**
 * The alert triggers (#101, 101a) — doctrine as configuration. Which record entries interrupt
 * the operator: an upward crossing into warning, a pattern onset, and a re-surface are on; a
 * crossing into caution is here and off. Whatever this says, a capped cooperative track never
 * alerts — that rule is the scorer's, not this table's.
 */

export type AlertKind = 'warning' | 'caution' | 'pattern' | 'resurfaced'

export interface AlertConfig {
  triggers: Record<AlertKind, boolean>
}

export const ALERTS: AlertConfig = {
  triggers: { warning: true, caution: false, pattern: true, resurfaced: true },
}
