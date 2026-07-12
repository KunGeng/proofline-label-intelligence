import { useEffect, useRef, useState } from 'react';
import { AppShell, type AppView } from './components/AppShell';
import { BatchQueue } from './components/BatchQueue';
import { IntakeForm } from './components/IntakeForm';
import { Landing } from './components/Landing';
import { ReviewDesk, type CandidateField } from './components/ReviewDesk';
import { validateLabel } from './domain/validation';
import type { ApplicationData, LabelExtraction } from './domain/types';
import { oldTomDemo, OLD_TOM_RAW_TEXT } from './features/demo/cases';
import { extractFromImage } from './features/extraction/ocr';
import type { QueueItem } from './features/intake/queue';

interface ActiveReview {
  phase: 'processing' | 'error' | 'ready';
  title: string;
  application: ApplicationData;
  extraction: LabelExtraction;
  rawText: string;
  imageUrl?: string;
  objectUrl?: string;
  disclosure?: string;
  error?: string;
  progress?: number;
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

interface AppProps {
  initialBatchItems?: QueueItem[];
}

export function App({ initialBatchItems }: AppProps) {
  const [view, setView] = useState<AppView>(() =>
    initialBatchItems ? 'batch' : 'landing',
  );
  const [review, setReview] = useState<ActiveReview>();
  const [warningTypographyConfirmed, setWarningTypographyConfirmed] = useState(false);
  const extractionRun = useRef(0);

  useEffect(() => {
    const objectUrl = review?.objectUrl;

    return () => {
      if (objectUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [review?.objectUrl]);

  const resetTo = (nextView: Extract<AppView, 'landing' | 'intake' | 'batch'>): void => {
    extractionRun.current += 1;
    setReview(undefined);
    setWarningTypographyConfirmed(false);
    setView(nextView);
  };

  const openDemo = (): void => {
    extractionRun.current += 1;
    setWarningTypographyConfirmed(false);
    setReview({
      phase: 'ready',
      title: oldTomDemo.title,
      application: oldTomDemo.application,
      extraction: asFixtureEvidence(oldTomDemo.extraction),
      rawText: OLD_TOM_RAW_TEXT,
      imageUrl: oldTomDemo.imageUrl,
      disclosure: oldTomDemo.disclosure,
    });
    setView('review');
  };

  const startReview = async (application: ApplicationData, file: File): Promise<void> => {
    const run = extractionRun.current + 1;
    extractionRun.current = run;
    const objectUrl = previewUrlFor(file);

    setWarningTypographyConfirmed(false);
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

    try {
      const output = await extractFromImage(file, ({ value }) => {
        if (extractionRun.current !== run) {
          return;
        }

        setReview((current) =>
          current ? { ...current, progress: value } : current,
        );
      });

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
    }
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
            ? { ...candidate, value, source: 'agent' }
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
        />
      );
    }

    if (view === 'intake') {
      return <IntakeForm onCancel={() => resetTo('landing')} onSubmit={startReview} />;
    }

    if (view === 'batch') {
      return <BatchQueue initialItems={initialBatchItems} />;
    }

    if (review) {
      const result =
        review.phase === 'ready'
          ? validateLabel({
              application: review.application,
              extraction: review.extraction,
              flags: { warningTypographyConfirmed },
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
          warningTypographyConfirmed={warningTypographyConfirmed}
          onWarningTypographyConfirmed={setWarningTypographyConfirmed}
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
