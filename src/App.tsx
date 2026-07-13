import { useEffect, useRef, useState } from 'react';
import { AppShell, type AppView } from './components/AppShell';
import { BatchQueue } from './components/BatchQueue';
import { BenchmarkPanel } from './components/BenchmarkPanel';
import { IntakeForm } from './components/IntakeForm';
import { Landing } from './components/Landing';
import { ReviewDesk, type CandidateField } from './components/ReviewDesk';
import { validateLabel } from './domain/validation';
import type { ApplicationData, LabelExtraction, ReviewFlags } from './domain/types';
import { oldTomDemo, OLD_TOM_RAW_TEXT } from './features/demo/cases';
import { extractFromImage, prewarmOcr } from './features/extraction/ocr';
import type { QueueItem } from './features/intake/queue';

interface ActiveReview {
  phase: 'processing' | 'error' | 'ready';
  title: string;
  application: ApplicationData;
  extraction: LabelExtraction;
  rawText: string;
  isGuidedDemo?: boolean;
  isManualEvidence?: boolean;
  imageUrl?: string;
  objectUrl?: string;
  disclosure?: string;
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
  warningTypographyConfirmed: false,
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

const manualEvidenceDisclosure =
  'Manual evidence mode — no OCR candidate was used. Inspect the original label and enter only evidence you can verify.';

interface AppProps {
  initialBatchItems?: QueueItem[];
}

export function App({ initialBatchItems }: AppProps) {
  const [view, setView] = useState<AppView>(() =>
    initialBatchItems ? 'batch' : 'landing',
  );
  const [review, setReview] = useState<ActiveReview>();
  const [warningTypographyConfirmed, setWarningTypographyConfirmed] = useState(false);
  const [warningLegibilityConfirmed, setWarningLegibilityConfirmed] = useState(false);
  const [slowExtraction, setSlowExtraction] = useState(false);
  const [stopAvailable, setStopAvailable] = useState(false);
  const extractionRun = useRef(0);
  const extractionAbort = useRef<AbortController | undefined>(undefined);
  const slowTimerCleanup = useRef<(() => void) | undefined>(undefined);

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
      slowTimerCleanup.current?.();
      slowTimerCleanup.current = undefined;
    },
    [],
  );

  const clearSlowRecovery = (): void => {
    slowTimerCleanup.current?.();
    slowTimerCleanup.current = undefined;
    setSlowExtraction(false);
    setStopAvailable(false);
  };

  const startSlowTimers = (): (() => void) => {
    const slow = window.setTimeout(() => setSlowExtraction(true), 5_000);
    const stop = window.setTimeout(() => setStopAvailable(true), 15_000);

    return () => {
      window.clearTimeout(slow);
      window.clearTimeout(stop);
    };
  };

  const resetVisualConfirmations = (): void => {
    setWarningTypographyConfirmed(false);
    setWarningLegibilityConfirmed(false);
  };

  const cancelActiveExtraction = (): void => {
    extractionRun.current += 1;
    extractionAbort.current?.abort();
    extractionAbort.current = undefined;
    clearSlowRecovery();
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

  const openDemo = (): void => {
    cancelActiveExtraction();
    resetVisualConfirmations();
    setReview({
      phase: 'ready',
      title: oldTomDemo.title,
      application: oldTomDemo.application,
      extraction: asFixtureEvidence(oldTomDemo.extraction),
      rawText: OLD_TOM_RAW_TEXT,
      isGuidedDemo: true,
      imageUrl: oldTomDemo.imageUrl,
      disclosure: oldTomDemo.disclosure,
    });
    setView('review');
  };

  const startReview = async (application: ApplicationData, file: File): Promise<void> => {
    const run = extractionRun.current + 1;
    extractionRun.current = run;
    extractionAbort.current?.abort();
    clearSlowRecovery();
    const abortController = new AbortController();
    extractionAbort.current = abortController;
    const objectUrl = previewUrlFor(file);

    resetVisualConfirmations();
    setReview({
      phase: 'processing',
      title: file.name,
      application,
      extraction: {},
      rawText: '',
      imageUrl: objectUrl,
      objectUrl,
      progress: 0,
    });
    setView('review');
    slowTimerCleanup.current = startSlowTimers();

    try {
      const output = await extractFromImage(file, ({ value }) => {
        if (extractionRun.current !== run) {
          return;
        }

        setReview((current) =>
          current ? { ...current, progress: value } : current,
        );
      }, { signal: abortController.signal });

      if (extractionRun.current !== run) {
        return;
      }

      setReview((current) =>
        current
          ? {
              ...current,
              extraction: output.extraction,
              rawText: output.rawText,
              progress: undefined,
              phase: output.error ? 'error' : 'ready',
              error: output.error ? friendlyExtractionError(output.error) : undefined,
              durationMs: output.error ? undefined : output.durationMs,
            }
          : current,
      );
    } catch {
      if (extractionRun.current !== run) {
        return;
      }

      setReview((current) =>
        current
          ? {
              ...current,
              phase: 'error',
              progress: undefined,
              error: 'OCR could not complete. Try a clearer image or begin a new evidence review.',
            }
          : current,
      );
    } finally {
      if (extractionRun.current === run) {
        clearSlowRecovery();
        if (extractionAbort.current === abortController) {
          extractionAbort.current = undefined;
        }
      }
    }
  };

  const reviewManually = (): void => {
    extractionRun.current += 1;
    clearSlowRecovery();
    setReview((current) =>
      current
        ? {
            ...current,
            phase: 'ready',
            isManualEvidence: true,
            extraction: {},
            rawText: '',
            disclosure: manualEvidenceDisclosure,
            error: undefined,
            progress: undefined,
            durationMs: undefined,
          }
        : current,
    );
  };

  const stopAndReviewManually = (): void => {
    extractionAbort.current?.abort();
    reviewManually();
  };

  const correctCandidate = (field: CandidateField, value: string): void => {
    setReview((current) => {
      if (!current) {
        return current;
      }

      const candidate = current.extraction[field];

      return {
        ...current,
        extraction: {
          ...current.extraction,
          [field]: candidate
            ? // A correction is a human-verified value: the OCR confidence no
              // longer describes it, while the raw OCR text stays as evidence.
              { ...candidate, value, source: 'agent', confidence: 1 }
            : { value, rawText: '', confidence: 1, source: 'agent' },
        },
      };
    });
  };

  const content = (() => {
    if (view === 'landing') {
      return (
        <Landing
          onOpenDemo={openDemo}
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
                warningTypographyConfirmed,
                warningLegibilityConfirmed,
              },
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
          disclosure={review.disclosure}
          error={review.error}
          progress={review.progress}
          durationMs={review.durationMs}
          isGuidedDemo={Boolean(review.isGuidedDemo)}
          shouldFocusManualDisclosure={Boolean(review.isManualEvidence)}
          slowExtraction={slowExtraction}
          stopAvailable={stopAvailable}
          onManualReview={reviewManually}
          onStopOcr={stopAndReviewManually}
          warningTypographyConfirmed={warningTypographyConfirmed}
          onWarningTypographyConfirmed={setWarningTypographyConfirmed}
          warningLegibilityConfirmed={warningLegibilityConfirmed}
          onWarningLegibilityConfirmed={setWarningLegibilityConfirmed}
          onCorrectCandidate={correctCandidate}
          onStartAnother={() => resetTo('intake')}
        />
      );
    }

    return (
      <Landing
        onOpenDemo={openDemo}
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
