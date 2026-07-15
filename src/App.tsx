import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppShell, type AppView } from './components/AppShell';
import { BatchQueue } from './components/BatchQueue';
import { BenchmarkPanel } from './components/BenchmarkPanel';
import { DemoLabelFixture } from './components/DemoLabelFixture';
import { IntakeForm } from './components/IntakeForm';
import { Landing } from './components/Landing';
import { ReviewDesk, type CandidateField } from './components/ReviewDesk';
import { validateLabel } from './domain/validation';
import type { ApplicationData, LabelExtraction, ReviewFlags } from './domain/types';
import { demoCases } from './features/demo/cases';
import { extractFromImage, prewarmOcr } from './features/extraction/ocr';
import {
  isManualRecoveryOutcome,
  type DemoCaseId,
} from './features/extraction/types';
import type { QueueItem } from './features/intake/queue';
import {
  clearManualCandidate,
  mergeUntouchedOcrEvidence,
  setManualCandidate,
  type ManualEvidenceLocks,
} from './features/review/manualEvidence';

interface ActiveReview {
  phase: 'processing' | 'error' | 'ready';
  title: string;
  application: ApplicationData;
  file?: File;
  extraction: LabelExtraction;
  manualEvidenceLocks: ManualEvidenceLocks;
  rawText: string;
  isGuidedDemo?: boolean;
  isManualEvidence?: boolean;
  imageUrl?: string;
  imageClassName?: string;
  evidencePreview?: ReactNode;
  objectUrl?: string;
  disclosure?: string;
  shouldFocusReviewHeading?: boolean;
  shouldFocusManualDisclosure?: boolean;
  error?: string;
  progress?: number;
  durationMs?: number;
}

const asFixtureEvidence = (extraction: LabelExtraction): LabelExtraction => {
  const fixtureEvidence: LabelExtraction = {};

  for (const field of Object.keys(extraction) as Array<keyof LabelExtraction>) {
    const candidate = extraction[field];
    if (candidate) {
      fixtureEvidence[field] = { ...candidate, source: 'fixture' };
    }
  }

  return fixtureEvidence;
};

const friendlyExtractionError = (error: string): string =>
  error === 'unreadable'
    ? 'We could not read reliable text from this label. Choose another label or provide a clearer image.'
    : error;

const previewUrlFor = (file: File): string | undefined => {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return undefined;
  }

  try {
    return URL.createObjectURL(file);
  } catch {
    return undefined;
  }
};

const emptyReviewFlags: ReviewFlags = {
  warningUppercaseConfirmed: false,
  warningBoldConfirmed: false,
  warningLegibilityConfirmed: false,
};

interface IdleCapableWindow {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
}

const schedulePrewarm = (): void => {
  const run = (): void => {
    void prewarmOcr().catch(() => undefined);
  };
  const idleWindow = window as unknown as IdleCapableWindow;

  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(run, { timeout: 1_500 });
    return;
  }

  window.setTimeout(run, 0);
};

interface AppProps {
  initialBatchItems?: QueueItem[];
}

