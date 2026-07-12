import { useEffect, useRef, useState } from 'react';
import { AppShell, type AppView } from './components/AppShell';
import { IntakeForm } from './components/IntakeForm';
import { Landing } from './components/Landing';
import { ReviewDesk, type CandidateField } from './components/ReviewDesk';
import { validateLabel } from './domain/validation';
import type { ApplicationData, LabelExtraction } from './domain/types';
import { oldTomDemo, OLD_TOM_RAW_TEXT } from './features/demo/cases';
import { extractFromImage } from './features/extraction/ocr';

interface ActiveReview {
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
    ? 'Unable to extract reliable label text. Inspect the image and correct candidates only when supported by evidence.'
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

export function App() {
  const [view, setView] = useState<AppView>('landing');
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

  const resetTo = (nextView: Extract<AppView, 'landing' | 'intake'>): void => {
    extractionRun.current += 1;
    setReview(undefined);
    setWarningTypographyConfirmed(false);
    setView(nextView);
  };

  const openDemo = (): void => {
    extractionRun.current += 1;
    setWarningTypographyConfirmed(false);
    setReview({
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
              progress: undefined,
              error: 'OCR could not complete. Try a clearer image or begin a new evidence review.',
            }
          : current,
      );
    }
  };

  const correctCandidate = (field: CandidateField, value: string): void => {
    setReview((current) => {
      const candidate = current?.extraction[field];
      if (!current || !candidate) {
        return current;
      }

      return {
        ...current,
        extraction: {
          ...current.extraction,
          [field]: { ...candidate, value, source: 'agent' },
        },
      };
    });
  };

  const content = (() => {
    if (view === 'landing') {
      return <Landing onOpenDemo={openDemo} onReviewLabel={() => resetTo('intake')} />;
    }

    if (view === 'intake') {
      return <IntakeForm onCancel={() => resetTo('landing')} onSubmit={startReview} />;
    }

    if (review) {
      const result = validateLabel({
        application: review.application,
        extraction: review.extraction,
        flags: { warningTypographyConfirmed },
      });

      return (
        <ReviewDesk
          title={review.title}
          extraction={review.extraction}
          result={result}
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

    return <Landing onOpenDemo={openDemo} onReviewLabel={() => resetTo('intake')} />;
  })();

  return (
    <AppShell
      activeView={view}
      onHome={() => resetTo('landing')}
      onReviewLabel={() => resetTo('intake')}
    >
      {content}
    </AppShell>
  );
}
