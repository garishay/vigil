# Vigil

**Explainable airspace triage for the PHL area.**

## Open it

- **The demo** — <https://garishay.github.io/vigil/> — the default recording. Press Play, read the Priority list. Every merge to `main` redeploys it.
- **The evening arrivals bank** — [`?recording=vigil-phl-002`](https://garishay.github.io/vigil/?recording=vigil-phl-002).
- **The sheet page** — [`?sheet`](https://garishay.github.io/vigil/?sheet): drop a results file, or both run files, or paste them, and the subject sheet is drawn in that tab, downloaded or printed; **Clear saved runs** asks once before it removes what the browser holds.

## Run a study session — one link per person

Unaided first, then Vigil; or Vigil first, then unaided. Put the person's code in for `<code>`:

```
https://garishay.github.io/vigil/?feed=recording:vigil-phl-002&scenario=03a&mode=raw&subject=<code>&run=1
https://garishay.github.io/vigil/?feed=recording:vigil-phl-002&scenario=03a&subject=<code>&run=1
```

The link opens on the brief. Run 1 ends in **Start run 2** — the pair's other scenario, the other condition, the same code. Run 2 ends in **See your results** and **Download results**, the one file to hand over.
A link with `subject` and `run` opens on the brief and is a study run; without them it is a demo and plays on.
A fresh code per person: a run is kept in the browser under its code. A link opened with one run saved resumes at the run not yet saved.
A link that opens on **Session complete** means that code's session is finished in that browser — **Download results** is on that card; a new person takes a fresh code.
**Clear saved runs**, on the sheet page, removes every saved run in that browser — every code — so download first.

<details><summary>Every scenario link, and the URL parameters</summary>

| scenario | condition | link                                                                                                                                          |
| -------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 02a      | Vigil     | [`?feed=recording:vigil-phl-002&scenario=02a`](https://garishay.github.io/vigil/?feed=recording:vigil-phl-002&scenario=02a)                   |
| 02a      | unaided   | [`?feed=recording:vigil-phl-002&scenario=02a&mode=raw`](https://garishay.github.io/vigil/?feed=recording:vigil-phl-002&scenario=02a&mode=raw) |
| 02b      | Vigil     | [`?feed=recording:vigil-phl-002&scenario=02b`](https://garishay.github.io/vigil/?feed=recording:vigil-phl-002&scenario=02b)                   |
| 02b      | unaided   | [`?feed=recording:vigil-phl-002&scenario=02b&mode=raw`](https://garishay.github.io/vigil/?feed=recording:vigil-phl-002&scenario=02b&mode=raw) |
| 03a      | Vigil     | [`?feed=recording:vigil-phl-002&scenario=03a`](https://garishay.github.io/vigil/?feed=recording:vigil-phl-002&scenario=03a)                   |
| 03a      | unaided   | [`?feed=recording:vigil-phl-002&scenario=03a&mode=raw`](https://garishay.github.io/vigil/?feed=recording:vigil-phl-002&scenario=03a&mode=raw) |
| 03b      | Vigil     | [`?feed=recording:vigil-phl-002&scenario=03b`](https://garishay.github.io/vigil/?feed=recording:vigil-phl-002&scenario=03b)                   |
| 03b      | unaided   | [`?feed=recording:vigil-phl-002&scenario=03b&mode=raw`](https://garishay.github.io/vigil/?feed=recording:vigil-phl-002&scenario=03b&mode=raw) |

One link a row, not two: the Demo form this list once carried beside each Study form — `?recording=vigil-phl-002&scenario=…` — resolves to the same session, since `?recording=<id>` is the alias of `?feed=recording:<id>` and is folded into the feed list before anything else reads it (`src/lib/session.ts`); a link is a study run when it carries `subject` and `run`, whichever form named the recording.

A 02 study link (S3b, S4a) is the corroboration pair; a 03 link (S7) the prioritization pair. A 03 run is as long as its scenario says — 3:38 on both, since 03b is 03a turned (S7d) — where a 02 run is six minutes. A worked study link, subject S03, run 1: [`?feed=recording:vigil-phl-002&scenario=02a&mode=raw&subject=S03&run=1`](https://garishay.github.io/vigil/?feed=recording:vigil-phl-002&scenario=02a&mode=raw&subject=S03&run=1).

- `feed=recording:<id>` — the recording; the picture is its real layer with the scenario beside it. `vigil-phl-001` is the default.
- `recording=<id>` — the same, as an alias: the two forms are one.
- `scenario=<name>` — a study scenario by name; `on`, the default, is the default deal, `off` none. A study link names one.
- `mode=raw` — the unaided condition; `vigil`, the default, is the app as built.
- `subject=<code>` — with `run`, both or neither: the person's code, under which the browser keeps their runs.
- `run=<n>` — 1 or 2; a link opened again resumes at the first run not yet saved and never re-runs a saved one.
- `sheet` — the sheet page, alone.

</details>

A study run shows only what the task needs (S8): no tab bar in either condition — the run opens on the map and, in Vigil, the **Priority list** beside it, with the detail in place on selection — the detail offers Escalate and Dismiss, each one click on any track and closing the detail, and a track the subject has opened reads Opened and is drawn in a grey on the map from the click, one they have escalated or dismissed is drawn hollow; in Vigil an alert card's face is Open — it opens the card's track and clears the card — and its × clears the card alone (S8b); in Vigil the map spends one colour, red on a track at warning, and every other track wears the unaided neutral with no dim and no map legend (S9b); the brief that opens the run is one screen with the map's own legend, and the three end questions read as questions with their ends labelled. The demo opens on the same Priority list beside the map, with Sites as its other tab (#183).

Vigil is an airspace-triage workstation for Philadelphia-area airspace. It fuses two layers into
one picture — real, publicly broadcast ADS-B traffic (the cooperative aircraft) and simulated
small-UAS tracks (the injects) — scores every track against a protected site using transparent,
inspectable logic, and presents a ranked queue so a watch officer always knows which track
deserves attention first, and exactly why.

Every score decomposes into visible factors. A ranked list nobody can interrogate is a liability.

---

## How it fits together

Two layers converge on one track model; pure modules do the work and the UI only consumes them.
The two scripts under `scripts/` run offline, once, and are the only boxes that do I/O without
a test seam. The app calls the modules; nothing calls back. The diagram draws the **data path,
not the import graph**: helper modules (`geo`, `rng`, `identity`) and type-only edges are
deliberately omitted. The shared track model is drawn as the hub on purpose — every stage meets
its contract there — and pure helpers (`display` included) fold into their consumers, as the
silhouettes fold into the drawer. Dashed boxes are later PRs; dashed edges are supporting
relationships — a startup fetch, a regeneration, a display lookup that fails soft — rather than
the runtime data path. The one runtime network call, the photo lookup, sits outside the pure
boundary and reaches nothing inside it.

```mermaid
flowchart LR
  subgraph offline["Offline, run once — network and filesystem, not a runtime module"]
    direction LR
    cap["scripts/capture-adsb.ts"] --> fx[("public/adsb-phl.json · adsb-phl-002.json<br/>the committed recordings")]
    fx --> goldgen["scripts/generate-inject-golden.ts<br/>npm run fixture:injects<br/>samples the plan at the recording's frame times"]
    tonegen["scripts/generate-tone.ts<br/>npm run fixture:tone<br/>the alert tone, synthesized — original and deterministic"] --> tone[("public/alert-tone.wav")]
    bench["scripts/bench.ts<br/>npm run bench · bench:baseline<br/>every recording × N seeds at one-second ticks, the engine through the app's own seams<br/>the generator's labels as the oracle · a config override for a sweep, printed, never written"] --> baseline[("docs/bench/baseline.md<br/>the scoreboard: crossings, ranks, flaps per behavior; real aircraft by uncapped band<br/>a test holds the default run to it byte for byte")]
    study["scripts/study.ts<br/>npm run bench:study<br/>the operator study's acceptance: each study scenario through the feed beside 002 over its own window<br/>02's four lines · 03's prioritization lines — the lock, the margins, the baits, the band rows, the rule · the cue audit on airborne ticks · above calm · flaps · pattern-kind changes · every ring entry — held byte for byte by test · what goes red and when, pinned (S9b)"] --> sb[("docs/bench/study-02a.md · study-02b.md · study-03a.md · study-03b.md")]
    spec["scripts/study-spec.ts<br/>the study’s casts by role — each scenario’s threats, its baits, its band rows — by the study files’ own numbering<br/>pure data, so the sheet’s path carries no node: import and the tool bundles for a browser (S6a-i)"]
    spec --> study
    fx --> study
    fx --> bench
    replaytool["tools/replay.ts + tools/replay/<br/>replay/files.ts reads the run files and the recording; everything else is pure, so the renderer runs unchanged in a browser (S6a-i)<br/>npm run replay · --study <dir> --out <dir><br/>the study's replay (S5): run JSON in, validated in so many words · the scenario regenerated from its seed at t + beginS through associate at the run's mode<br/>standoff at decision · time to escalate · miss · false escalations · looks · the study CSV (S5a)<br/>the frame per run (S5b): the picture at the freeze, the ring, the threat's trail, every look as a hop on the path, the analyst's never-opened overlay, the caption — identical in both modes; engine.ts scores a second as the bench does<br/>N threats from the bench's roles table (S5c-i): the window per scenario, the metrics per threat, the attention numbers — opened before the first threat, first open and standoff per threat, false escalations against later entrants, order — the frame per threat<br/>the Vigil annotations on a Vigil frame only (S5c-ii): the warm labels, the Queue box under the map, a threat's mismatch line and entry estimate, the caption's Vigil line per threat look — the app's readings through engine.ts<br/>the pair (S5d-i): two frames side by side, the boxes capped, one row per threat on a shared time axis with the standoff band per threat<br/>the study figure (S5d-ii): by family, attention first — count, time, and standoff axes with an unaided lane and a Vigil lane, stacked dots, subject connectors, the counts<br/>the subject sheet (S5e): a subject’s unaided run on one scenario beside their Vigil run on the other — the headline in sentences, the two frames, and one row per threat by role with the time lane and the ring<br/>the whole run and every escalation (S5f): the path and markers to the run’s end, the later ones outlined; each caption listing every escalation besides the threats with what the track turned out to be; the sheet’s headline naming them and a third row marking them on the same axis<br/>the decision log (S5g): one line per decision in the clock’s order, each fact once, one name per track — the screen’s, with the role — carried into the map labels, the freeze ruled across the log, the miss beneath it and the overlay’s count at the foot<br/>a results file wherever a run file goes (S6a-i): one subject’s two runs under one envelope, unwrapped by the loader, the folder walk of --study included<br/>the comparison before the logs (S5g, #194): the sheet as blocks — the headline with the two pictures, a row a threat, the other escalations, the logs a line a block, the Queue box, the footnotes — the browser mounts one by one and the CLI stacks into one file, each block the same bytes in both; the headline leads with the looks to the last threat escalation and carries the whole run’s count after it"] --> studyout[("study/ — gitignored<br/>study.csv and study.svg · one SVG per run · pair-&lt;subject&gt;-&lt;scenario&gt;.svg for two runs of one scenario · sheet-&lt;subject&gt;-&lt;scenarioA&gt;-&lt;scenarioB&gt;.svg for two of one family · the fixtures under tools/replay/__fixtures__ are the only runs the repo holds")]
    fx --> replaytool
  end
  subgraph pure["Pure modules — no React, no DOM, no I/O in the scoring path; unit-tested directly"]
    direction LR
    subgraph real["Real layer — public ADS-B, cooperative by construction"]
      direction LR
      recs["config/recordings.ts<br/>the registry: id · file · clock start<br/>?recording=id selects one; 001 the default"] --> load
      load["data/capture.ts<br/>loadCapture: fetch once at startup, AO guard<br/>frameTracks"] --> norm["lib/adsb.ts<br/>toTrack: record → AdsbTrack<br/>identity is the literal 'cooperative'<br/>(normalizers run at capture time)"]
      norm --> replay["lib/replay.ts<br/>indexCapture → pictureAt(t): bracket by the track's own samples,<br/>interpolate, hold, coast then drop · memoryAt: identity memory as a fold over the frame grid<br/>historyAt / historiesAt(t): every track's position history — samples for an aircraft, grid instants for an inject —<br/>the map's trail at one window, the pattern detectors' input at another"]
      replaycfg["config/replay.ts<br/>coast window · tick"] --> replay
    end
    subgraph syn["Synthetic layer — 100% generated"]
      direction LR
      scenarios["config/scenarios.ts + scenarios/<br/>the registry: default · 02a · 02b · 03a · 03b, cast-only files, one row per entry · a study scenario's own run length<br/>ids.ts: the prioritization pair's cast ids, disjoint between 03a and 03b, so no first run answers the second by name<br/>cast.ts: nine builders over the three cast behaviors — threat · shuttle · silentMover · mover · hover · returning · silentHover · silentAt · silentOrbit"]
    cfg --> scenarios
    scenarios --> gen
    cfg["config/scenario.ts<br/>seed · envelope · launch points · the cast"] --> gen["lib/injects.ts<br/>planScenario → injectTracksAt(t)<br/>5 dealt behaviors · 3 cast behaviors, scripted · 3 Remote ID states · UA type"]
      gold[("lib/__fixtures__/injects-&lt;seed&gt;.json<br/>golden: same seed, same picture")]
    end
    ao["config/ao.ts<br/>AO: center · bbox · time zone · protected sites with their tier"]
    sites["lib/sites.ts<br/>the session's site set: protected sites and friendly launch areas<br/>add · update · remove · reset, stamped at sim time · the rules a site meets · the last protected site stays<br/>the site plan: JSON out, a pasted plan back in · restored from this browser's storage at load, held while the set differs from config"]
    model["lib/tracks.ts<br/>common Track model<br/>Cooperative / Non-cooperative / Unknown"]
    scorecfg["config/scoring.ts<br/>weights · curves · bands · ADS-B ceiling · operating hours · pattern numbers"]
    studycfg["config/study.ts<br/>Begin · the run's default length · the brief's blocks by run length, its goal and the run's place · the three questions with their ends · raw mode's association distance · the acceptance and audit numbers"]
    patterns["lib/patterns.ts<br/>loiter dwell · orbit · area revisit, over the position history<br/>positions only · the strongest is the factor · named past a threshold · the last leg under the floor dropped from the turn"]
    score["lib/scoring.ts<br/>six factors · identity memory · ADS-B ceiling · the friendly launch cap · closing on the projection's time to entry, complete inside the ring<br/>the site tier on the per-site value · the set as scored on the score<br/>per-factor breakdown retained · input type strips the answer key"]
    rank["lib/ranking.ts<br/>rank by composite, breakdown on the entry"]
    life["lib/lifecycle.ts<br/>§7.1 transition table + event log<br/>observed fields only — never the answer key<br/>band crossings, pattern changes, loss and return logged at sim time, statuses carried · re-surface read off the log<br/>the sites in force on every snapshot"]
    hand["lib/handoff.ts<br/>escalation summary as copyable text<br/>evidence block frozen at the escalate snapshot · the site line from the record · timeline live"]
    run["lib/run.ts<br/>the run JSON: subject · scenario · mode · run · build · began_at · events · answers<br/>the record's actions and the selections folded, t from Begin · track ids only — no position, no score, no name"]
    workcfg["config/contacts.ts + dispositions.ts<br/>recipients · outcome labels"]
    frames["config/airframes.ts<br/>emitter categories · type codes · kinematic envelope"]
    airframe["lib/airframe.ts<br/>classify: silhouette class + its basis<br/>type code → category → UA type → envelope"]
    replay --> model
    gen --> model
    gen -- trail instants --> replay
    ao --> gen
    ao --> score
    model --> score
    scorecfg --> score
    scorecfg --> patterns
    patterns --> score
    replay -- histories at t --> score
    replay -- origins: first sample, first frame --> score
    frames -- kinematic box --> score
    score --> rank
    recs -- the default's hour, for a caller without a clock --> rank
    model --> airframe
    frames --> airframe
    workcfg --> hand
    alertcfg["config/alerts.ts<br/>the triggers: warning · caution (off) · pattern · re-surface"]
    alerts["lib/alerts.ts<br/>a surface over the record: which entries earn a card, which clear one<br/>one pending card per track per kind · a tick raises, a seek replays · never a capped cooperative track"]
    alertcfg --> alerts
    life -- the log, entry by entry --> alerts
    life -- the record's actions --> run
    projcfg["config/projection.ts<br/>the horizon — the factor's entryZeroMin, one number"]
    proj["lib/projection.ts<br/>time to entry by dead reckoning: the observed position, track, and speed against every protected ring<br/>the soonest, its site named and tier carried · inside at zero · none past the horizon<br/>the entry point on the ring · the position's own age counted off, a coasting track captioned · entryAt: the one entry estimate the Closing factor scores and the Entry row prints (S3a)"]
    scorecfg -- entryZeroMin --> projcfg
    projcfg --> proj
    model --> proj
    proj -- the value on every snapshot --> life
    proj -- entryAt, per ring --> score
  end
  photos["data/photos.ts + usePhoto<br/>one photo per opened ADS-B track, by hex<br/>runtime lookup · session cache · fails soft to the silhouette"]
  fx -. fetched at startup .-> load
  gen --> goldgen
  goldgen -. pins .-> gold
  gen --> bench
  replay -- picture · memory · histories · origins at t --> bench
  score -- scoreTrack · bandOf --> bench
  studycfg --> study
  scenarios -- 02a · 02b through the feed --> study
  gen -- injectTracksAt, the feed over it --> study
  replay -- picture · memory · histories · origins at t --> study
  scenarios -- the run's scenario, planned on the recording's grid --> replaytool
  gen -- injectTracksAt, through associate at the run's mode --> replaytool
  replay -- pictureAt --> replaytool
  studycfg -- Begin · the run · raw's distance --> replaytool
  filesave["lib/download.ts<br/>one click, one file: the anchor attached before the click, the object URL revoked after it<br/>the end screen’s Download a copy and, at S6a-ii, the sheet’s own downloads"]
  runstore["lib/runs.ts<br/>a subject’s runs, kept in their own browser under their code and each run’s index (S6a-iii)<br/>fail-soft: a browser that will not keep a run says so on the end screen, and the run is still there to copy or download<br/>what Start run 2 chains from, what a reopened link resumes at, and what See your results draws<br/>every subject’s runs and only the run keys, for the sheet page’s Clear saved runs"]
  app -. a study run saves itself, and reads what this browser holds .-> runstore
  app -. one click, one file .-> filesave
  sheetpage["components/SheetPage.tsx + SheetDocument.tsx + data/sheet.ts<br/>?sheet (S6a-ii): a results file or two run files, dropped or pasted, read by the loader and drawn by the tool<br/>the study's recording fetched as the app fetches every recording — the CLI's loadStudy over the network<br/>the document downloaded, printed block by block — page 1 the comparison whole, no log line ever cut, a 6 mm page edge that keeps the browser’s header and footer off (S5g, #194) — and the runs handed back as files; nothing stored, nothing sent<br/>Clear saved runs asks once, in place, before it clears (S6a-iii-b)"]
  results["components/RunResults.tsx<br/>the subject's own two runs drawn as the subject sheet, in the tab they ran them in (S6a-iii)<br/>the sheet page's document by the sheet page's seam — subject and owner read the same sheet<br/>one primary, Download results: the file to hand over, and the words for what it holds"]
  sheetpage -. loaded on demand: a chunk of its own, never on the run's path .-> replaytool
  sheetpage -- documentOf · filesFor · the document and its actions --> results
  app -. loaded on the See your results click, in the sheet's chunk .-> results
  runstore -- both runs, once they are in this browser --> results
  spec -- the roles table: each cast's threats --> replaytool
  study -- loadRecording: the study's recording, read from disk by replay/files.ts --> replaytool
  score -- scoreTrack · bandOf --> study
  rank -- queueOrder --> study
  proj -- entryAt --> study
  rank -- queueOrder --> bench
  ao -- bbox --> cap
  norm -. normalize + rate-limit etiquette, at capture time .-> cap
  subgraph ui["UI — React + MapLibre; consumes the modules, never reimplements them"]
    direction TB
    app["App.tsx + data/useCapture.ts<br/>loads the recording the query names, once<br/>holds the inject plan · samples both layers and every history at the clock's t<br/>opens a track's log when it first appears · sim clock ticking from the recording's clock start"]
    queue["Queue — the Priority list on screen (#183)<br/>ranked list, the product · reason tag in plain English"]
    map["MapView + IdentityLegend + glyphs<br/>context · three shapes by what a track broadcast — an aircraft turned to its heading, a drone, the plain dot — rasterised as SDF images so paint colours them · breadcrumb trail behind the selected track, fading to its old end · its projected path to the ring, dashed, an arrowhead and the entry reading where it meets it · raw's heading tick, one screen length from the marker's edge<br/>the subject's own bookkeeping (S8, S9b): a track they have opened drawn in a grey from the click, label and tick with it, one they have escalated or dismissed drawn hollow at its own size — identical in both conditions, from their own clicks alone · a study run in Vigil spends one colour, warning on the whole marker, and no dim; the legend is the brief's there"]
    review["components/ReviewDrawer.tsx + TrackVisuals + ScoreBreakdown<br/>one track — observed or derived<br/>a study run: Escalate and Dismiss in one click and no Assess — opening marks — the source word on the header badge, no empty image area (S8)<br/>silhouette by class · photo, credited (ADS-B only) · selection synced with the map<br/>score opened to its factors, band-coloured · lifecycle actions · event log and handoff in sim time · trail count · time to entry"]
    clock["data/usePlayback.ts + Playback<br/>the replay clock: play · pause · seek, one second per tick · how it last moved<br/>a study run's window: held at Begin, ended at +6:00, never restarted<br/>scheduler injected, so no test waits on time"]
    panel["components/SitesPanel.tsx<br/>the Sites surface: protected sites and friendly launch areas as rows, the inline editor, placement armed on the map<br/>the site plan: copy out, load back · refused behind the record's frontier · a restored row reads stored"]
    copy["components/useCopy.ts<br/>copy with the clipboard, fall back to the textarea's selection<br/>'Copied' only for the text actually copied"]
    copy -- handoff --> review
    copy -- site plan --> panel
    stack["components/AlertStack.tsx<br/>the cards over the map, newest first · the face is Open — answers the card, opens its track · × clears it and moves nothing (#202)<br/>both refused behind the track's frontier"]
    app --> queue
    app --> map
    app -- cards · the clock's last move --> stack
    sound["components/useAlertTone.ts<br/>one audio element for the session, played once per raise batch · muted from the strip"]
    app -- a raise batch · mute --> sound
    app -- selected track: drawer --> review
    app -- site set · placing --> panel
    clock -- t --> app
  end
  model -- adsb + injects: map, strip --> app
  ao -- center · zoom · basemap: map, strip · default sites --> app
  sites -- session set: scorer, map, panel --> app
  cfg -- seed: strip --> app
  recs -- ?recording= selection · the default --> app
  scenarios -- ?scenario= name · on the first · off none · a run's length --> app
  studycfg -- ?mode=raw: the rule at 1 500 m, every derived reading hidden · a run: Begin · the window · the brief · the questions --> app
  run -- the run JSON: the end screen's Copy run --> app
  rank -- ranked + scores: queue chip, drawer, handoff, snapshot, map fill --> app
  life -- log · status · re-surface: drawer, state filter, row --> app
  proj -- time to entry for the selected track: drawer, map line --> app
  alerts -- the stack, folded from each track's new entries --> app
  workcfg -- pickers: drawer --> app
  hand -- handoff text --> review
  airframe -- class · basis: visuals --> review
  photos -. fetched on open .-> review
  tone -. fetched on the first raise .-> sound
```

---

## ⚠️ Guardrails (non-negotiable)

These are the rules this project is built under. They are not aspirational — they constrain every
PR, and `CLAUDE.md` carries them so the AI agent enforces them too.

- **Public or synthetic data only.** The real layer is ADS-B — broadcast in the clear by aircraft
  and freely rebroadcast by community aggregators. The threat layer is 100% generated. Nothing
  observed, recorded, or derived from any work system ever enters this repo.
- **Real aircraft are never the threat.** By design, any track sourced from ADS-B is treated as
  cooperative and receives low baseline priority. Only synthetic injects can score as threats.
  This is both an ethics rule and a product truth — broadcasting your position is the defining
  cooperative act. Vigil also never singles out specific individuals' aircraft: no VIP or
  celebrity tracking. Real tracks receive special attention only for assistance signals they
  broadcast themselves.
- **Public first principles only.** Design draws exclusively on open literature: CPA/TCPA
  geometry, published counter-UAS concepts, FAA Remote ID as public context. No proprietary or
  employer requirements, terminology, code, or documents. If a design question can only be
  answered from work knowledge, a different design gets picked.
- **Not an operational system.** Vigil is an **educational demonstration**. It is **not for
  operational use**, and it makes **no claims about real-world threat assessment**. Nothing here
  should be relied upon for safety-of-life or security decisions.
- **No simulated engagement.** Vigil never models jamming, takeover, or kinetic defeat. Its act
  step ends at assessment and notification — which is both the ethics posture and the watch
  floor's actual job under the current US domestic framework.
- **Public repo from day one.** Openness is the enforcement mechanism.

---

## Status

Phase 1 — frontend stub. See [`docs/mvp-scope.md`](docs/mvp-scope.md) for the full MVP scope,
the scoring model, the PR sequence, and the process contract.

## Stack

Vite · React · TypeScript · MapLibre GL · Vitest · ESLint · Prettier

Basemap: CARTO Dark Matter — © CARTO, © OpenStreetMap contributors — the attribution the map
itself draws.

## Commands

```bash
npm install       # install dependencies
npm run dev       # start the dev server
npm run build     # production build
npm run lint      # ESLint
npm run typecheck # tsc --noEmit
npm run test      # Vitest
npm run replay -- --study <dir>   # the study's metrics CSV from run JSON files (S5a); study/ by default
```

### The study's replay (S5)

A run JSON — what **Copy run** hands back at the end of a study run — goes in; the study's
numbers come out, offline, the scenario regenerated from its seed on the study recording's own
frame grid through the app's pure modules. `npm run replay -- <run.json> …` prints the CSV for
those runs; `npm run replay -- --study <dir> [--out <dir>]` writes `study.csv` for every `.json`
file in the directory under `study/` at the repo root, which is gitignored: the eight fixtures
under `tools/replay/__fixtures__/` — the corroboration pair's four and the prioritization pair's
four — are the only runs the repo holds. Wherever it takes a run file it also takes a **results
file** — one subject's two runs under one envelope, `{ subject, build, runs }`, which the loader
unwraps into its runs, the folder walk of `--study` included, so a subject hands over one file
instead of two (S6a-i). A file that is not a run is refused with its path and
the field. The bare form also writes each run's **frame** beside the CSV —
`<subject>-<scenario>-<mode>-<run>.svg`, the picture at the moment of escalation with every look
as a numbered hop on its path, each threat's trail and ring entry, and the analyst's
_never opened_ overlay, drawn identically in both conditions (S5b). A threat's own map label is
placed where the map leaves room — the first of eight spots around its dot that no mark, label or
line holds; if every spot is crossed by a line, the look path or the ring, the search runs again
without the line test — and it is drawn last, so a label with nowhere to go sits on top of what
crowds it rather than under it (#170). The threats are the bench's
roles table (`scripts/study-spec.ts`), one on 02a and 02b, two on 03a and 03b; a 03 run's CSV row
carries the attention numbers beside the standoff — the non-threats opened before any threat, each
threat's first open and standoff, the false escalations (tracks that never enter the ring, and any real aircraft) and the
escalations of later entrants on their own column, the order — and its frame freezes at the last
threat's escalation with one decision line per threat (S5c-i). A Vigil run's frame carries what
Vigil's screen showed and raw's did not (S5c-ii): the warm labels beside every above-calm
inject, the Priority list box under the map with every candidate's rank, composite, and reason tag, a
threat's Remote ID mismatch line where its score read one, the Entry row's estimate beside each
threat's dot, and after each threat look the caption's line of what Vigil read then — the app's
own readings through the engine, every element gated on the mode so no annotation reaches a raw
frame: the corroboration pair's raw frames are byte for byte as before. On the prioritization
pair each threat carries one map label per mode and the T0 range and entry clock move into the
caption, so its raw frames change by that alone. Exactly two run files also write **the pair**
(S5d-i) — `pair-<subject>-<scenario>.svg`, the two frames side by side, each Priority list box capped at
its top five rows, and under them the block: the attention counts for both conditions, then one
row per threat with the run's window as a shared time axis carrying each condition's first open
and escalation and the threat's ring entry, and the standoff band for that threat with one dot
per condition; a raw run reads _unaided_ there. The two runs share a scenario — the rows read
one cast — whatever their modes or subjects. `--study` writes **the study figure** beside the
CSV (S5d-ii), `study.svg`: by family, the prioritization pair first with attention as the
headline — the non-threats opened before the first threat on a count axis, each threat's first
open on the family's longest window, the standoff per threat — then the corroboration pair's
standoff axis, each with its counts per condition. Every axis carries an unaided lane above and a
Vigil lane below, one dot per run with the subject code beside it, crowded dots stacked outward
from the axis, a subject's two dots joined by a thin neutral line, a miss hollow at the inside
end and a never-opened threat hollow at its own run's window end. Two runs of **unlike**
scenarios of one family are the **subject sheet** (S5e) —
`sheet-<subject>-<scenarioA>-<scenarioB>.svg`, the counterbalanced pair the pilot collects, which
the pair refuses: the headline in sentences the tool writes from the metrics, two per condition,
with the counts as prose; the two frames side by side, unaided left; then one row per threat by
role — threat 1 each scenario's first entrant — with the pair's time lane, each lane carrying
its own entry and its own window end, and beside it the 5 km ring north up on an 8 km panel, each
condition's escalation plotted at its true bearing and range at the second of escalation, hollow
inside the ring, with that scenario's entry point a tick across the ring. Unlike families, two
runs of one scenario and two of one condition are refused in words. Every frame draws one
numbered marker per distinct track looked at, with a `×N` badge when the run came back to it.
A frame's path and markers carry **the whole run**, not the span up to the freeze (S5f): the
freeze stays where it is — the picture, the Priority list box and every reading are that second — and a
look after it is drawn as a dashed outline on a dashed path, the outline filled with the panel so
its numeral reads over nothing else; a late look the regenerated picture no longer holds is not
drawn, and the footnote's key says so. The subtitle gives both counts. Each frame's caption also
lists **every escalation the run made besides the threats** — the look it came off, the second,
the track as the run read it, and what it turned out to be: a track that never enters the ring,
one that enters after the window closed, or a real aircraft, cooperative traffic and never a
threat. The sheet accounts for the same escalations twice over: its headline counts them by
class — each condition opens with one tally line, the same fields in the same order (threats
escalated before the ring, the first threat escalation's clock, each threat's standoff in the
sentence's words or MISSED, early escalations, false alarms), and its headline sentence carries
them as a clause — _with nine early escalations and one false alarm_ — rather than listing
idents (S5h) — and beneath the threats' rows a third row names every one, a mark on the
same time axis per condition with what each turned out to be in words under it — absent when
neither condition escalated anything else, and never calling a due-later inbound a non-threat.
The caption is a **decision log** (S5g): one line per decision — open, assess, dismiss, escalate —
in the clock's order over the whole run, each tagged with the look it came off, and each fact said
once, so an open line no longer carries the escalation's clock and the escalation's own line
carries the standoff and the margin. A track is named once, the way the screen named it at the
freeze, with its role in words — and the frames' threat labels take that name, so a pair's two maps
call one track one thing; where a look's ident differed, the line says what it read then. A thin
rule labelled with the freeze's second crosses the log where the run kept working after it, a miss
is stated once beneath the log, and the overlay's count is the foot's own line. A threat's lines
and every escalation take the box's weight; the rest are muted. The ids the CSV and the metrics
carry are untouched. Every artifact the tool renders names a track the same way (S5h): the sheet's
row subtitle and the idents it resolves, and the pair's row title and order clause, all take that
run's name at its freeze, so a document and the frames on it never give a reader two names for one
track — where two conditions' screens genuinely differed, both are shown and said whose each is.
The study figure names no track at all, only subjects, scenarios and counts.

## How this repo is built

Every change ships through the same path: GitHub Issue with a mini-PRD → branch → PR → AI code
review → green CI → engineering review → iteration → squash-merge. The path is deliberate — it
is half the point of the project.