export function App({ initialBatchItems }: AppProps) {
  const [view, setView] = useState<AppView>(() =>
    initialBatchItems ? 'batch' : 'landing',
  );
  const [review, setReview] = useState<ActiveReview>();
  const [warningUppercaseConfirmed, setWarningUppercaseConfirmed] = useState(false);
  const [warningBoldConfirmed, setWarningBoldConfirmed] = useState(false);
  const [warningLegibilityConfirmed, setWarningLegibilityConfirmed] = useState(false);
  const extractionRun = useRef(0);
  const extractionAbort = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const objectUrl = review?.objectUrl;

    return () => {
      if (objectUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [review?.objectUrl]);

  useEffect(
    () => () => {
      extractionRun.current += 1;
      extractionAbort.current?.abort();
    },
    [],
  );

  const resetVisualConfirmations = (): void => {
    setWarningUppercaseConfirmed(false);
    setWarningBoldConfirmed(false);
    setWarningLegibilityConfirmed(false);
  };

  const cancelActiveExtraction = (): void => {
    extractionRun.current += 1;
    extractionAbort.current?.abort();
    extractionAbort.current = undefined;
  };

  const resetTo = (nextView: Exclude<AppView, 'review'>): void => {
    cancelActiveExtraction();
    setReview(undefined);
    resetVisualConfirmations();
    setView(nextView);

    if (nextView === 'intake' || nextView === 'batch') {
      schedulePrewarm();
    }
  };

  const openDemoCase = (id: DemoCaseId): void => {
    const demoCase = demoCases.find((candidate) => candidate.id === id);
    if (!demoCase) {
      return;
    }

    cancelActiveExtraction();
    resetVisualConfirmations();
    setReview({
      phase: 'ready',
      title: demoCase.title,
      application: demoCase.application,
      extraction: asFixtureEvidence(demoCase.extraction),
      manualEvidenceLocks: {},
      rawText: demoCase.rawText,
      isGuidedDemo: true,
      imageUrl: demoCase.visual.kind === 'image' ? demoCase.visual.src : undefined,
      imageClassName:
        demoCase.visual.kind === 'image' ? demoCase.visual.className : undefined,
      evidencePreview:
        demoCase.visual.kind === 'fixture'
          ? <DemoLabelFixture variant={demoCase.visual.variant} />
          : undefined,
      disclosure: demoCase.disclosure,
      shouldFocusReviewHeading: true,
    });
    setView('review');
  };

  const runExtraction = async (
    application: ApplicationData,
    file: File,
    preserveDraft: boolean,
  ): Promise<void> => {
    const run = extractionRun.current + 1;
    extractionRun.current = run;
    extractionAbort.current?.abort();
    const abortController = new AbortController();
    extractionAbort.current = abortController;

    if (preserveDraft) {
      if (extractionRun.current !== run) {
        return;
      }
      setReview((current) =>
        !current || extractionRun.current !== run
          ? current
          : {
              ...current,
              phase: 'processing',
              error: undefined,
              progress: 0,
              durationMs: undefined,
              shouldFocusManualDisclosure: false,
            },
      );
    } else {
      const objectUrl = previewUrlFor(file);

      resetVisualConfirmations();
      setReview({
        phase: 'processing',
        title: file.name,
        application,
        file,
        extraction: {},
        manualEvidenceLocks: {},
        rawText: '',
        imageUrl: objectUrl,
        objectUrl,
        progress: 0,
      });
      setView('review');
    }

    try {
      const output = await extractFromImage(file, ({ value }) => {
        if (extractionRun.current !== run) {
          return;
        }

        setReview((current) =>
          !current || extractionRun.current !== run
            ? current
            : { ...current, progress: value },
        );
      }, { signal: abortController.signal });

      if (extractionRun.current !== run) {
        return;
      }

      setReview((current) => {
        if (!current || extractionRun.current !== run) {
          return current;
        }

        if (isManualRecoveryOutcome(output.outcome)) {
          const isNoUsableEvidence = output.outcome === 'no-usable-evidence';
          return {
            ...current,
            phase: 'ready',
            isManualEvidence: true,
            extraction: isNoUsableEvidence
              ? preserveDraft
                ? mergeUntouchedOcrEvidence(
                    current.extraction,
                    output.extraction,
                    current.manualEvidenceLocks,
                  )
                : output.extraction
              : preserveDraft ? current.extraction : {},
            rawText: isNoUsableEvidence
              ? output.rawText || current.rawText
              : preserveDraft ? current.rawText : '',
            disclosure:
              isNoUsableEvidence
                ? 'No usable OCR evidence was produced. Inspect the original label, enter manual evidence, retry OCR, or retake a straight-on, evenly lit, glare-free photo.'
                : 'OCR stopped after five seconds. The original label is ready for manual evidence review.',
            shouldFocusManualDisclosure: true,
            progress: undefined,
            durationMs: undefined,
            error: undefined,
          };
        }

        const extraction = preserveDraft
          ? mergeUntouchedOcrEvidence(
              current.extraction,
              output.extraction,
              current.manualEvidenceLocks,
            )
          : output.extraction;

        return {
          ...current,
          phase: output.error && !preserveDraft ? 'error' : 'ready',
          extraction,
          rawText: output.rawText || current.rawText,
          progress: undefined,
          durationMs: output.error ? undefined : output.durationMs,
          error: output.error ? friendlyExtractionError(output.error) : undefined,
          shouldFocusManualDisclosure: false,
        };
      });
    } catch {
      if (extractionRun.current !== run) {
        return;
      }

      setReview((current) =>
        !current || extractionRun.current !== run
          ? current
          : {
              ...current,
              phase: preserveDraft ? 'ready' : 'error',
              progress: undefined,
              error: 'OCR could not complete. Try a clearer image or begin a new evidence review.',
              shouldFocusManualDisclosure: false,
            }
      );
    } finally {
      if (extractionAbort.current === abortController) {
        extractionAbort.current = undefined;
      }
    }
  };

  const startReview = (application: ApplicationData, file: File): Promise<void> =>
    runExtraction(application, file, false);

  const retryOcr = (): void => {
    if (
      !review?.file ||
      !review.isManualEvidence ||
      review.phase !== 'ready' ||
      extractionAbort.current
    ) {
      return;
    }

    void runExtraction(review.application, review.file, true);
  };

  const correctCandidate = (field: CandidateField, value: string): void => {
    setReview((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        extraction: setManualCandidate(current.extraction, field, value),
        manualEvidenceLocks: { ...current.manualEvidenceLocks, [field]: true },
      };
    });
  };

  const clearCandidate = (field: CandidateField): void => {
    setReview((current) =>
      !current
        ? current
        : {
            ...current,
            extraction: clearManualCandidate(current.extraction, field),
            manualEvidenceLocks: { ...current.manualEvidenceLocks, [field]: true },
          },
    );
  };

  const content = (() => {
    if (view === 'landing') {
      return (
        <Landing
          onOpenDemoCase={openDemoCase}
          onReviewLabel={() => resetTo('intake')}
          onReviewBatch={() => resetTo('batch')}
          onOpenBenchmark={() => resetTo('benchmark')}
        />
      );
    }

    if (view === 'intake') {
      return <IntakeForm onCancel={() => resetTo('landing')} onSubmit={startReview} />;
    }

    if (view === 'batch') {
      return <BatchQueue initialItems={initialBatchItems} />;
    }

    if (view === 'benchmark') {
      return <BenchmarkPanel onClose={() => resetTo('landing')} />;
    }

    if (review) {
      const result =
        review.phase === 'ready'
          ? validateLabel({
              application: review.application,
              extraction: review.extraction,
              flags: {
                ...emptyReviewFlags,
                warningUppercaseConfirmed,
                warningBoldConfirmed,
                warningLegibilityConfirmed,
              },
              hasVisualEvidence: Boolean(review.imageUrl || review.evidencePreview),
            })
          : undefined;

      return (
        <ReviewDesk
          title={review.title}
          extraction={review.extraction}
          result={result}
          phase={review.phase}
          rawText={review.rawText}
          imageUrl={review.imageUrl}
          imageClassName={review.imageClassName}
          evidencePreview={review.evidencePreview}
          disclosure={review.disclosure}
          error={review.error}
          progress={review.progress}
          durationMs={review.durationMs}
          isGuidedDemo={Boolean(review.isGuidedDemo)}
          shouldFocusReviewHeading={review.shouldFocusReviewHeading}
          shouldFocusManualDisclosure={Boolean(review.shouldFocusManualDisclosure)}
          manualEvidence={review.isManualEvidence}
          onRetryOcr={retryOcr}
          warningUppercaseConfirmed={warningUppercaseConfirmed}
          onWarningUppercaseConfirmed={setWarningUppercaseConfirmed}
          warningBoldConfirmed={warningBoldConfirmed}
          onWarningBoldConfirmed={setWarningBoldConfirmed}
          warningLegibilityConfirmed={warningLegibilityConfirmed}
          onWarningLegibilityConfirmed={setWarningLegibilityConfirmed}
          onCorrectCandidate={correctCandidate}
          onClearCandidate={clearCandidate}
          exitLabel="Review another label"
          onExit={() => resetTo('intake')}
        />
      );
    }

    return (
      <Landing
        onOpenDemoCase={openDemoCase}
        onReviewLabel={() => resetTo('intake')}
        onReviewBatch={() => resetTo('batch')}
        onOpenBenchmark={() => resetTo('benchmark')}
      />
    );
  })();

  return (
    <AppShell
      activeView={view}
      onHome={() => resetTo('landing')}
      onReviewLabel={() => resetTo('intake')}
      onReviewBatch={() => resetTo('batch')}
    >
      {content}
    </AppShell>
  );
}
