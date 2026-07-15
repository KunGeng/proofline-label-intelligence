import { useState } from 'react';
import { demoCases } from '../features/demo/cases';
import type { DemoCaseId } from '../features/extraction/types';

interface LandingProps {
  onOpenDemoCase: (id: DemoCaseId) => void;
  onReviewLabel: () => void;
  onReviewBatch: () => void;
  onOpenBenchmark: () => void;
}

export function Landing({
  onOpenDemoCase,
  onReviewLabel,
  onReviewBatch,
  onOpenBenchmark,
}: LandingProps) {
  const [showScenarios, setShowScenarios] = useState(false);

  return (
    <>
      <section className="hero" aria-labelledby="proofline-heading">
        <div className="hero__copy">
          <p className="eyebrow">Compliance review, made inspectable</p>
          <h1 id="proofline-heading">Review labels with evidence, not guesswork.</h1>
          <p className="hero__lede">
            Proofline compares declared facts with label evidence, explains every finding,
            and keeps the final decision with the reviewer.
          </p>
          <div className="hero__actions">
            <button type="button" className="button button--primary" onClick={onReviewLabel}>
              Review a label
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => onOpenDemoCase('clear')}
            >
              Open guided demo
            </button>
            <button type="button" className="button button--secondary" onClick={onReviewBatch}>
              Review a batch
            </button>
          </div>
          <div className="scenario-library">
            <button
              type="button"
              className="scenario-library__toggle"
              aria-expanded={showScenarios}
              aria-controls="guided-scenarios"
              onClick={() => setShowScenarios((open) => !open)}
            >
              Explore scenarios
            </button>
            {showScenarios ? (
              <div className="scenario-library__content" id="guided-scenarios">
                <p>Each example uses disclosed precomputed evidence; no scenario runs live OCR.</p>
                <div className="scenario-library__list">
                  {demoCases.map((demoCase) => (
                    <button
                      key={demoCase.id}
                      type="button"
                      className="scenario-library__case"
                      onClick={() => onOpenDemoCase(demoCase.id)}
                    >
                      <span>{demoCase.title}</span>
                      <small>{demoCase.outcome}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <p className="hero__privacy">No uploads leave this browser session.</p>
        </div>
        <aside className="hero__signal" aria-label="Review principles">
          <p className="eyebrow">Evidence trail</p>
          <ol>
            <li><span>01</span> Submitted application facts</li>
            <li><span>02</span> Extracted label candidates</li>
            <li><span>03</span> Agent-confirmed outcome</li>
          </ol>
          <p>Every status carries a reason, confidence signal, and visible source.</p>
        </aside>
      </section>

      <section className="benchmark-callout" aria-labelledby="benchmark-callout-heading">
        <div>
          <p className="eyebrow">On-device timing</p>
          <h2 id="benchmark-callout-heading">Measure this browser when you choose.</h2>
          <p>
            Run the shipped label sample twice to inspect this device’s first sample run and
            second warm-worker run. Results stay in this browser session and are not saved.
          </p>
        </div>
        <button type="button" className="button button--secondary" onClick={onOpenBenchmark}>
          Run local sample benchmark
        </button>
      </section>

      <section className="principles" aria-labelledby="principles-heading">
        <div>
          <p className="eyebrow">A conservative workflow</p>
          <h2 id="principles-heading">Automation finds the questions. You make the call.</h2>
        </div>
        <div className="principles__grid">
          <article>
            <span className="principles__number">01</span>
            <h3>Compare the facts</h3>
            <p>Brand, class, ABV and, for distilled spirits, proof. Volume, producer, origin, and statutory warning checks are explicit.</p>
          </article>
          <article>
            <span className="principles__number">02</span>
            <h3>Inspect the evidence</h3>
            <p>Raw OCR, confidence, and source labels make uncertainty visible instead of hiding it.</p>
          </article>
          <article>
            <span className="principles__number">03</span>
            <h3>Retain agency</h3>
            <p>Typography and corrections require reviewer action. A clear comparison is never an approval.</p>
          </article>
        </div>
      </section>
    </>
  );
}
