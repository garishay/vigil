# CLAUDE.md

Vigil is an explainable airspace-triage workstation for PHL-area airspace: real ADS-B traffic and
synthetic small-UAS injects fused into one picture, scored by transparent factors, presented as a
ranked queue. Full scope: `docs/mvp-scope.md`.

## Guardrails (non-negotiable)

- **Public or synthetic data only.** ADS-B is the only real data. The threat layer is 100%
  generated. Nothing from any work system enters this repo — no proprietary requirements,
  terminology, code, or documents.
- **Real aircraft are never the threat.** ADS-B-sourced tracks are cooperative and hold a low
  baseline priority. Only synthetic injects can score as threats. Never write code, copy, tests,
  or fixtures that portray a real aircraft as a threat.
- **No VIP tracking.** Vigil never singles out a specific individual's aircraft.
- **Public first principles only.** CPA/TCPA geometry, published counter-UAS concepts, FAA Remote
  ID. If a design question can only be answered from work knowledge, pick a different design.
- **Not an operational system.** Educational demonstration only. No claims about real-world threat
  assessment.
- **No simulated engagement.** No jamming, takeover, or kinetic defeat — the act step ends at
  assessment and notification.
- **Military identification systems (IFF) are out of scope.** Identity is plain English:
  Cooperative / Non-cooperative / Unknown. No MIL-STD-2525 symbology.

## Stack

Vite · React · TypeScript (strict) · MapLibre GL · Vitest · ESLint · Prettier

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest (single run) |

CI runs `lint`, `typecheck`, and `test` on every PR. Red CI is a stop, not a suggestion.

## Conventions

- **Every PR starts as a GitHub Issue** carrying a mini-PRD (user story + acceptance criteria).
- **Branch naming:** `feat/pr-02-scenario-data` — kind, PR number, short slug.
- **Squash-merge only**, delete the branch after merge.
- **PR size target: under ~400 changed lines.** When a PR swells, split it rather than grow it.
- Conventional-ish commit subjects, imperative mood.
- Reply to every review comment with a fix or a reasoned "won't fix."
- At least one test per behavior change. No dead code, no `console` noise.

## Architecture notes

- The **ADS-B capture script**, the **inject generator**, and the **scorer** are pure modules —
  no React, no DOM, no I/O in the scoring path. They are unit-tested directly.
- The **UI consumes them**; it does not reimplement their logic.
- **Determinism is a requirement, not a nicety.** Same seed → identical picture, proven by test.
- **Doctrine is configuration, not code.** Factor weights are data. The AO (center, bounding box,
  protected sites) is config — relocating Vigil is a config change, not a rewrite.
- Scores retain their **per-factor breakdown** for display. Never collapse a score to a bare
  number.

## What you should never do

- **Never commit or push directly to `main`.** It is branch-protected; work on a branch and open a
  PR.
- **Never add a dependency without asking first.** Say what it's for and what it costs.
- **Never generate anything portraying real aircraft as threats** — not in code, fixtures, tests,
  UI copy, or demo data.
- Never commit real data from a non-public source, secrets, or API keys.
- Never model engagement, jamming, or defeat.
- Never widen a PR's scope past its issue; open a follow-up issue instead.
