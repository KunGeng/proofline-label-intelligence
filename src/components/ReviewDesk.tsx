import { useState } from 'react';
import { fieldLabel } from '../domain/validation';
import type {
  Candidate,
  FieldKey,
  LabelExtraction,
  ReviewState,
  VerificationResult,
} from '../domain/types';
import { SectionCard, SourceChip, StatusBadge, statusLabel } from './ui';

export type CandidateField = keyof LabelExtraction;

interface ReviewDeskProps {
  title: string;
  extraction: LabelExtraction;
  result: VerificationResult;
  rawText: string;
  imageUrl?: string;
  disclosure?: string;
  error?: string;
  progress?: number;
  warningTypographyConfirmed: boolean;
  onWarningTypographyConfirmed: (confirmed: boolean) => void;
  onCorrectCandidate: (field: CandidateField, value: string) => void;
  onStartAnother: () => void;
}

const candidateFor = (
  field: FieldKey,
  extraction: LabelExtraction,
): Candidate | undefined =>
  field === 'warningTypography'
    ? undefined
    : extraction[field as CandidateField];

const summaryFor = (state: ReviewState): string => {
  switch (state) {
    case 'match':
      return 'No discrepancies detected — agent approval required.';
    case 'mismatch':
      return 'A high-confidence discrepancy needs attention before the review can continue.';
    case 'unreadable':
      return 'One or more required label values are unreadable. Inspect the image or provide clearer evidence.';
    case 'needs_review':
      return 'Evidence is available, but an agent review is still required.';
  }
};

const confidenceText = (confidence: number): string =>
  `${Math.round(confidence * 100)}% confidence`;

export function ReviewDesk({
  title,
  extraction,
  result,
  rawText,
  imageUrl,
  disclosure,
  error,
  progress,
  warningTypographyConfirmed,
  onWarningTypographyConfirmed,
  onCorrectCandidate,
  onStartAnother,
}: ReviewDeskProps) {
  const [editingField, setEditingField] = useState<CandidateField>();
  const [correction, setCorrection] = useState('');
  const warningTypography = result.fields.find(
    (field) => field.field === 'warningTypography',
  );

  const openCorrection = (field: CandidateField, candidate: Candidate): void => {
    setEditingField(field);
    setCorrection(candidate.value);
  };

  const saveCorrection = (field: CandidateField): void => {
    if (!correction.trim()) {
      return;
    }

    onCorrectCandidate(field, correction.trim());
    setEditingField(undefined);
  };

  return (
    <section className="review-desk" aria-labelledby="review-heading">
      <div className="review-desk__intro">
        <div>
          <p className="eyebrow">Single-label evidence review</p>
          <h1 id="review-heading">{title}</h1>
          {disclosure ? <p className="disclosure">{disclosure}</p> : null}
        </div>
        <button type="button" className="button button--secondary" onClick={onStartAnother}>
          Review another label
        </button>
      </div>

      <section className={`decision decision--${result.overallState}`} aria-live="polite">
        <div>
          <p className="eyebrow">Comparison result</p>
          <h2>{statusLabel(result.overallState)}</h2>
          <p>{summaryFor(result.overallState)}</p>
        </div>
        <StatusBadge state={result.overallState} />
      </section>

      {typeof progress === 'number' ? (
        <section className="processing-note" aria-live="polite">
          <span className="processing-note__bar" aria-hidden="true">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
          <p>Reading label evidence… {Math.round(progress * 100)}%</p>
        </section>
      ) : null}

      {error ? <p className="inline-error" role="alert">{error}</p> : null}

      <div className="review-desk__grid">
        <aside className="evidence-column" aria-label="Label evidence">
          <SectionCard title="Label evidence" eyebrow="What the label shows">
            {imageUrl ? (
              <figure className="label-preview">
                <img src={imageUrl} alt={`Label preview: ${title}`} />
                <figcaption>Evidence stays attached to this review for the current browser session.</figcaption>
              </figure>
            ) : (
              <p className="muted">No preview is available for this label.</p>
            )}
            <details className="raw-text">
              <summary>View complete extracted text</summary>
              <pre>{rawText || 'No readable text was extracted from this label.'}</pre>
            </details>
          </SectionCard>

          <SectionCard title="Required visual confirmation" eyebrow="Agent check">
            <p className="section-copy">
              OCR can read the wording, but it cannot verify the warning heading’s presentation.
            </p>
            <label className="checkbox-field checkbox-field--confirmation">
              <input
                type="checkbox"
                checked={warningTypographyConfirmed}
                onChange={(event) => onWarningTypographyConfirmed(event.target.checked)}
              />
              <span>I visually confirmed the warning heading is uppercase and bold.</span>
            </label>
            {warningTypography ? (
              <div className="confirmation-status">
                <StatusBadge state={warningTypography.state} />
                <p>{warningTypography.reason}</p>
              </div>
            ) : null}
          </SectionCard>
        </aside>

        <SectionCard title="Field comparison" eyebrow="Application ↔ label" className="comparison-card">
          <div className="comparison-card__intro">
            <p>
              Correct a candidate only when you can verify it on the image. Original OCR evidence remains visible.
            </p>
            <p className="muted">Status precedence: mismatch → unreadable → needs review → match.</p>
          </div>
          <div className="comparison-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Application</th>
                  <th scope="col">Label candidate &amp; evidence</th>
                  <th scope="col">Finding</th>
                </tr>
              </thead>
              <tbody>
                {result.fields.map((fieldResult) => {
                  const candidate = candidateFor(fieldResult.field, extraction);
                  const candidateField = fieldResult.field as CandidateField;
                  const isEditing = editingField === candidateField;

                  return (
                    <tr key={fieldResult.field}>
                      <th scope="row">{fieldLabel(fieldResult.field)}</th>
                      <td><span className="table-value">{fieldResult.expected}</span></td>
                      <td>
                        {candidate ? (
                          <div className="candidate-evidence">
                            <span className="table-value">{candidate.value}</span>
                            <div className="candidate-evidence__meta">
                              <SourceChip source={candidate.source} />
                              <span>{confidenceText(candidate.confidence)}</span>
                            </div>
                            <p className="raw-evidence">Raw OCR: {candidate.rawText}</p>
                            {isEditing ? (
                              <div className="correction-form">
                                <label>
                                  {fieldLabel(fieldResult.field)} corrected candidate
                                  <input
                                    value={correction}
                                    onChange={(event) => setCorrection(event.target.value)}
                                  />
                                </label>
                                <div>
                                  <button
                                    className="text-button"
                                    type="button"
                                    onClick={() => saveCorrection(candidateField)}
                                  >
                                    Save {fieldLabel(fieldResult.field)} correction
                                  </button>
                                  <button
                                    className="text-button"
                                    type="button"
                                    onClick={() => setEditingField(undefined)}
                                  >
                                    Cancel correction
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                className="text-button"
                                type="button"
                                onClick={() => openCorrection(candidateField, candidate)}
                              >
                                Correct {fieldLabel(fieldResult.field)} candidate
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="muted">No extracted candidate</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge state={fieldResult.state} />
                        <p className="finding-reason">{fieldResult.reason}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </section>
  );
}
