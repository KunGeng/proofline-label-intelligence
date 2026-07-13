import { useEffect, useRef, useState } from 'react';
import { fieldLabel } from '../domain/validation';
import type {
  Candidate,
  FieldKey,
  LabelExtraction,
  ReviewState,
  VerificationResult,
} from '../domain/types';
import {
  ScopeNotice,
  SectionCard,
  SourceChip,
  StatusBadge,
  statusLabel,
} from './ui';

export type CandidateField = keyof LabelExtraction;
export type ReviewDeskPhase = 'processing' | 'error' | 'ready';

const isCandidateField = (field: FieldKey): field is CandidateField =>
  field !== 'warningTypography' && field !== 'abvProofConsistency';

interface ReviewDeskProps {
  title: string;
  extraction: LabelExtraction;
  result?: VerificationResult;
  phase: ReviewDeskPhase;
  rawText: string;
  imageUrl?: string;
  disclosure?: string;
  error?: string;
  progress?: number;
  durationMs?: number;
  isGuidedDemo: boolean;
  warningTypographyConfirmed: boolean;
  onWarningTypographyConfirmed: (confirmed: boolean) => void;
  onCorrectCandidate: (field: CandidateField, value: string) => void;
  onStartAnother: () => void;
}

const candidateFor = (
  field: FieldKey,
  extraction: LabelExtraction,
): Candidate | undefined =>
  isCandidateField(field) ? extraction[field] : undefined;

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

const decisionTitleFor = (state: ReviewState): string =>
  state === 'match' ? 'No discrepancies detected' : statusLabel(state);

const taskTargetFor = (field: FieldKey): string =>
  field === 'warningTypography' ? '#typography-confirmation' : '#field-comparison';

const confidenceText = (candidate: Candidate): string =>
  candidate.source === 'agent'
    ? 'Human-verified'
    : `${Math.round(candidate.confidence * 100)}% confidence`;

const extractionTimeText = (durationMs: number): string =>
  `Local OCR finished in ${(durationMs / 1000).toFixed(1)} s on this device.`;

const correctionIdFor = (field: CandidateField): string => `correction-${field}`;
const correctionErrorIdFor = (field: CandidateField): string =>
  `${correctionIdFor(field)}-error`;

