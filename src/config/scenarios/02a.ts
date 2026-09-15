/**
 * Study scenario 02a (S3b, #135, ruled): cast-only, one row per entry, T0 = 480 s on recording
 * 002. The threat appears on the first tick after Begin, lying from its first frame; every decoy
 * is unambiguously false — no decoy enters the ring inside the run (480–840 s), the hovers sit at
 * 9.0 km or beyond, the far silents at 13 km or beyond, and the one closing drone meets the ring
 * at 934 s, after the run, reading caution throughout it. Rows are numbered from `inject-11`.
 */

import { SCENARIO, type ScenarioConfig } from '../scenario.ts'
import { at, hover, mover, returning, shuttle, silentMover, threat } from './cast.ts'

export const SCENARIO_02A: ScenarioConfig = {
  ...SCENARIO,
  seed: 'study-02a',
  minInjects: 0,
  maxInjects: 0,
  cast: [
    threat(at(245, 7.2), 65, at(240, 3.0), { startS: 481 }), // 11 · 35 kt to the circle at 240° / 3.0 km; first frame 481, enters the ring at 604
    shuttle(at(155, 7.5), 245, 1000, 15), // 12 · silent, 1 km tangential legs — the one pattern, revisit
    silentMover(at(60, 5.2), 150, 8), // 13 · the low-and-slow, silent, tangential
    silentMover(at(300, 13.0), 300, 15), // 14 · far silent, outbound
    silentMover(at(20, 14.0), 110, 12), // 15 · far silent, tangential
    silentMover(at(200, 15.0), 200, 20), // 16 · far silent, outbound
    returning(at(200, 6.0), at(200, 5.6), 510), // 17 · returning to its pad from 510 s
    returning(at(320, 6.2), at(320, 5.7), 630), // 18 · from 630 s
    returning(at(80, 5.9), at(80, 5.5), 750), // 19 · from 750 s
    hover(at(10, 9.0)), // 20 · fifteen hovers, 9.0–12.0 km, every quadrant
    hover(at(35, 9.6)), // 21
    hover(at(55, 10.4)), // 22
    hover(at(85, 11.2)), // 23
    hover(at(110, 9.3)), // 24
    hover(at(130, 12.0)), // 25
    hover(at(165, 9.9)), // 26
    hover(at(190, 10.8)), // 27
    hover(at(215, 9.2)), // 28
    hover(at(235, 11.5)), // 29
    hover(at(265, 9.7)), // 30
    hover(at(290, 10.2)), // 31
    hover(at(315, 11.9)), // 32
    hover(at(335, 9.4)), // 33
    hover(at(350, 10.6)), // 34
    mover(at(270, 5.5), 0, 15), // 35 · tangential
    mover(at(120, 7.0), 120, 20), // 36 · outbound
    mover(at(46.4, 8.85), 246.2, 9), // 37 · the closing drone: 6.8 km at T0 on a course with CPA 3.0 km, the ring at 934 s — after the run — caution throughout it
    mover(at(180, 6.5), 90, 18), // 38 · tangential
    mover(at(325, 8.0), 325, 16), // 39 · outbound
    mover(at(95, 5.2), 5, 20), // 40 · tangential
  ],
}
