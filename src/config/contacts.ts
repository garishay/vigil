/**
 * The mock escalation recipients (scope §7.1) — configuration, not code, like the AO. Vigil
 * generates the handoff and the operator delivers it; actually transmitting anything is Phase 2,
 * and per §2 the act step ends at notification.
 */

export interface Contact {
  id: string
  name: string
}

export const CONTACTS = [
  { id: 'airport-ops', name: 'Airport Operations' },
  { id: 'phl-tower', name: 'PHL Tower' },
  { id: 'airport-police-cuas', name: 'Airport Police C-UAS unit' },
] as const satisfies readonly Contact[]

export type ContactId = (typeof CONTACTS)[number]['id']
