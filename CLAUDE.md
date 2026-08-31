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

| Command             | Purpose             |
| ------------------- | ------------------- |
| `npm run dev`       | Dev server          |
| `npm run build`     | Production build    |
| `npm run lint`      | ESLint              |
| `npm run typecheck` | `tsc --noEmit`      |
| `npm run test`      | Vitest (single run) |

CI runs `lint`, `typecheck`, and `test` on every PR. Red CI is a stop, not a suggestion.

## Conventions

- **Every PR starts as a GitHub Issue** carrying a mini-PRD (user story + acceptance criteria).
- **Branch naming:** `feat/pr-02-scenario-data` — kind, PR number, short slug.
- **Squash-merge only**, delete the branch after merge.
- **PR size target: under ~400 implementation lines.** Tests, comments, and recorded fixtures sit
  outside the budget; report the split as raw / implementation / tests in the PR description. When
  a PR swells, split it rather than grow it.
- Conventional-ish commit subjects, imperative mood.
- Reply to every review comment with a fix or a reasoned "won't fix."
- **The review loop on a PR ends when the owner declares closure.** After closure, new findings
  become follow-up Issues unless they are factual errors — a broken requirement or wrong
  behavior — which still block the merge.
- **A change that cannot test itself carries only the fix, no cleanup.** The review action skips any
  run whose workflow file differs from `main`, so a workflow PR is first exercised by the PR after
  it — anything riding along lands unproven (the lesson of #18, paid for in #20).
- At least one test per behavior change. No dead code, no `console` noise.
- **Update the README architecture diagram** when a PR adds or removes a module (a stage on the
  data path) or an edge — including un-dashing a box the diagram already reserves for that PR.

## The plan gate

Every PR is planned and approved before it is built — for a cleanup PR bundling owner-filed
follow-ups at ≤50 implementation lines, that approval lives in the bundled Issues (see
Decision rights). Two standing
rules govern it.

- **Read the notes on every open Issue, not just the target one.** Rulings and design constraints
  get parked downstream, on the Issue they will land in rather than the one being built. A plan
  written from the target Issue alone will miss them. Note whether each one is a **ruling** or an
  **assumption** — and say which when parking a note of your own.
- **Mid-build, judge a deviation by what it touches.** One that changes neither the approved design
  nor the ~400-line budget: flag it and keep going. One that changes either: **stop and
  re-gate** — append the conflict, the proposed change, and the revised estimate to the
  adjudication queue — the one intake — and wait. A discovery that
  reshapes the design is a plan-gate event, not a disclosure to be saved for the PR description.

## Decision rights and adjudication

This replaces per-round check-ins — the prior practice of pausing for the owner after every
review round. Plan gates, closure declarations, and merges remain the owner's alone.

**Proceed without asking (log on the PR thread, don't ask):** review-round triage — closure
changes what a finding becomes (follow-up Issue vs blocking factual error), never whether triage
proceeds; thread reconciliation with dispositions; filing follow-up Issues; branch updates and
changelog conflicts in the known ordering; retriggering CI; fixes to factual errors within the
approved design and budget; cleanup PRs that only bundle owner-filed follow-ups, ≤50
implementation lines — pre-approved by those Issues, which are jointly the PR's originating
Issue and its scope, so the plan gate is satisfied by reference. Growth past the cap is a
budget change: stop and re-gate.

**Stop and queue** (append to the pinned **Adjudication queue** Issue — **#36** — with
options and a recommendation; batch — the queued item itself stops and waits; only unrelated
work continues): any discretionary change to what a user sees beyond the approved mockup (the
mockup in the plan comment on the PR's Issue; a PR with no approved mockup has approved no
user-visible change), including on-screen wording; scope adds or cuts; data provenance,
privacy, licensing, new dependencies, any new network call; design or budget changes mid-build
(the existing re-gate rule); conflicts between doc rules; changes to the review tooling — the
AI model or the workflows; anything where two rulings could plausibly apply. The owner answers
the queue in batches via notifications. An on-screen factual error is never a queue item:
within the approved design and budget, it is fixed regardless of surface.

### Lanes

Work runs in parallel lanes, one session and one git worktree per lane — sessions never share a
working tree.

- **Max one open PR per lane.**
- **Lanes own disjoint files — the two shared docs excepted —
  `README.md`'s diagram and `docs/mvp-scope.md`'s changelog.** Feature surfaces belong to
  Lane A; scripts and docs belong to Lane B — but each lane owns the doc edits its own PRs
  entail: the diagram update the conventions require, and the changelog entry and §11 plan
  row that record the PR; Lane B owns doc-only PRs. Files
  outside both surfaces follow the routed Issue: the lane holding the Issue owns every file
  its fix touches, for the duration of that PR — no standing file census. A file no routed
  Issue names is claimed on the adjudication queue before either lane touches it. A collision in the
  two shared docs resolves at merge time — whoever merges second reconciles: the changelog in
  its known ordering, the diagram by redrawing over the merged picture.
- **`docs/mvp-scope.md` changelog edits happen only while the PR they record is open — the
  entry belongs to that PR, created at open or at the re-gate that earns it, and amendable
  while its review runs — or at merge-time conflict resolution in the known ordering**
  (current-AO statement first, newest entries lead, then the record; whoever prepends an
  entry maintains the lead sentence's wording as part of the edit).
- **The adjudication queue serves both lanes.**

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
