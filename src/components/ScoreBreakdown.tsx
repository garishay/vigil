import { capLine, formatScore, scoreTotal } from '../lib/display'
import { FACTORS, type Score } from '../lib/scoring'

/**
 * The score, opened (§4.1, §7 — PR 04b): the composite with its band and the one-decimal total
 * it is made from, then one row per §6 factor — the plain-English label, a bar filled to the
 * contribution over the weight, the two numbers, and a detail line in observed terms — with the
 * §6 intent text as the row's hover. A capped track ends with the cap as its own line, the same
 * wording the handoff and the chip's hover use, so the ceiling is visible wherever the score is.
 *
 * Everything here is read off the `Score` the engine produced; nothing is recomputed, so the
 * drawer cannot disagree with the chip or the handoff. The band colour is the first warm colour
 * in the theme, and a score is the only thing that can earn it (§4.3).
 */
export function ScoreBreakdown({ score }: { score: Score }) {
  return (
    <section className="breakdown" aria-label="Score breakdown" data-band={score.band}>
      <header className="breakdown__header">
        <span className="breakdown__score">Score {formatScore(score)}</span>
        <span className="breakdown__band">{score.band}</span>
        <span className="breakdown__total">
          — {score.capped ? 'capped, ' : ''}
          {scoreTotal(score)}
        </span>
      </header>
      <ol className="breakdown__factors">
        {score.factors.map((factor) => (
          <li
            className="breakdown__factor"
            key={factor.id}
            title={FACTORS.find((f) => f.id === factor.id)?.intent}
          >
            <span className="breakdown__label">{factor.label}</span>
            <span
              className="breakdown__bar"
              role="meter"
              aria-label={`${factor.label} contribution`}
              aria-valuemin={0}
              aria-valuemax={factor.weight}
              aria-valuenow={Math.round(factor.contribution)}
            >
              <span
                className="breakdown__fill"
                style={{ width: `${(factor.contribution / factor.weight) * 100}%` }}
              />
            </span>
            <span className="breakdown__numbers">
              {Math.round(factor.contribution)} / {factor.weight}
            </span>
            <span className="breakdown__detail">{factor.detail}</span>
          </li>
        ))}
      </ol>
      {score.capped && <p className="breakdown__cap">{capLine(score)}</p>}
    </section>
  )
}
