interface LandingProps {
  onOpenDemo: () => void;
  onReviewLabel: () => void;
}

export function Landing({ onOpenDemo, onReviewLabel }: LandingProps) {
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
            <button type="button" className="button button--secondary" onClick={onOpenDemo}>
              Open guided demo
            </button>
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

      <section className="principles" aria-labelledby="principles-heading">
        <div>
          <p className="eyebrow">A conservative workflow</p>
          <h2 id="principles-heading">Automation finds the questions. You make the call.</h2>
        </div>
        <div className="principles__grid">
          <article>
            <span className="principles__number">01</span>
            <h3>Compare the facts</h3>
            <p>Brand, class, ABV, proof, volume, producer, origin, and statutory warning checks are explicit.</p>
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
