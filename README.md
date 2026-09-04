# Vigil

**Explainable airspace triage for the PHL area.**

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
      cfg["config/scenario.ts<br/>seed · envelope · launch points"] --> gen["lib/injects.ts<br/>planScenario → injectTracksAt(t)<br/>5 behaviors · 3 Remote ID states · UA type"]
      gold[("lib/__fixtures__/injects-&lt;seed&gt;.json<br/>golden: same seed, same picture")]
    end
    ao["config/ao.ts<br/>AO: center · bbox · time zone · protected sites with their tier"]
    sites["lib/sites.ts<br/>the session's site set: protected sites and friendly launch areas<br/>add · update · remove · reset, stamped at sim time · the rules a site meets · the last protected site stays<br/>the site plan: JSON out, a pasted plan back in"]
    model["lib/tracks.ts<br/>common Track model<br/>Cooperative / Non-cooperative / Unknown"]
    scorecfg["config/scoring.ts<br/>weights · curves · bands · ADS-B ceiling · operating hours · pattern numbers"]
    patterns["lib/patterns.ts<br/>loiter dwell · orbit · area revisit, over the position history<br/>positions only · the strongest is the factor · named past a threshold"]
    score["lib/scoring.ts<br/>six factors · identity memory · ADS-B ceiling · the friendly launch cap · closing complete inside the ring<br/>the site tier on the per-site value · the set as scored on the score<br/>per-factor breakdown retained · input type strips the answer key"]
    rank["lib/ranking.ts<br/>rank by composite, breakdown on the entry"]
    life["lib/lifecycle.ts<br/>§7.1 transition table + event log<br/>observed fields only — never the answer key<br/>band crossings, pattern changes, loss and return logged at sim time, statuses carried · re-surface read off the log<br/>the sites in force on every snapshot"]
    hand["lib/handoff.ts<br/>escalation summary as copyable text<br/>evidence block frozen at the escalate snapshot · the site line from the record · timeline live"]
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
    model --> airframe
    frames --> airframe
    workcfg --> hand
  end
  photos["data/photos.ts + usePhoto<br/>one photo per opened ADS-B track, by hex<br/>runtime lookup · session cache · fails soft to the silhouette"]
  fx -. fetched at startup .-> load
  gen --> goldgen
  goldgen -. pins .-> gold
  ao -- bbox --> cap
  norm -. normalize + rate-limit etiquette, at capture time .-> cap
  subgraph ui["UI — React + MapLibre; consumes the modules, never reimplements them"]
    direction TB
    app["App.tsx + data/useCapture.ts<br/>loads the recording the query names, once<br/>holds the inject plan · samples both layers and every history at the clock's t<br/>opens a track's log when it first appears · sim clock ticking from the recording's clock start"]
    queue["Queue<br/>ranked list, the product · reason tag in plain English"]
    map["MapView + IdentityLegend<br/>context · breadcrumb trail behind the selected track"]
    review["components/ReviewDrawer.tsx + TrackVisuals + ScoreBreakdown<br/>one track — observed or derived<br/>silhouette by class · photo, credited (ADS-B only) · selection synced with the map<br/>score opened to its factors, band-coloured · lifecycle actions · event log and handoff in sim time · trail count"]
    clock["data/usePlayback.ts + Playback<br/>the replay clock: play · pause · seek, one second per tick<br/>scheduler injected, so no test waits on time"]
    panel["components/SitesPanel.tsx<br/>the Sites surface: protected sites and friendly launch areas as rows, the inline editor, placement armed on the map<br/>the site plan: copy out, load back · refused behind the record's frontier"]
    copy["components/useCopy.ts<br/>copy with the clipboard, fall back to the textarea's selection<br/>'Copied' only for the text actually copied"]
    copy -- handoff --> review
    copy -- site plan --> panel
    app --> queue
    app --> map
    app -- selected track: drawer --> review
    app -- site set · placing --> panel
    clock -- t --> app
  end
  model -- adsb + injects: map, strip --> app
  ao -- center · zoom · basemap: map, strip · default sites --> app
  sites -- session set: scorer, map, panel --> app
  cfg -- seed: strip --> app
  rank -- ranked + scores: queue chip, drawer, handoff, snapshot --> app
  life -- log · status · re-surface: drawer, state filter, row --> app
  workcfg -- pickers: drawer --> app
  hand -- handoff text --> review
  airframe -- class · basis: visuals --> review
  photos -. fetched on open .-> review
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

## Commands

```bash
npm install       # install dependencies
npm run dev       # start the dev server
npm run build     # production build
npm run lint      # ESLint
npm run typecheck # tsc --noEmit
npm run test      # Vitest
```

## How this repo is built

Every change ships through the same path: GitHub Issue with a mini-PRD → branch → PR → AI code
review → green CI → engineering review → iteration → squash-merge. The path is deliberate — it
is half the point of the project.
