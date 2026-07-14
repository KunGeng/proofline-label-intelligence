import { useEffect, useRef, useState } from 'react';
import { fieldLabel } from '../domain/validation';
import type { Candidate, LabelExtraction } from '../domain/types';
import { extractFromImage } from '../features/extraction/ocr';
import type { ExtractionJobResult } from '../features/extraction/types';

interface BenchmarkPanelProps {
  onClose: () => void;
}

interface BenchmarkRunProps {
  label: string;
  result: ExtractionJobResult;
}

const formatMilliseconds = (milliseconds: number | undefined): string =>
  milliseconds === undefined ? 'Not available' : `${(milliseconds / 1000).toFixed(1)} s`;

const parsedFieldsFor = (
  extraction: LabelExtraction,
): Array<[keyof LabelExtraction, Candidate]> =>
  Object.entries(extraction) as Array<[keyof LabelExtraction, Candidate]>;

const confidenceText = (candidate: Candidate): string =>
  `${Math.round(candidate.confidence * 100)}% confidence`;

const idFor = (label: string): string => `benchmark-${label.toLowerCase().replace(/\s+/g, '-')}`;

function BenchmarkRun({ label, result }: BenchmarkRunProps) {
  const candidates = parsedFieldsFor(result.extraction);
  const timings = result.timings;
  const totalMs = timings?.totalMs ?? result.durationMs;
  const headingId = idFor(label);

  return (
    <article className="benchmark-run" aria-labelledby={headingId}>
      <p className="eyebrow">Device-local measurement</p>
      <h2 id={headingId}>{label}</h2>
      <div className="benchmark-run__timings" aria-label={`${label} phase timings`}>
        <p>Total: {formatMilliseconds(totalMs)}</p>
        <p>Preparation: {formatMilliseconds(timings?.preparationMs)}</p>
        <p>Worker wait: {formatMilliseconds(timings?.workerWaitMs)}</p>
        <p>Recognition: {formatMilliseconds(timings?.recognitionMs)}</p>
      </div>
      {result.error ? (
        <p className="benchmark-run__error" role="alert">Extraction error: {result.error}</p>
      ) : null}
      <h3>Parsed fields</h3>
      {candidates.length ? (
        <ul className="benchmark-run__fields">
          {candidates.map(([field, candidate]) => (
            <li key={field}>
              <strong>{fieldLabel(field)}:</strong> {candidate.value} — {confidenceText(candidate)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No parsed fields were returned for this run.</p>
      )}
    </article>
  );
}

export function BenchmarkPanel({ onClose }: BenchmarkPanelProps) {
  const [runs, setRuns] = useState<ExtractionJobResult[]>([]);
  const [progress, setProgress] = useState('No benchmark runs yet.');
  const [error, setError] = useState<string>();
  const [isRunning, setIsRunning] = useState(false);
  const mountedRef = useRef(true);
  const benchmarkRun = useRef(0);
  const benchmarkAbort = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      benchmarkRun.current += 1;
      benchmarkAbort.current?.abort();
      benchmarkAbort.current = undefined;
    };
  }, []);

  const runBenchmark = async (): Promise<void> => {
    if (!mountedRef.current) {
      return;
    }

    const run = benchmarkRun.current + 1;
    benchmarkRun.current = run;
    benchmarkAbort.current?.abort();
    const abortController = new AbortController();
    benchmarkAbort.current = abortController;
    const isCurrent = (): boolean =>
      mountedRef.current &&
      benchmarkRun.current === run &&
      !abortController.signal.aborted;

    if (isCurrent()) {
      setRuns([]);
      setError(undefined);
      setIsRunning(true);
      setProgress('Loading the shipped sample from this site…');
    }

    try {
      const response = await fetch('/demo/old-tom-bourbon.jpg', {
        signal: abortController.signal,
      });
      if (!isCurrent()) {
        return;
      }
      if (!response.ok) {
        throw new Error('The shipped sample could not be loaded.');
      }

      const blob = await response.blob();
      if (!isCurrent()) {
        return;
      }
      const file = new File([blob], 'old-tom-bourbon.jpg', { type: 'image/jpeg' });
      setProgress('Running first sample run…');
      const first = await extractFromImage(file, ({ value }) => {
        if (isCurrent()) {
          setProgress(`Running first sample run… ${Math.round(value * 100)}% complete.`);
        }
      }, { signal: abortController.signal, deadlineMs: null });
      if (!isCurrent() || first.error === 'cancelled') {
        return;
      }
      setRuns([first]);

      setProgress('Running second warm-worker run…');
      const second = await extractFromImage(file, ({ value }) => {
        if (isCurrent()) {
          setProgress(`Running second warm-worker run… ${Math.round(value * 100)}% complete.`);
        }
      }, { signal: abortController.signal, deadlineMs: null });
      if (!isCurrent() || second.error === 'cancelled') {
        return;
      }
      setRuns([first, second]);
      setProgress('Benchmark complete. Results remain in this open panel only.');
    } catch (caught) {
      if (!isCurrent()) {
        return;
      }
      const message = caught instanceof Error
        ? caught.message
        : 'The local benchmark could not complete.';
      setError(message);
      setProgress('Benchmark could not complete.');
    } finally {
      if (benchmarkAbort.current === abortController) {
        benchmarkAbort.current = undefined;
      }
      if (isCurrent()) {
        setIsRunning(false);
      }
    }
  };

  return (
    <section className="benchmark-panel" aria-labelledby="benchmark-heading">
      <div className="benchmark-panel__intro">
        <div>
          <p className="eyebrow">Local sample benchmark</p>
          <h1 id="benchmark-heading">Measure OCR on this device.</h1>
          <p>
            Proofline fetches only the shipped sample from this same origin, then runs it twice
            locally. This is a device-specific measurement, not a universal speed promise.
          </p>
        </div>
        <button type="button" className="button button--secondary" onClick={onClose} disabled={isRunning}>
          Back to overview
        </button>
      </div>

      <p className="benchmark-panel__progress" role="status" aria-live="polite" aria-atomic="true" aria-label="Benchmark progress">
        {progress}
      </p>

      <button
        type="button"
        className="button button--primary"
        onClick={() => void runBenchmark()}
        disabled={isRunning}
      >
        {isRunning ? 'Running benchmark…' : 'Run benchmark'}
      </button>

      {error ? <p className="inline-error benchmark-panel__error" role="alert">{error}</p> : null}

      {runs.length ? (
        <div className="benchmark-panel__runs">
          <BenchmarkRun label="First sample run" result={runs[0]} />
          {runs[1] ? <BenchmarkRun label="Second warm-worker run" result={runs[1]} /> : null}
        </div>
      ) : null}
    </section>
  );
}