export function ReviewDesk({
  title,
  extraction,
  result,
  phase,
  rawText,
  imageUrl,
  disclosure,
  error,
  progress,
  durationMs,
  isGuidedDemo,
  warningTypographyConfirmed,
  onWarningTypographyConfirmed,
  onCorrectCandidate,
  onStartAnother,
}: ReviewDeskProps) {
  const [editingField, setEditingField] = useState<CandidateField>();
  const [correction, setCorrection] = useState('');
  const [correctionError, setCorrectionError] = useState<string>();
  const [restoreFocusField, setRestoreFocusField] = useState<CandidateField>();
  const correctionInputRef = useRef<HTMLInputElement>(null);
  const correctionTriggerRefs = useRef<
    Partial<Record<CandidateField, HTMLButtonElement | null>>
  >({});
  const warningTypography = result?.fields.find(
    (field) => field.field === 'warningTypography',
  );
  const outstandingFields = result?.fields.filter(
    (field) => field.state !== 'match',
  ) ?? [];

  useEffect(() => {
    if (editingField) {
      correctionInputRef.current?.focus();
      return;
    }

    if (restoreFocusField) {
      correctionTriggerRefs.current[restoreFocusField]?.focus();
      setRestoreFocusField(undefined);
    }
  }, [editingField, restoreFocusField]);

  const openCandidateEntry = (
    field: CandidateField,
    candidate?: Candidate,
  ): void => {
    setRestoreFocusField(undefined);
    setEditingField(field);
    setCorrection(candidate?.value ?? '');
    setCorrectionError(undefined);
  };

  const closeCorrection = (field: CandidateField): void => {
    setRestoreFocusField(field);
    setEditingField(undefined);
    setCorrection('');
    setCorrectionError(undefined);
  };

  const saveCorrection = (field: CandidateField, isNewCandidate: boolean): void => {
    if (!correction.trim()) {
      setCorrectionError(
        isNewCandidate
          ? 'Enter a value before saving.'
          : 'Enter a corrected value before saving.',
      );
      return;
    }

    onCorrectCandidate(field, correction.trim());
    closeCorrection(field);
  };

  const correctionForm = (
    field: CandidateField,
    candidate: Candidate | undefined,
  ) => {
    const isNewCandidate = !candidate;
    const label = fieldLabel(field);

    return (
      <div
        className="correction-form"
        id={correctionIdFor(field)}
        role="region"
        aria-label={`${label} ${isNewCandidate ? 'candidate entry' : 'correction'}`}
      >
        <label>
          {isNewCandidate ? `${label} agent-entered candidate` : `${label} corrected candidate`}
          <input
            ref={correctionInputRef}
            value={correction}
            onChange={(event) => {
              setCorrection(event.target.value);
              setCorrectionError(undefined);
            }}
            aria-invalid={correctionError ? true : undefined}
            aria-describedby={
              correctionError ? correctionErrorIdFor(field) : undefined
            }
          />
        </label>
        {correctionError ? (
          <p
            className="inline-error correction-form__error"
            id={correctionErrorIdFor(field)}
            role="alert"
          >
            {correctionError}
          </p>
        ) : null}
        <div>
          <button
            className="text-button"
            type="button"
            onClick={() => saveCorrection(field, isNewCandidate)}
          >
            Save {label} {isNewCandidate ? 'candidate' : 'correction'}
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => closeCorrection(field)}
          >
            {isNewCandidate ? 'Cancel candidate entry' : 'Cancel correction'}
          </button>
        </div>
      </div>
    );
  };

  const progressPercent = typeof progress === 'number'
    ? Math.round(Math.max(0, Math.min(1, progress)) * 100)
    : undefined;

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

      <ScopeNotice />

      {phase === 'processing' ? (
        <section
          className="review-state review-state--processing"
          role="status"
          aria-label="Label extraction progress"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="eyebrow">Reading local evidence</p>
          <h2>Extracting label evidence</h2>
          <p>
            Proofline is reading this label locally. Findings and visual-confirmation
            controls will appear only after extraction finishes.
          </p>
          {progressPercent !== undefined ? (
            <div
              className="processing-note"
              role="progressbar"
              aria-label="OCR evidence extraction"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
              aria-valuetext={`${progressPercent}% complete`}
            >
              <span className="processing-note__bar" aria-hidden="true">
                <span style={{ width: `${progressPercent}%` }} />
              </span>
              <p>Reading label evidence… {progressPercent}%</p>
            </div>
          ) : null}
          <p className="review-state__loading-note">Preparing comparison workspace…</p>
          <div className="review-skeletons" aria-hidden="true">
            <div className="review-skeleton review-skeleton--evidence" />
            <div className="review-skeleton review-skeleton--comparison" />
          </div>
        </section>
      ) : null}

      {phase === 'error' ? (
        <section className="review-state review-state--error" role="alert">
          <p className="eyebrow">Extraction needs attention</p>
          <h2>Label evidence could not be extracted.</h2>
          <p>
            {error ?? 'Try a clearer image or begin a new evidence review.'}
          </p>
          <button type="button" className="button button--secondary" onClick={onStartAnother}>
            Choose another label
          </button>
        </section>
      ) : null}

      {phase !== 'ready' || !result ? null : (
        <>

      <section className={`decision decision--${result.overallState}`} aria-live="polite">
        <div>
          <p className="eyebrow">Comparison result</p>
          <h2>{decisionTitleFor(result.overallState)}</h2>
          <p>{summaryFor(result.overallState)}</p>
          {durationMs !== undefined ? (
            <p className="muted decision__timing">{extractionTimeText(durationMs)}</p>
          ) : null}
        </div>
        <StatusBadge state={result.overallState} />
      </section>

      <section className="review-next" aria-labelledby="review-next-heading">
        <div>
          <p className="eyebrow">
            {isGuidedDemo ? 'Guided demo' : 'Next reviewer action'}
          </p>
          <h2 id="review-next-heading">
            {isGuidedDemo
              ? 'A quick way through this sample'
              : 'Next reviewer actions'}
          </h2>
        </div>
        {isGuidedDemo ? (
          <ol>
            <li>
              <a href="#raw-evidence">Inspect the raw OCR</a> to see the text this sample
              preserves as evidence.
            </li>
            <li>
              <a href="#field-comparison">Inspect the field comparison</a> to compare the
              application record with each label candidate.
            </li>
            <li>
              <a href="#typography-confirmation">Complete the visual typography check</a> on
              the label image. OCR cannot make that confirmation.
            </li>
          </ol>
        ) : outstandingFields.length ? (
          <ol>
            {outstandingFields.map((field) => (
              <li key={field.field}>
                <a href={taskTargetFor(field.field)}>
                  Review {fieldLabel(field.field)}
                </a>
                : {field.reason}
              </li>
            ))}
          </ol>
        ) : (
          <ol>
            <li>
              <a href="#field-comparison">Review the field comparison</a>, then record an
              agent decision. A clean comparison is not approval.
            </li>
          </ol>
        )}
      </section>

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
            <details className="raw-text" id="raw-evidence">
              <summary>View complete extracted text</summary>
              <pre>{rawText || 'No readable text was extracted from this label.'}</pre>
            </details>
          </SectionCard>

          <div id="typography-confirmation">
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
          </div>
        </aside>

        <div id="field-comparison">
          <SectionCard
            title="Field comparison"
            eyebrow="Application ↔ label"
            className="comparison-card"
          >
            <div className="comparison-card__intro">
              <p>
                Correct a candidate only when you can verify it on the image. Original OCR evidence remains visible.
              </p>
              <p className="muted">Status precedence: mismatch → unreadable → needs review → match.</p>
            </div>
            <div
              className="comparison-table-wrap"
              role="region"
              aria-label="Field comparison table. Scroll horizontally to review all columns."
              tabIndex={0}
            >
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
                    const candidateField = isCandidateField(fieldResult.field)
                      ? fieldResult.field
                      : undefined;
                    const isEditing = candidateField !== undefined && editingField === candidateField;
                    const label = fieldLabel(fieldResult.field);

                    return (
                      <tr key={fieldResult.field}>
                        <th scope="row">{label}</th>
                        <td><span className="table-value">{fieldResult.expected}</span></td>
                        <td>
                          {candidate ? (
                            <div className="candidate-evidence">
                              <span className="table-value">{candidate.value}</span>
                              <div className="candidate-evidence__meta">
                                <SourceChip source={candidate.source} />
                                <span>{confidenceText(candidate)}</span>
                              </div>
                              <p className="raw-evidence">
                                Raw OCR: {candidate.rawText || 'No raw OCR candidate was extracted.'}
                              </p>
                              {candidateField ? (
                                <>
                                  <button
                                    ref={(element) => {
                                      correctionTriggerRefs.current[candidateField] = element;
                                    }}
                                    className="text-button"
                                    type="button"
                                    aria-expanded={isEditing}
                                    aria-controls={
                                      isEditing ? correctionIdFor(candidateField) : undefined
                                    }
                                    onClick={() => {
                                      if (isEditing) {
                                        closeCorrection(candidateField);
                                        return;
                                      }

                                      openCandidateEntry(candidateField, candidate);
                                    }}
                                  >
                                    {isEditing
                                      ? `Close ${label} correction`
                                      : `Correct ${label} candidate`}
                                  </button>
                                  {isEditing ? correctionForm(candidateField, candidate) : null}
                                </>
                              ) : null}
                            </div>
                          ) : candidateField ? (
                            <div className="candidate-evidence">
                              <span className="muted">No extracted candidate</span>
                              <button
                                ref={(element) => {
                                  correctionTriggerRefs.current[candidateField] = element;
                                }}
                                className="text-button"
                                type="button"
                                aria-expanded={isEditing}
                                aria-controls={
                                  isEditing ? correctionIdFor(candidateField) : undefined
                                }
                                onClick={() => {
                                  if (isEditing) {
                                    closeCorrection(candidateField);
                                    return;
                                  }

                                  openCandidateEntry(candidateField);
                                }}
                              >
                                {isEditing ? `Close ${label} candidate entry` : `Add ${label} candidate`}
                              </button>
                              {isEditing ? correctionForm(candidateField, undefined) : null}
                            </div>
                          ) : fieldResult.field === 'abvProofConsistency' ? (
                            <span className="muted">Derived from extracted ABV and proof candidates.</span>
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
      </div>
        </>
      )}
    </section>
  );
}
