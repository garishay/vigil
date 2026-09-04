# CLAUDE.md

Vigil is an explainable airspace-triage workstation for PHL-area airspace: real ADS-B traffic and
synthetic small-UAS injects fused into one picture, scored by transparent factors, presented as a
ranked queue. Full scope: `docs/mvp-scope.md`. The owner's operating model lives in the user-level
CLAUDE.md; this file holds what is Vigil's.

## Guardrails (non-negotiable)

- **Public or synthetic data only.** ADS-B is the only real data; the threat layer is 100% generated.
  Nothing from any work system enters this repo — no proprietary requirements, terminology, code, or
  documents. No real data from a non-public source, no secrets, no API keys.
- **Real aircraft are never the threat.** ADS-B tracks are cooperative and hold a low baseline priority;
  only synthetic injects can score as threats — in code, fixtures, tests, copy, and demo data.
- **No VIP tracking.** Vigil never singles out a specific individual's aircraft.
- **Public first principles only.** CPA/TCPA geometry, published counter-UAS concepts, FAA Remote ID,
  DO-260B, ICAO 8643, ASTM F3411. If a design question can only be answered from work knowledge,
  pick a different design.
- **Not an operational system.** Educational demonstration only; no claims about real-world threat
  assessment.
- **No simulated engagement.** No jamming, takeover, or kinetic defeat — the act step ends at
  assessment and notification.
- **IFF is out of scope.** Identity is plain English — Cooperative / Non-cooperative / Unknown — with
  no MIL-STD-2525 symbology.
- **Show what is observed or derived, never what is assigned.** Ground truth — `behavior`, `remoteId`,
  any generator-assigned field — stays in fixtures and tests; a display and the learner payload read
  only observed fields. Never resolve an identifier to a person.

## Stack and commands

Vite · React · TypeScript (strict) · MapLibre GL · Vitest · ESLint · Prettier. Scripts are Node; there
is no Python on the dev machine.

`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm run test` ·
`npm run format:check`

CI runs lint, typecheck, test, and format:check on every PR push. Red CI is a stop.

## Conventions

- Every PR starts as a GitHub Issue: feature PRs carry a mini-PRD (user story, acceptance criteria);
  cleanup PRs bundle owner-routed Issues. An agent-filed Issue declares its origin in its first line;
  the owner's routing comment makes it bundle-eligible.
- Branch `feat/pr-02-scenario-data` — kind, PR number, short slug. Conventional-ish commit subjects,
  imperative mood. Squash-merge and branch deletion are repo settings. A pushed branch is never
  rebased: it updates by merging `main`, and the squash absorbs the merge commit — the hook refuses
  the force push a rebase would need.
- Size: ~400 implementation lines is a gate-time estimate check, not a rule at open. The gate estimate
  lists App wiring and CSS as their own rows, states the actual-to-estimate ratio of the last three
  merged feature PRs — actual ÷ estimate, about 2 at revision 2 — and scales its total by it; the
  ~400 check runs on the scaled number.
  Implementation is counted one way at the gate and at open — insertions in non-test source,
  comments and blanks excluded, new files included. At open the PR reports raw / implementation /
  tests, the deltas by file, and a reading order. Growth past the scaled cap mid-build is a budget
  change: stop and re-gate. Once built and verified, reviewability decides; no post-hoc split.
- One test per behavior change. A test paired with a fix is shown failing on the pre-fix code, and
  the PR or the thread reply says so; a test that cannot tell the fix from the code before it is
  disclosed as pinning the shape instead. No dead code, no `console` noise.
- Update the README architecture diagram when a PR adds or removes a module or an edge, including
  un-dashing a box already reserved for it.
- A change that cannot test itself carries only the fix, no cleanup: the review action skips a run
  whose workflow file differs from `main`, so a workflow PR is first proven by the PR after it.
- Never type the mention handle in an Issue or a comment unless a run is wanted; write "the mention
  workflow."

## The plan gate

Every PR is planned and approved before it is built. Read the notes on every open Issue, not just the
target — rulings get parked on the Issue they will land in — and mark each as a **ruling** or an
**assumption**, saying which when parking a note of your own. User-visible work brings a mockup; the
mockup in the plan comment on the PR's Issue is the referent for what is approved. A gate checks
every invariant it claims against its own mockup's numbers before it posts — the bars against the
chip, the lines against the fit, the arithmetic against the table — and shows the check. A cleanup PR
bundling owner-routed Issues at ≤50 implementation lines is pre-approved by those Issues, mockup
included; one that outgrows its cap stops and queues, with the split or a raised cap as the options.

