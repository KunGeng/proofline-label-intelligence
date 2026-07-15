import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fieldLabel } from '../domain/validation';
import type {
  Candidate,
  FieldKey,
  LabelExtraction,
  ReviewState,
  VerificationResult,
} from '../domain/types';
import { evidenceFields } from '../features/review/manualEvidence';
import {
  ScopeNotice,
  SectionCard,
  SourceChip,
  StatusBadge,
  statusLabel,
} from './ui';
import { EvidenceImageViewer } from './EvidenceImageViewer';

export type CandidateField = keyof LabelExtraction;
export type ReviewDeskPhase = 'processing' | 'error' | 'ready';

const isCandidateField = (field: FieldKey): field is CandidateField =>
  field !== 'alcoholContentRequirement' &&
  field !== 'warningUppercase' &&
  field !== 'warningBold' &&
  field !== 'warningLegibility' &&
  field !== 'abvProofConsistency';

interface ReviewDeskProps {
  title: string;
  extraction: LabelExtraction;
  result?: VerificationResult;
  phase: ReviewDeskPhase;
  rawText: string;
  imageUrl?: string;
  imageClassName?: string;
  evidencePreview?: ReactNode;
  visualEvidenceAvailable?: boolean;
  onVisualEvidenceAvailabilityChange?: (available: boolean) => void;
  disclosure?: string;
  error?: string;
  progress?: number;
  durationMs?: number;
  isGuidedDemo: boolean;
  shouldFocusReviewHeading?: boolean;
  shouldFocusManualDisclosure: boolean;
  manualEvidence?: boolean;
  onRetryOcr?: () => void;
  warningUppercaseConfirmed: boolean;
  onWarningUppercaseConfirmed: (confirmed: boolean) => void;
  warningBoldConfirmed: boolean;
  onWarningBoldConfirmed: (confirmed: boolean) => void;
  warningLegibilityConfirmed: boolean;
  onWarningLegibilityConfirmed: (confirmed: boolean) => void;
  onCorrectCandidate: (field: CandidateField, value: string) => void;
  onClearCandidate?: (field: CandidateField) => void;
  exitLabel?: string;
  onExit: () => void;
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
  field === 'warningUppercase'
    ? '#uppercase-confirmation'
    : field === 'warningBold'
      ? '#bold-confirmation'
      : field === 'warningLegibility'
        ? '#legibility-confirmation'
        : '#field-comparison';

const confidenceText = (candidate: Candidate): string =>
  candidate.source === 'agent'
    ? 'Human-verified'
    : `${Math.round(candidate.confidence * 100)}% confidence`;

const rawEvidenceLabel = (candidate: Candidate, isGuidedDemo: boolean): string => {
  if (isGuidedDemo || candidate.source === 'fixture') {
    return 'Fixture text';
  }

  return 'Raw OCR';
};

const emptyRawEvidenceText = (candidate: Candidate, isGuidedDemo: boolean): string =>
  rawEvidenceLabel(candidate, isGuidedDemo) === 'Fixture text'
    ? 'No fixture text was supplied for this candidate.'
    : 'No raw OCR candidate was extracted.';

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
  imageClassName,
  evidencePreview,
  visualEvidenceAvailable = false,
  onVisualEvidenceAvailabilityChange,
  disclosure,
  error,
  progress,
  durationMs,
  isGuidedDemo,
  shouldFocusReviewHeading,
  shouldFocusManualDisclosure,
  manualEvidence,
  onRetryOcr,
  warningUppercaseConfirmed,
  onWarningUppercaseConfirmed,
  warningBoldConfirmed,
  onWarningBoldConfirmed,
  warningLegibilityConfirmed,
  onWarningLegibilityConfirmed,
  onCorrectCandidate,
  onClearCandidate,
  exitLabel,
  onExit,
}: ReviewDeskProps) {
  const [editingField, setEditingField] = useState<CandidateField>();
  const [correction, setCorrection] = useState('');
  const [correctionError, setCorrectionError] = useState<string>();
  const [restoreFocusField, setRestoreFocusField] = useState<CandidateField>();
  const correctionInputRef = useRef<HTMLInputElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const manualDisclosureRef = useRef<HTMLParagraphElement>(null);
  const correctionTriggerRefs = useRef<
    Partial<Record<CandidateField, HTMLButtonElement | null>>
  >({});
  const hasVisualEvidenceSource = Boolean(imageUrl || evidencePreview);
  const warningUppercase = result?.fields.find(
    (field) => field.field === 'warningUppercase',
  );
  const warningBold = result?.fields.find(
    (field) => field.field === 'warningBold',
  );
  const warningLegibility = result?.fields.find(
    (field) => field.field === 'warningLegibility',
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

  useEffect(() => {
    if (shouldFocusReviewHeading) {
      reviewHeadingRef.current?.focus();
    }
  }, [shouldFocusReviewHeading]);

  useEffect(() => {
    if (shouldFocusManualDisclosure) {
      manualDisclosureRef.current?.focus();
    }
  }, [shouldFocusManualDisclosure]);

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

  const removeCandidate = (field: CandidateField): void => {
    if (!onClearCandidate) {
      return;
    }

    onClearCandidate(field);
    closeCorrection(field);
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

  const renderCandidateEditor = (
    field: CandidateField,
    candidate: Candidate | undefined,
  ) => {
    const isEditing = editingField === field;
    const label = fieldLabel(field);

    return (
      <>
        <button
          ref={(element) => {
            correctionTriggerRefs.current[field] = element;
          }}
          className="text-button"
          type="button"
          aria-expanded={isEditing}
          aria-controls={isEditing ? correctionIdFor(field) : undefined}
          onClick={() => {
            if (isEditing) {
              closeCorrection(field);
              return;
            }

            openCandidateEntry(field, candidate);
          }}
        >
          {isEditing
            ? `Close ${label} ${candidate ? 'correction' : 'candidate entry'}`
            : candidate
              ? `Correct ${label} candidate`
              : `Add ${label} candidate`}
        </button>
        {candidate && onClearCandidate ? (
          <button className="text-button" type="button" onClick={() => removeCandidate(field)}>
            Remove {label} evidence
          </button>
        ) : null}
        {isEditing ? correctionForm(field, candidate) : null}
      </>
    );
  };

  const progressPercent = typeof progress === 'number'
    ? Math.round(Math.max(0, Math.min(1, progress)) * 100)
    : undefined;
  const confirmationClassName = `checkbox-field checkbox-field--confirmation${
    visualEvidenceAvailable ? '' : ' checkbox-field--confirmation-disabled'
  }`;

  const evidenceColumn = (
    <aside className="evidence-column" aria-label="Label evidence">
      <SectionCard title="Label evidence" eyebrow="What the label shows">
        {hasVisualEvidenceSource ? (
          <EvidenceImageViewer
            src={imageUrl}
            alt={`Label preview: ${title}`}
            imageClassName={imageClassName}
            fixture={evidencePreview}
            onEvidenceAvailabilityChange={onVisualEvidenceAvailabilityChange}
          />
        ) : (
          <p className="muted">No preview is available for this label.</p>
        )}
        <details className="raw-text" id="raw-evidence">
          <summary>View complete extracted text</summary>
          <pre>{rawText || 'No readable text was extracted from this label.'}</pre>
        </details>
      </SectionCard>

      <SectionCard title="Required visual confirmation" eyebrow="Agent check">
        <div id="uppercase-confirmation">
          <p className="section-copy">
            OCR can read the wording, but it cannot verify the warning heading’s presentation.
          </p>
          <label className={confirmationClassName}>
            <input
              type="checkbox"
              checked={visualEvidenceAvailable && warningUppercaseConfirmed}
              disabled={!visualEvidenceAvailable}
              onChange={(event) => onWarningUppercaseConfirmed(event.target.checked)}
            />
            <span>I visually confirmed the printed heading is uppercase.</span>
          </label>
          {warningUppercase ? (
            <div className="confirmation-status">
              <StatusBadge state={warningUppercase.state} />
              <p>{warningUppercase.reason}</p>
            </div>
          ) : null}
        </div>
        <div className="warning-visual-confirmation" id="bold-confirmation">
          <label className={confirmationClassName}>
            <input
              type="checkbox"
              checked={visualEvidenceAvailable && warningBoldConfirmed}
              disabled={!visualEvidenceAvailable}
              onChange={(event) => onWarningBoldConfirmed(event.target.checked)}
            />
            <span>
              I visually confirmed GOVERNMENT WARNING is bold and the remaining warning text is not bold.
            </span>
          </label>
          {warningBold ? (
            <div className="confirmation-status">
              <StatusBadge state={warningBold.state} />
              <p>{warningBold.reason}</p>
            </div>
          ) : null}
        </div>
        <div className="warning-visual-confirmation" id="legibility-confirmation">
          <label className={confirmationClassName}>
            <input
              type="checkbox"
              checked={visualEvidenceAvailable && warningLegibilityConfirmed}
              disabled={!visualEvidenceAvailable}
              onChange={(event) => onWarningLegibilityConfirmed(event.target.checked)}
            />
            <span>
              I reviewed warning legibility, contrast, and placement. Exact printed type size still
              needs final regulatory review.
            </span>
          </label>
          {warningLegibility ? (
            <div className="confirmation-status">
              <StatusBadge state={warningLegibility.state} />
              <p>{warningLegibility.reason}</p>
            </div>
          ) : null}
        </div>
        {!visualEvidenceAvailable ? (
          <p className="visual-confirmation-unavailable">
            Visual evidence is unavailable, so this confirmation cannot be completed.
          </p>
        ) : null}
      </SectionCard>
    </aside>
  );

  return (
    <section className="review-desk" aria-labelledby="review-heading">
      <div className="review-desk__intro">
        <div>
          <p className="eyebrow">Single-label evidence review</p>
          <h1
            ref={reviewHeadingRef}
            id="review-heading"
            tabIndex={shouldFocusReviewHeading ? -1 : undefined}
          >
            {title}
          </h1>
          {disclosure ? (
            <p
              ref={shouldFocusManualDisclosure ? manualDisclosureRef : undefined}
              className="disclosure"
              tabIndex={shouldFocusManualDisclosure ? -1 : undefined}
            >
              {disclosure}
            </p>
          ) : null}
          {manualEvidence ? (
            <div className="manual-evidence-actions">
              <p>Human-entered evidence is preserved. Retry OCR can fill only untouched empty fields.</p>
              <button
                type="button"
                className="button button--secondary"
                onClick={onRetryOcr}
                disabled={phase !== 'ready'}
              >
                Retry OCR
              </button>
            </div>
          ) : null}
        </div>
        <button type="button" className="button button--secondary" onClick={onExit}>
          {exitLabel ?? 'Review another label'}
        </button>
      </div>

      <ScopeNotice />

      {phase === 'ready' && manualEvidence && error ? (
        <section className="review-state review-state--error" role="alert">
          <p className="eyebrow">OCR retry failed</p>
          <p>{error}</p>
          <p>
            Manual evidence remains editable. Continue comparing the original label or retry OCR
            when you are ready.
          </p>
        </section>
      ) : null}

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
          <button type="button" className="button button--secondary" onClick={onExit}>
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
              <span className="review-next__content">
                <a href="#raw-evidence">Inspect the fixture text</a> to see the text this sample
                preserves as precomputed evidence.
              </span>
            </li>
            <li>
              <span className="review-next__content">
                <a href="#field-comparison">Inspect the field comparison</a> to compare the
                application record with each label candidate.
              </span>
            </li>
            <li>
              <span className="review-next__content">
                <a href="#uppercase-confirmation">Complete the visual warning checks</a> on
                the label preview. Text extraction cannot make that confirmation.
              </span>
            </li>
          </ol>
        ) : outstandingFields.length ? (
          <ol>
            {outstandingFields.map((field) => (
              <li key={field.field}>
                <span className="review-next__content">
                  <a href={taskTargetFor(field.field)}>
                    Review {fieldLabel(field.field)}
                  </a>
                  : {field.reason}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <ol>
            <li>
              <span className="review-next__content">
                <a href="#field-comparison">Review the field comparison</a>, then record an
                agent decision. A clean comparison is not approval.
              </span>
            </li>
          </ol>
        )}
      </section>

      <div className="review-desk__grid">
        {evidenceColumn}

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
                                {rawEvidenceLabel(candidate, isGuidedDemo)}:{' '}
                                {candidate.rawText || emptyRawEvidenceText(candidate, isGuidedDemo)}
                              </p>
                              {candidateField
                                ? renderCandidateEditor(candidateField, candidate)
                                : null}
                            </div>
                          ) : candidateField ? (
                            <div className="candidate-evidence">
                              <span className="muted">No extracted candidate</span>
                              {renderCandidateEditor(candidateField, undefined)}
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

      {phase === 'ready' && manualEvidence && !result ? (
        <div className="review-desk__grid">
          {evidenceColumn}
          <div id="field-comparison">
            <SectionCard title="Manual evidence entry" eyebrow="Reviewer-recorded label facts">
              <p className="section-copy">
                No application record is attached to this label. Enter only facts you can verify on the image.
              </p>
              <div
                className="comparison-table-wrap"
                role="region"
                aria-label="Manual evidence entry table. Scroll horizontally to review all columns."
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Field</th>
                      <th scope="col">Evidence</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidenceFields.map((field) => {
                      const candidate = extraction[field];

                      return (
                        <tr key={field}>
                          <th scope="row">{fieldLabel(field)}</th>
                          <td>
                            {candidate ? (
                              <div className="candidate-evidence">
                                <span className="table-value">{candidate.value}</span>
                                <div className="candidate-evidence__meta">
                                  <SourceChip source={candidate.source} />
                                  <span>{confidenceText(candidate)}</span>
                                </div>
                                <p className="raw-evidence">
                                  {rawEvidenceLabel(candidate, isGuidedDemo)}:{' '}
                                  {candidate.rawText || emptyRawEvidenceText(candidate, isGuidedDemo)}
                                </p>
                              </div>
                            ) : (
                              'No evidence entered'
                            )}
                          </td>
                          <td>{renderCandidateEditor(field, candidate)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        </div>
      ) : null}
    </section>
  );
}
