# Vigil — MVP Scope (v2)

**Status:** Draft — see changelog · **Owner:** Gary (PM + engineering org of one, assisted by Claude Code)
**Repo location:** `docs/mvp-scope.md` · **Prior step:** throwaway vision prototype (one sitting, no repo discipline — this doc is the backcast from it)

*Name confirmed: Vigil — short, intuitive (keeping watch), and it fits the night-watch scoring theme.*

**The current AO is PHL; entries run in one list in version order, newest first — numbers are reserved when the entry is created, at the PR's open or at the re-gate that earns it, so a lower number may land later.** **v2.16 changes:** §5.2 — each inject broadcasts a Remote ID UA type (ASTM F3411's public list, reduced to multirotor, aeroplane, and hybrid lift), drawn from a per-inject derived stream so the golden gained a field and moved no value, and observed only on the frames the ident is heard · §7 — the Review drawer's Track Visuals slot is filled: an original silhouette by airframe class, captioned with its basis — registry type code, broadcast emitter category, heard UA type, or the observed low-and-slow envelope labelled as the kinematic class — with the category, type, and registration rows labelled by provenance for ADS-B tracks; the photo tier follows as 03d · §11 — 03c/03d split at the tier seam (from the #22 plan gate). **v2.15 changes:** the on-open review workflow drops its `synchronize` trigger — the reviewer runs once when a pull request arrives (open, reopen, or leaving draft) and re-runs only when `@claude` asks for it, which is what §12.1 has said all along; the CI gates — lint, typecheck, test, format — stay on every push, unchanged. The reviewer is not the merge authority, and an every-push trigger gave the loop no stop before owner closure: ten rounds on #33, seven on #47 (#50). **v2.14 changes:** §7.1 — the transition table stated as ruled at the 03b plan gate: Escalate only from Assessing, Resolve only from Escalated with a disposition drawn from configuration, Dismiss from New or Assessing, Resolved and Dismissed terminal, no reopen; the dispositions join the contacts as configuration (from the 03b plan gate, #3). **v2.13 changes:** §5.1 — completing the record of the capture changes v2.12 under-reported: the gappiness budget counts missing frames rather than failed fetches, so a slot skipped after a backoff spends it the same as a fetch that failed and one tolerated 429 can end a short capture; and the script refuses arguments that do not describe at least one whole frame, checked on the rounded count where a single condition catches an overflowed window, a non-numeric one, and one too short to hold a frame (#42). **v2.12 changes:** §5.1 — the capture holds its ten-second floor after a backoff as well, skipping the slots the delay ran past rather than firing the backlog to catch up, so the recording's frame times stay honest and a gap reads as a gap (#29); the README diagram's fixture box drops the frame-count label that no maintenance rule fired on, which a recapture would have left asserting a shape the recording no longer had (#34). **v2.11 changes:** CLAUDE.md — decision rights and adjudication (what proceeds with a log entry, what stops and queues on the pinned #36) and the lane rules for parallel worktree sessions; changelog edits confined to the PR the entry records — created at that PR's open or at the re-gate that earns it, and amendable while its review runs — and merge-time conflict resolution in the known ordering · §12's deliberate conflict drill retired, and the §11 PR 05 row's drill pointer with it — three live changelog conflicts already completed the curriculum item (#36 [2e]) · the status header drops its version number — the changelog itself is the version record · Conventions aligned — factual errors are fixed where found or filed as blocking follow-ups, and every PR starts as an Issue: feature PRs a mini-PRD, cleanup PRs a bundle of owner-routed Issues, with §12's Mechanics line matching (from the owner's decision-rights rulings recorded on #36, [2a]–[2k] and [4a]–[4f]). **v2.10 changes:** §11 — PR 03 split into 03a (drawer, selection sync, layer filter, three columns, visuals slot), 03b (lifecycle, event log, handoff, state filter), and 03c (Track Visuals, #22); the state filter rides with 03b because filterable states do not exist before its lifecycle (from the 03 plan gate). **v2.9 changes:** §5.1 — the recording keeps the ADS-B enrichment fields (emitter category, registry type/description/registration) for display only, labelled by provenance and never scored, with a test pinning the display-only rule; the registered owner/operator is deliberately not captured — Vigil never resolves a tail number to a person; runtime third-party calls are permitted only for display enrichment that fails soft (from the #22 plan gate). **v2.8 changes:** §12 self-review checklist — the README architecture diagram is updated whenever a PR adds or removes a module or an edge · §3 and §5 reworded to stop using the old AO as the example region; the v2/v2.1 entries below keep the record of the move (#11). **v2.7 changes:** §7 — the Queue displays observed and derived fields only, with ground truth confined to fixtures and tests; a track with no broadcast identity shows a neutral `TRK-nn`; range defined as distance to the protected site's center in km to one decimal; the on-screen identity legend, sharing its dot with the Queue rows (from the 02c plan gate). **v2.6 changes:** §5.2 inject floor raised from 3 to 5 so every behavior appears in every scenario · §5.2 invariant added — a scenario is a function of seed and config alone; the timeline samples it and never reshapes it (from the post-02b audit, #15). **v2.5 changes:** §5.2 corrected — Remote ID is three states, not two, and `intermittent` is an observed per-frame dropout (Cooperative when heard, Unknown when not) rather than a static label, with smoothing deferred to PR 04 · §11's PR 02 row records the 02a/02b/02c split. **v2.4 changes:** PR size budget clarified — the ~400-line target counts implementation lines only, with tests, comments, and fixtures reported in the PR description but outside the budget · capture etiquette added to §5.1 after a five-second poll earned a rate limit and then a block. **v2.3 changes:** Remote ID added as a synthetic inject attribute — injects split into RID-broadcasting cooperative drones and silent non-cooperative ones · military IFF explicitly out of scope. **v2.2 changes:** plain-English UI labels added to the factor table · track workflow upgraded from bare actions to an incident lifecycle grounded in the current US domestic C-UAS framework (SAFER SKIES Act, July 2026 rule) · escalation handoff summary added to MVP and PR 03 scope grown accordingly · no-simulated-engagement guardrail added. **v2.1 changes:** name locked (Vigil) · AO moved from DFW to PHL (home turf, real-world testing downstream) and fully parameterized · no-VIP-tracking rule added to guardrails · real-data special-status enrichment queued for Phase 2. **v2 changes:** scenario rebuilt on real ADS-B data over a real AO — DFW at the time, moved to PHL in v2.1 — replacing the open-ocean synthetic AO · plain-language identity model replacing MIL-STD-2525 references · scoring roadmap extended with pattern features, time context, and a learned anomaly layer · PR plan and setup checklist reworked accordingly.

---

## 1. What this is

Vigil is an explainable airspace-triage workstation for the Philadelphia-area airspace (PHL). It fuses two layers into one picture — real, publicly broadcast ADS-B traffic (the cooperative aircraft) and simulated small-UAS tracks (the injects) — scores every track against a protected site using transparent logic, and presents a ranked queue so a watch officer always knows which track deserves attention first, and exactly why.

The project has two jobs, in this order:

1. **Learning vehicle.** Every change ships through the full modern path — issue, branch, PR, AI code review, CI, engineering review, iteration, merge — so the vocabulary and mechanics of end-to-end shipping become muscle memory.
2. **Portfolio artifact.** A public repo with a clean PR history demonstrating, to a Director-level panel, a PM who ships with AI agents in a hot, industry-relevant domain (counter-UAS / airspace security).

## 2. Hard guardrails (non-negotiable)

- **Public or synthetic data only.** The real layer is ADS-B — broadcast in the clear by aircraft and freely rebroadcast by community aggregators. The threat layer is 100% generated. Nothing observed, recorded, or derived from any work system ever enters this repo.
- **Real aircraft are never the threat.** By design, any track sourced from ADS-B is treated as cooperative and receives low baseline priority. Only synthetic injects can score as threats. This is both an ethics rule and a product truth (broadcasting your position is the defining cooperative act). Vigil also never singles out specific individuals' aircraft — no VIP or celebrity tracking; real tracks receive special attention only for assistance signals they broadcast themselves (see Phase 2).
- **Public first principles only.** Design draws exclusively on open literature: CPA/TCPA geometry, published counter-UAS concepts, FAA Remote ID as public context. No Camgian or Reactor requirements, terminology, code, or documents — if a design question can only be answered from work knowledge, pick a different design.
- **Not an operational system.** README states plainly: educational demonstration, not for operational use, no claims about real-world threat assessment.
- **No simulated engagement.** Vigil never models jamming, takeover, or kinetic defeat. Its act step ends at assessment and notification — which is both the ethics posture and the watch floor's actual job (see §7.1).
- **Public repo from day one.** Openness is the enforcement mechanism.

## 3. User and job

**The watch officer for PHL-area airspace security** (the *job* is inspired by a real conference conversation about airport-area safety in another region; the person and their systems stay out of this project, and the geography moved home). They monitor a workstation covering the region. Job statement: *"When something is flying near a protected site that shouldn't be, I need to know first, with a reason I can act on and defend."* The interesting traffic is exactly what ADS-B doesn't show — so Vigil's premise is: render the cooperative picture as calm background, and make the non-cooperative injects impossible to miss.

## 4. Product principles

1. **Explainability over cleverness.** Every score decomposes into visible factors — including, eventually, the learned ones. A ranked list nobody can interrogate is a liability.
2. **The queue is the product; the map is context.** Screen real estate serves the ranked list first.
3. **Plain language, intuitive at a glance.** No military symbology standard. Identity states in English (Cooperative / Non-cooperative / Unknown), calm colors for calm traffic, alarm colors earned only by score. A smart civilian should read the screen cold.
4. **Doctrine is configuration, not code.** Weights are data. MVP hardcodes defaults; the architecture assumes they change — first by slider, later by learning.

## 5. The picture

The AO is pure configuration — center point, capture bounding box, protected sites. PHL by default; relocating Vigil to any other region is a config change, not a rewrite.

### 5.1 Real layer — recorded ADS-B, replayed

- **MVP uses a recorded fixture, not a live feed:** a capture script pulls ~15–30 minutes of real PHL-area traffic once from a public aggregator, saved as JSON in the repo, replayed on a clock. This keeps tests deterministic, demos reproducible, and the MVP free of rate limits, CORS, and outage risk. Going live is Phase 2, where it belongs — behind the backend.
- **Source:** adsb.lol (free, open-data, unfiltered API) for the capture; OpenSky Network (free for research/personal use, registered account) as backup.
- **Capture etiquette.** The aggregators are free services running on donated receivers, and a capture that abuses one is a capture that stops working: the script floors its polling interval at 10 seconds — after a backoff too, skipping the slots the delay ran past instead of firing the backlog back to back, which is the moment abuse is least affordable — honors `Retry-After`, and abandons the run on the second 429 rather than grinding through a rate limit into a block. A recording is written only if no more than a tenth of its frames are **missing** — counted as missing, not merely failed: a slot skipped to hold the floor after a backoff leaves the same hole as a frame that failed outright and spends the budget the same way, so a single tolerated 429 can end a short capture. Arguments that do not describe at least one whole frame are refused before any request goes out.
- Fields normalized into the common track model: ICAO hex, callsign, position, altitude, ground speed, heading, vertical rate, last-seen.
- **Enrichment fields are display-only.** The recording also keeps the broadcast emitter category and the aggregator's registry lookups — type code, type description, registration. They are shown labelled by provenance (observed vs. lookup) and never scored: nothing in the scoring path reads them, and a test pins it. **Runtime third-party calls are permitted only for display enrichment that fails soft; nothing in the scoring path reads the network.** **Vigil displays what is broadcast or what a public type registry says about the airframe; it never resolves a tail number to a person** — the feed's registered owner/operator field is deliberately not captured, and an airline operator, if ever wanted, comes from a callsign-prefix table, which can only name a company.

### 5.2 Synthetic layer — the injects

- 5–8 simulated small-UAS tracks per scenario (the floor is the behavior count, so every behavior appears in every scenario — the generator refuses a lower floor): low altitude, slow, launched from synthetic points around the region. Launch points are a bearing and a range from the AO center, so relocating the AO relocates them, and all of them sit outside the protected-site ring — an inject has to fly to get inside. Seedable and deterministic: same seed → identical picture, pinned by a committed golden fixture rather than by a snapshot.
- **A scenario is a function of seed and config alone; the timeline samples it and never reshapes it.** Recapturing the ADS-B layer at a different length or cadence adds or removes frames of the same injects — it does not deal a different scenario.
- Each inject carries a **Remote ID status**, in three states, and the picture reports the *observed* identity rather than the label:
  - **Broadcasting** → **Cooperative.** A legitimate hobbyist or Part 107 operation, identifying itself. Low priority.
  - **Intermittent** → **Cooperative on the frames the broadcast is heard, Unknown on the frames it is not.** The dropout is real, not a label: the broadcast genuinely comes and goes across frames, in runs rather than one frame at a time, and the ident disappears with it. The resulting per-frame flicker is by design at the data layer — smoothing it (identity dwell, or hysteresis on the last confirmed ident) is a scoring concern and belongs to PR 04.
  - **Silent** → **Non-cooperative.** Nothing is broadcast at all. The interesting case.
- The `remoteId` field is ground truth about the airframe; identity is what the picture can actually tell. Scoring reads the observed history, never the label — see PR 04.
- Each inject also carries a **Remote ID UA type** (ASTM F3411's public list, reduced to multirotor, aeroplane, and hybrid lift), drawn from a per-inject derived stream so that lengthening the recording or re-weighting the draw moves nothing else in the scenario. It is observed only on the frames the broadcast is heard — a silent inject never shows one, and the picture classes it from its motion instead: *small UAS (kinematic class)*, labelled as such.
- This mirrors the real triage problem: the question is never "is it a drone," it's "is it identifying itself."
- Scenario scripts give injects *behaviors*: transit, loiter, orbit a point, lawnmower/grid sweep, approach-and-retreat. Behaviors are what the pattern features in §6 exist to catch.
- **Protected site (MVP):** the PHL airfield, as a point plus radius. **Stretch:** multiple sites with schedules — the South Philadelphia sports complex (three major venues in one square mile) becomes protected on event nights, which turns time-of-day from a number into a story.

## 6. Scoring engine v1 — transparent factors

A pure TypeScript module producing a 0–100 composite with the per-factor breakdown retained for display. All factors below are deterministic and hand-weighted in v1 — the learned layer comes in Phase 3 (§8).

| Factor | UI label | Intent (doubles as hover text) | Default weight |
|---|---|---|---|
| Cooperativity | Non-cooperative | Silence carries the burden of proof — a spectrum: ADS-B aircraft near-floor, Remote ID drones low, silent tracks high | 25% |
| Closing geometry | Closing | CPA distance and time-to-CPA relative to the protected site | 20% |
| Proximity | Proximity | Current range to the protected site, decaying with distance — the curve spikes inside the protection ring, which subsumes "airspace violation" for MVP | 15% |
| Pattern of life | Loitering | Loiter dwell, orbit detection (persistent turn rate), area revisit — the reason tag names the specific behavior | 15% |
| Kinematic profile | Flight profile | Low-and-slow small-UAS envelope vs. conventional aircraft envelope | 10% |
| Time context | Off-hours | Activity outside normal operating hours scores higher (simple multiplier in v1) | 10% |
| Staleness | Stale track | Penalty as a track misses updates | 5% |

The UI label column is the spec for what renders in the breakdown bars (Principle 3 — a smart civilian reads it cold); the Intent column becomes the hover text.

Exact curves and weights are decided in PRs 04–05, under unit tests. The table is a starting point, not doctrine.

## 7. UI — desktop-first, three surfaces

- **Home:** app shell, nav, picture status strip (track counts by layer, scenario seed, sim clock with time-of-day).
- **Queue:** ranked list; each row shows score chip, top-contributing-factor tag in plain English ("Loitering near PHL, non-cooperative, 0230"), layer badge; filter by layer/state; click through to Review. **The Queue displays observed and derived fields only; ground truth lives in fixtures and tests.** A row shows what the system observes (identity, broadcast ident, ground state) or derives (rank, range) — never what the generator assigned. Scripted behavior and Remote ID status are the answer key, and stay out of the row until PR 05 earns the right to display a *detected* pattern; the layer badge is the one place the synthetic layer is disclosed. A track with no broadcast identity shows a neutral track number derived from its stable id (`TRK-nn`), not its inject id. **Range** is the distance from the track to the protected site's center — the nearest site, when there is more than one — in km to one decimal.
- **Review:** detail drawer — map focuses the track, factor-breakdown bars, kinematics and history trail, and the §7.1 workflow actions (client-state only — and quietly the future training signal, per §8). **Track Visuals:** an original silhouette by airframe class, captioned with what it rests on — a registry type code, the broadcast emitter category, a heard Remote ID UA type, or the observed low-and-slow envelope labelled as the kinematic class — and, for ADS-B tracks, the category, type, and registration rows labelled by provenance; a photo tier for ADS-B only, failing soft to the silhouette, follows (03d). Nothing in the slot is scored, and the kinematic class never applies to a track that is broadcasting.
- **Map:** MapLibre GL centered on the configured AO; cooperative traffic rendered small and calm, injects rendered prominent, protected-site ring, selected-track highlight and breadcrumb trail. Basemap: keyless demo tiles to start; dark-style decision in PR 01. **Identity legend** in a map corner — blue Cooperative, violet Non-cooperative, pale grey-white Unknown — sharing its dot component with the Queue rows, so the three states read the same on the map stroke, in the list, and in the key; on screen on every surface, which is what lets Home be read without a Queue beside it.

### 7.1 Workflow — grounded in the current US domestic framework

Vigil maps onto the detect → track → identify → assess → act chain like this: detection and tracking are the feed layer, identification is the cooperativity layer, assessment is the scoring engine plus a human. The act step is where domestic reality bites: under the SAFER SKIES Act (Dec 2025) and its July 2026 implementing rule, mitigation is reserved for certified personnel operating inside a federal process — credible-threat determination, real-time ATC notification, FBI/DHS notification, proportionality, and mandated reporting. A watch floor's act is therefore a **coordinated notification with the evidence attached**, and Vigil is built for exactly that. The framework runs on notification and reporting, so the defensible record isn't a nice-to-have — it's the feature.

**Track lifecycle** (every transition timestamped to a per-track event log): **New → Assessing → Escalated → Resolved**, plus **Dismissed** for benign tracks. Actions: **Assess** (claim the track), **Escalate** (pick a recipient from a mock contact list — Airport Operations, PHL Tower, Airport Police C-UAS unit — and Vigil generates a handoff summary: track history, score breakdown, event timeline, as copyable text), **Dismiss**, and **Resolve** (with a disposition drawn from the configured list — an outcome label is doctrine, and doctrine is configuration). The table as ruled at the 03b gate: Assess claims a New track; Escalate only from Assessing — a track is claimed before it is handed off; Resolve only from Escalated; Dismiss from New or Assessing; Resolved and Dismissed are terminal for MVP — no reopen. Actually transmitting the handoff is Phase 2; per §2, the act step ends at notification — no simulated engagement.

## 8. The learned layer — Phase 3, and why not sooner

The ambition is right: more factors, weights that adapt, and surprising signals bubbling up. The honest sequencing:

- **v1 is transparent rules** because learning needs either labels or a normalcy baseline, and on day one we have neither. Shipping mechanics — the actual point of this project — must not wait on an ML research question.
- **Phase 3a — anomaly factor (unsupervised).** Train a simple anomaly model (e.g., Isolation Forest) on "normal" for this AO — built from the ADS-B recording plus background sim traffic, with hour-of-day as a feature. Its output becomes **one factor in the composite**, with a plain-language explanation of what made the track unusual. This is where time-of-day stops being a hand-set multiplier and becomes learned normalcy — a 3 AM drone is anomalous because 3 AM *is* quiet, not because we said so. It's also the mechanism by which unconsidered factors surface.
- **Phase 3b — the feedback loop.** Assess / Escalate / Dismiss / Resolve are operator labels — escalations especially strong ones. Enough of them enable learned weight adjustment (which factors actually predicted what the operator prioritized). The MVP's job is simply to log these actions in a shape a learner can consume later.
- **Candidate features to explore in 3a**, seeded now so they're not forgotten: broadcast anomalies (position jumps, impossible kinematics — spoofing tells), multi-track coordination (two injects moving in formation), first-seen platform behavior at a site, and approach-angle asymmetries.

## 9. Out of scope — MVP

Live ADS-B polling (Phase 2), backend/API and WebSocket (Phase 2), any ML (Phase 3), CoT/TAK output (Phase 4), persistence, auth, multi-user, mobile layout, alerting/notifications, military identification systems (IFF — a civil watch floor has no interrogator, and it sits deliberately outside this repo's lane), sensor-fusion realism (one clean track per object; no detection modeling). Cut to keep the MVP shippable in ~8 weeks of part-time PRs.

## 10. Phasing

- **Phase 1 (this doc):** frontend stub in `main` — recorded ADS-B replay + synthetic injects, transparent engine, three surfaces.
- **Phase 2:** FastAPI backend owns ingestion and scoring; live ADS-B polling with caching; real-data special-status enrichment — emergency squawk codes and MEDEVAC-type callsigns can elevate real tracks *for assistance and awareness, never as threats*; WebSocket feed; frontend swaps replay for the socket — the "plug the backend into the stub" experience, done personally.
- **Phase 3:** learned layer — anomaly factor (3a), then the operator-feedback loop (3b).
- **Phase 4:** CoT emitter → OpenTAKServer → prioritized tracks visible in ATAK on a tablet. Vigil is the workstation; ATAK is the downstream edge display.

## 11. Build plan — PR sequence

Target under ~400 **implementation** lines per PR; when a PR swells, split it rather than grow it.

The budget counts implementation only. Tests, comments, and recorded fixtures sit outside it — a
size target that discourages any of the three is buying small diffs with the things that make the
diff trustworthy. They are still reported, not ignored: every PR description states the split as
**raw / implementation / tests**, so the cost of a change stays visible even where it is not
charged against the budget.

| PR | Scope | Acceptance criteria | Learning objective |
|---|---|---|---|
| **00 — Scaffold & pipeline** | Vite + React + TS, ESLint/Prettier, Vitest, GitHub Actions (lint/typecheck/test), branch protection, Claude Code GitHub app, `CLAUDE.md` v1 | Trivial PR turns CI green; direct push to `main` blocked; `@claude` responds | Repo hygiene, Actions, required checks |
| **01 — Shell + map** | Layout, nav, dark theme, MapLibre centered on the AO (PHL default), basemap decision | Shell renders; map pans/zooms; CI green | First full loop: branch → PR → review → iterate → squash-merge |
| **02 — Scenario data** | Split into three, on the §11 budget: **02a** ADS-B capture script + committed fixture + the shared track model; **02b** inject generator (seeded RNG, five behaviors, three Remote ID states) + inject map layer; **02c** placeholder ranking (cooperativity, then proximity) + the Queue. Issue #2 stays open across all three and closes with 02c. | Same seed → identical picture, proven by a committed golden fixture and a same-seed/different-seed test; both layers visible on map and queue | Working with external data, normalization, fixtures, deterministic design |
| **03 — Track Review + workflow** | Split at the plan gate, on the §11 budget: **03a** detail drawer, two-way map↔selection sync, layer filter, three-column layout, reserved Track Visuals slot; **03b** §7.1 lifecycle — statuses, per-track event log, escalation handoff summary in learner-ready shape — plus the state filter, which needs 03b's states to exist; **03c** Track Visuals tier one — the generator's UA type, the airframe classifier and its tables, the silhouettes, the labelled lookup rows; **03d** tier two — the photo for ADS-B tracks only, failing soft to the silhouette (#22 stays open across both and closes with 03d). Issue #3 closes with 03b. | Click row → drawer opens, map focuses; full lifecycle walkable New→Resolved; Escalate produces a copyable handoff summary | Component structure, state management, responding to review comments |
| **04 — Scoring engine v1** | Base factors: cooperativity, closing geometry, proximity, kinematic profile, time context; breakdown UI | Every factor unit-tested; hand-computed scenario matches; queue order visibly changes vs. PR 02 | Refactoring under green tests |
| **05 — Pattern features** | Loiter dwell, orbit detection, revisit; integrated as the pattern-of-life factor | Scripted loiter/orbit injects rank above transit injects, proven by test | Extending a tested module |
| **06 — Playback loop** | Replay clock advances ADS-B fixture + inject kinematics ~1 Hz; live re-ranking; staleness accrual; pause/seek | Queue re-ranks as the scenario plays; pause freezes; no timing-flaky tests | Async and timing, simulation seams, flaky-test awareness |
| **07 — Stretch: weight panel** | Sliders for §6 weights, live re-rank | Moving a slider visibly reorders the queue | The "doctrine as configuration" demo moment |

## 12. Process contract — every PR, the same path

1. **AI code review** — automatic on PR open; `@claude` for follow-ups.
2. **Automated tests** — CI must be green; red CI is a stop, not a suggestion.
3. **Engineering review** — self-review with the checklist below, on the GitHub diff, not in the editor.
4. **Comments + iteration** — reply to every review comment with a fix or a reasoned "won't fix."
5. **Merge** — squash-merge, delete branch.

**Mechanics:** every PR starts as a GitHub Issue — feature PRs carry a mini-PRD (user story + acceptance criteria), cleanup PRs bundle owner-routed Issues. Branch naming `feat/pr-02-scenario-data`. `CLAUDE.md` carries stack, commands, conventions, and the §2 guardrails so the agent enforces them too.

**Self-review checklist:** read the full diff cold; run the app and exercise the change; check every acceptance criterion; at least one test per behavior change; no dead code or console noise; README diagram updated if this PR adds or removes a module (a stage on the data path) or an edge, or lands a module the diagram already reserves as dashed.

## 13. Definition of done + demo script

MVP is done when PRs 00–06 are merged through the full five-step path, CI is green, the README carries the §2 statement and a demo GIF, and this **90-second demo** runs cold:

Open the app on the PHL picture — real traffic flowing calmly along the river approaches → an inject appears low and slow near the airfield at 0230 sim-time → it climbs the queue as it starts to orbit → click it → the breakdown reads *non-cooperative, loitering, off-hours, closing* → Escalate → Vigil generates the handoff summary addressed to PHL Tower → the next track promotes. Close by narrating any single PR's history — issue, review comments, iterations — to a stranger, decision by decision.

## 14. Cadence

Vision prototype plus PR 00 in weekend one; then one PR per week at 3–5 focused hours; MVP demo around week 8. When a week gets tight, **cut scope from the PR, never steps from the path** — the path is the product being practiced.

---

## Appendix A — Accounts and tools (one-time, ~1 hour, Windows)

Accounts:
- [ ] **GitHub** — free personal account, registered with a personal email (never the work address). This account is also a job-search asset; the repo will live on it.
- [ ] **Claude** — your existing claude.ai Pro/Max subscription covers Claude Code; you'll log in with it during setup. No separate API billing needed.
- [ ] **OpenSky Network** — free account, only if the adsb.lol capture disappoints. Skip for now.

Installs, in order (PowerShell / winget):
- [ ] **Git for Windows** — `winget install Git.Git` (required for Claude Code on native Windows)
- [ ] **Node.js LTS** — `winget install OpenJS.NodeJS.LTS` (needed for Vite/npm regardless of how Claude Code is installed)
- [ ] **VS Code** — `winget install Microsoft.VisualStudioCode` (you'll read diffs and code here even though Claude writes most of it)
- [ ] **GitHub CLI** — `winget install GitHub.cli`, then `gh auth login` (Claude Code uses it for PR operations)
- [ ] **Claude Code** — in PowerShell: `irm https://claude.ai/install.ps1 | iex`, then run `claude` in the project folder and log in with your claude.ai account

## Appendix B — Weekend-1 checklist

- [ ] Complete Appendix A
- [ ] Vibe-code the throwaway vision prototype with Claude (no repo, no discipline — it exists to be discarded)
- [ ] Create the public GitHub repo; README with the §2 guardrail statement
- [ ] Scaffold Vite + React + TS; first commit
- [ ] Add ESLint, Prettier, Vitest; npm scripts for `lint`, `typecheck`, `test`
- [ ] GitHub Actions workflow running all three on every PR
- [ ] Branch protection on `main`: require PR + green checks
- [ ] In Claude Code, run `/install-github-app`; confirm `@claude` replies on a test PR
- [ ] Write `CLAUDE.md` v1 (see Appendix C)
- [ ] Open Issues for PRs 01–06, each with its mini-PRD
- [ ] Ship PR 00 through the full five-step path

## Appendix C — CLAUDE.md v1 outline

Keep it under a page: project one-liner and the §2 guardrails (including "real aircraft are never the threat") · stack and key commands (`dev`, `lint`, `typecheck`, `test`) · conventions (branch naming, squash-merge, PR size target) · architecture notes (capture script, inject generator, and scorer are pure modules; UI consumes them) · what the agent should never do (touch `main` directly, add dependencies without asking, generate anything portraying real aircraft as threats).