Mid-build, judge a deviation by what it touches. One that changes neither the approved design nor the
budget: flag it, keep going, disclose it at open. One that changes either: stop and re-gate on the
adjudication queue with the conflict, the proposed change, and the revised estimate. A ruling names
an outcome and a means: when the ruled means cannot meet the ruled outcome, the lane builds the
smallest change that does, discloses it with the alternative and an opt-out, and proceeds; a change
that moves the outcome stops and re-gates.

## Decision rights

Plan gates, closure declarations, and merges are the owner's alone.

**Precedence, when two rules apply:** an owner ruling on the item; the PR's own plan-gate approval or
closure declaration; a rule naming the case; the proceed list; the stop-and-queue list. A case
nothing above matches is queued.

**Proceed without asking — log it on the PR thread:** review-round triage, read from the PR's inline
review threads as well as its comments — the comment view misses the threads, an unresolved one
blocks the merge, and `node scripts/review-threads.ts <pr>` lists them before a round is reported
clean; thread reconciliation;
filing follow-up Issues; branch updates and changelog conflicts in the known ordering; retriggering
CI; fixes to factual errors within the approved design and budget; cleanup PRs of routed Issues at
≤50 lines.

**Stop and queue** — append to the pinned Adjudication queue, **#36**, with options and a
recommendation; the queued item waits, unrelated work continues: any change to what a user sees
beyond the approved mockup, on-screen wording included; scope adds or cuts; data provenance, privacy,
licensing, a new dependency, any new network call; design or budget changes mid-build; conflicts
between doc rules; changes to review tooling; a collision between rulings that precedence does not
settle. The owner answers the queue in batches. A lane whose open PR is blocked on the queue waits;
idle is acceptable.

**Closure and factual errors:** the review loop ends when the owner declares closure. After it,
findings become follow-up Issues — except a factual error (a broken requirement or wrong behavior),
which is fixed in the PR that finds it when it lies in that PR's files, still blocking its merge, and
otherwise filed as a blocking follow-up the owning lane takes next.

**Thread resolution:** the lane resolves a thread it answered with a fix once a CI run on that head
exists and passed — a conflicting branch runs none, and "no checks reported" is not green — and any
thread whose reply cites an owner ruling by ID. The round that produced the fix is the last round
unless the owner calls another, and a called round can reopen. Won't-fix and no-code-change
judgment threads are the owner's to resolve.

**Cadence:** governance text is revised in batches. Findings against it that are not factual errors
file to the standing Governance revisions Issue, **#45**, and land in the next governance PR, never
per-round; a factual error follows the factual-error rule.

## Lanes

One session and one git worktree per lane; one open PR per lane. A session's first act is to check
out `main` and pull: the hook and the rulebook are the checkout's. Surfaces are disjoint by default —
features to Lane A, scripts and docs to Lane B — but routing beats default: the lane holding an Issue
owns every file its fix touches for the life of that PR, unless the other lane has an open PR touching
that file, in which case the file is claimed on the queue. New files belong to the PR that creates
them. The lane whose PR merges second reconciles: the changelog in its known ordering (current-AO
statement first, then versions newest first, lead sentence maintained), renumbering its own entry to
the next free version if both lanes reserved the same one; the diagram redrawn over the merged
picture; §11 rows by PR number. Changelog entries are written while the PR they record is open, at
merge-time reconciliation, or as a doc-only fix repairing a merged entry's ordering or a factual
error.

## Architecture

- The ADS-B capture script, the inject generator, the lifecycle, and the scorer are pure modules — no
  React, no DOM, no I/O — unit-tested directly. The UI consumes them and never reimplements them.
- Determinism is a requirement: same seed and config, identical picture, proven by test. The photo
  tier is runtime and sits outside the scoring path behind an injected fetcher.
- Doctrine is configuration, not code: factor weights, the AO, protected sites, contacts,
  dispositions, airframe tables.
- Scores keep their per-factor breakdown for display; never collapse a score to a bare number.
  Ranking never reads lifecycle status.

## Enforced, not written

`main` is branch-protected: PR required, checks required, no bypass. A PreToolUse hook in
`.claude/settings.json` blocks pushes to `main`, force pushes, and dependency adds — a dependency is
asked for on the queue. Secret scanning with push protection is on. `scripts/review-threads.ts`
lists a PR's unresolved inline review threads and exits non-zero while any remain, so "clean" is a
computed claim. If a hook blocks something you believe is right, stop and queue it; do not work
around it.
