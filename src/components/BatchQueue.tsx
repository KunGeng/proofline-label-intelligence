import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import type { ReviewState } from '../domain/types';
import { extractFromImage } from '../features/extraction/ocr';
import { parseBatchCsv } from '../features/intake/csv';
import { downloadCsv } from '../features/intake/export';
import {
  createReviewQueue,
  queueWorkerFromExtractor,
  type QueueItem,
  type QueueJob,
  type QueueStatus,
  type ReviewQueue,
} from '../features/intake/queue';
import { ScopeNotice, SectionCard, StatusBadge } from './ui';

const MAX_BATCH_FILES = 300;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type QueueFilter =
  | 'all'
  | 'in_progress'
  | 'extracted_pending_application'
  | 'error'
  | ReviewState;

type FieldCounts = Record<ReviewState, number>;

interface BatchQueueProps {
  initialItems?: QueueItem[];
}

const queueStatusLabels: Record<QueueStatus, string> = {
  queued: 'Queued',
  preparing: 'Preparing image',
  reading: 'Reading label',
  validating: 'Comparing facts',
  ready: 'Ready for review',
  error: 'Extraction error',
  extracted_pending_application: 'Application data required',
};

const inProgressStatuses = new Set<QueueStatus>([
  'queued',
  'preparing',
  'reading',
  'validating',
]);

const processedStatuses = new Set<QueueStatus>([
  'ready',
  'error',
  'extracted_pending_application',
]);

const emptyCounts = (): FieldCounts => ({
  match: 0,
  mismatch: 0,
  needs_review: 0,
  unreadable: 0,
});

const countsFor = (item: QueueItem): FieldCounts =>
  item.result?.fields.reduce<FieldCounts>((counts, field) => {
    counts[field.state] += 1;
    return counts;
  }, emptyCounts()) ?? emptyCounts();

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const triageJobsFor = (files: File[]): QueueJob[] =>
  files.map((file, index) => ({
    id: `upload-${index}-${file.name.toLocaleLowerCase('en-US')}`,
    file,
  }));

const readCsvFile = async (file: File): Promise<string> => {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The CSV could not be read.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
};

const isValidImage = (file: File): string | undefined => {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return `${file.name}: choose a JPEG, PNG, or WebP image.`;
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return `${file.name}: images must be 10 MB or smaller.`;
  }

  return undefined;
};

const statusFor = (item: QueueItem) => {
  if (item.status === 'extracted_pending_application') {
    return <span className="batch-status batch-status--triage">Application data required</span>;
  }

  if (item.status === 'ready' && item.result) {
    return <StatusBadge state={item.result.overallState} />;
  }

  return (
    <span
      className={`batch-status${item.status === 'error' ? ' batch-status--error' : ''}`}
    >
      {queueStatusLabels[item.status]}
    </span>
  );
};

export function BatchQueue({ initialItems }: BatchQueueProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [csvText, setCsvText] = useState<string>();
  const [csvName, setCsvName] = useState<string>();
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [items, setItems] = useState<QueueItem[]>(() => initialItems ? [...initialItems] : []);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [filenameQuery, setFilenameQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const queueRef = useRef<ReviewQueue | undefined>(undefined);
  const mountedRef = useRef(true);
  const activeOperationsRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof window.setInterval> | undefined>(undefined);

  const syncItems = useCallback((queue = queueRef.current): void => {
    if (!mountedRef.current || !queue || queueRef.current !== queue) {
      return;
    }

    setItems([...queue.items]);
  }, []);

  const stopRefreshLoop = useCallback((): void => {
    if (refreshTimerRef.current !== undefined) {
      window.clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = undefined;
    }
  }, []);

  const trackQueueWork = useCallback(
    async (queue: ReviewQueue, work: () => Promise<void>): Promise<void> => {
      activeOperationsRef.current += 1;
      setIsProcessing(true);
      syncItems(queue);

      if (refreshTimerRef.current === undefined) {
        refreshTimerRef.current = window.setInterval(() => syncItems(), 80);
      }

      try {
        await work();
      } finally {
        activeOperationsRef.current = Math.max(0, activeOperationsRef.current - 1);
        syncItems(queue);

        if (activeOperationsRef.current === 0) {
          stopRefreshLoop();
          if (mountedRef.current) {
            setIsProcessing(false);
          }
        }
      }
    },
    [stopRefreshLoop, syncItems],
  );

  useEffect(() => {
    mountedRef.current = true;
    setItems(initialItems ? [...initialItems] : []);

    return () => {
      mountedRef.current = false;
      stopRefreshLoop();
      queueRef.current?.clear();
      queueRef.current = undefined;
    };
  }, [initialItems, stopRefreshLoop]);

  const validateCsv = (text: string | undefined, files: File[]): void => {
    setCsvErrors(text && files.length > 0 ? parseBatchCsv(text, files).errors : []);
  };

  const chooseImages = (event: ChangeEvent<HTMLInputElement>): void => {
    const received = Array.from(event.target.files ?? []);
    const errors: string[] = [];
    const candidates = received.slice(0, MAX_BATCH_FILES);

    if (received.length > MAX_BATCH_FILES) {
      errors.push(`Choose up to ${MAX_BATCH_FILES} label images at a time. Only the first ${MAX_BATCH_FILES} were added.`);
    }

    const validFiles = candidates.flatMap((file) => {
      const error = isValidImage(file);
      if (error) {
        errors.push(error);
        return [];
      }

      return [file];
    });

    setSelectedFiles(validFiles);
    setFileErrors(errors);
    validateCsv(csvText, validFiles);
    event.target.value = '';
  };

  const chooseCsv = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      const nextText = await readCsvFile(file);
      setCsvName(file.name);
      setCsvText(nextText);
      validateCsv(nextText, selectedFiles);
    } catch {
      setCsvName(undefined);
      setCsvText(undefined);
      setCsvErrors(['The CSV could not be read. Choose a UTF-8 CSV and try again.']);
    }
  };

  const startBatch = (): void => {
    if (selectedFiles.length === 0) {
      setFileErrors(['Choose one or more JPEG, PNG, or WebP label images to begin a batch.']);
      return;
    }

    const csvResult = csvText ? parseBatchCsv(csvText, selectedFiles) : undefined;
    if (csvResult?.errors.length) {
      setCsvErrors(csvResult.errors);
      return;
    }

    const jobs = csvResult
      ? [...csvResult.matched, ...triageJobsFor(csvResult.unmatchedFiles)]
      : triageJobsFor(selectedFiles);

    queueRef.current?.clear();
    const queue = createReviewQueue(jobs, queueWorkerFromExtractor(extractFromImage), 2);
    queueRef.current = queue;
    setItems([...queue.items]);
    setFilter('all');
    setFilenameQuery('');

    void trackQueueWork(queue, () => queue.start());
  };

  const retry = (id: string): void => {
    const queue = queueRef.current;
    if (!queue) {
      return;
    }

    void trackQueueWork(queue, () => queue.retry(id));
  };

  const clearBatch = (): void => {
    queueRef.current?.clear();
    queueRef.current = undefined;
    activeOperationsRef.current = 0;
    stopRefreshLoop();
    setIsProcessing(false);
    setItems([]);
    setSelectedFiles([]);
    setCsvText(undefined);
    setCsvName(undefined);
    setFileErrors([]);
    setCsvErrors([]);
    setFilter('all');
    setFilenameQuery('');
  };

  const visibleItems = useMemo(() => {
    const query = filenameQuery.trim().toLocaleLowerCase('en-US');

    return items.filter((item) => {
      const matchesFilename = !query || item.name.toLocaleLowerCase('en-US').includes(query);
      if (!matchesFilename) {
        return false;
      }

      if (filter === 'all') {
        return true;
      }

      if (filter === 'in_progress') {
        return inProgressStatuses.has(item.status);
      }

      return item.status === filter || item.result?.overallState === filter;
    });
  }, [filenameQuery, filter, items]);

  const processedCount = items.filter((item) => processedStatuses.has(item.status)).length;
  const hasQueue = items.length > 0;

  return (
    <section className="batch-workspace" aria-labelledby="batch-heading">
      <div className="page-intro batch-workspace__intro">
        <div>
          <p className="eyebrow">Batch label review</p>
          <h1 id="batch-heading">Triage a label set without sending it anywhere.</h1>
          <p>
            Select up to {MAX_BATCH_FILES} label images. Two browser-local workers process
            evidence at a time, and every result remains in this session only.
          </p>
        </div>
        {hasQueue ? (
          <button type="button" className="button button--secondary" onClick={clearBatch}>
            Clear this batch
          </button>
        ) : null}
      </div>

      <ScopeNotice />

      <SectionCard title="Batch intake" eyebrow="01 / Local evidence">
        <div className="batch-intake-grid">
          <div className="batch-dropzone">
            <p className="dropzone__icon" aria-hidden="true">↥</p>
            <h3>Label images</h3>
            <p>JPEG, PNG, or WebP · 10 MB per image · {MAX_BATCH_FILES} files maximum</p>
            <label className="button button--secondary file-control">
              Choose label images
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={chooseImages}
                aria-describedby={fileErrors.length > 0 ? 'batch-file-errors' : undefined}
              />
            </label>
            {selectedFiles.length > 0 ? (
              <p className="selected-file" aria-live="polite">
                <strong>{selectedFiles.length}</strong>{' '}
                {selectedFiles.length === 1 ? 'label image is ready.' : 'label images are ready.'}
              </p>
            ) : null}
          </div>

          <div className="batch-csv-panel">
            <p className="eyebrow">Optional application data</p>
            <h3>Match a CSV by filename</h3>
            <p>
              Use <code>filename</code> alone for extraction triage, or supply the complete
              application schema for validation. Partial schemas are rejected.
            </p>
            <label className="button button--secondary file-control">
              Optional application CSV
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void chooseCsv(event)}
                aria-describedby={csvErrors.length > 0 ? 'batch-csv-errors' : undefined}
              />
            </label>
            {csvName ? <p className="selected-file">Ready: <strong>{csvName}</strong></p> : null}
          </div>
        </div>

        {fileErrors.length > 0 ? (
          <aside className="batch-alert" id="batch-file-errors" role="alert">
            <strong>Image selection needs attention</strong>
            <ul>{fileErrors.map((error) => <li key={error}>{error}</li>)}</ul>
          </aside>
        ) : null}
        {csvErrors.length > 0 ? (
          <aside className="batch-alert" id="batch-csv-errors" role="alert">
            <strong>CSV import needs attention</strong>
            <ul>{csvErrors.map((error) => <li key={error}>{error}</li>)}</ul>
          </aside>
        ) : null}

        <div className="batch-intake-actions">
          <p>Files and extracted text are released when you clear this batch or leave the workspace.</p>
          <button
            type="button"
            className="button button--primary"
            onClick={startBatch}
            disabled={isProcessing || selectedFiles.length === 0 || csvErrors.length > 0}
          >
            {isProcessing ? 'Batch review in progress' : 'Begin batch review'}
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Review queue" eyebrow="02 / Evidence status" className="batch-results">
        <div className="batch-toolbar">
          <div className="batch-progress" aria-live="polite">
            <strong>{processedCount} of {items.length} processed</strong>
            <span>Two local workers maximum</span>
          </div>
          <div className="batch-filters">
            <label>
              Show
              <select value={filter} onChange={(event) => setFilter(event.target.value as QueueFilter)}>
                <option value="all">All labels</option>
                <option value="mismatch">Mismatches</option>
                <option value="needs_review">Needs review</option>
                <option value="unreadable">Unreadable</option>
                <option value="match">Matches</option>
                <option value="extracted_pending_application">Needs application data</option>
                <option value="error">Extraction errors</option>
                <option value="in_progress">In progress</option>
              </select>
            </label>
            <label>
              Search filename
              <input
                type="search"
                value={filenameQuery}
                onChange={(event) => setFilenameQuery(event.target.value)}
                placeholder="e.g. old-tom"
              />
            </label>
            <button
              type="button"
              className="button button--secondary batch-export"
              onClick={() => downloadCsv(visibleItems)}
              disabled={visibleItems.length === 0}
            >
              Export results
            </button>
          </div>
        </div>

        {hasQueue ? (
          visibleItems.length > 0 ? (
            <div className="batch-table-wrap">
              <table className="batch-table">
                <thead>
                  <tr>
                    <th scope="col">Filename</th>
                    <th scope="col">Status</th>
                    <th scope="col">Matches</th>
                    <th scope="col">Mismatches</th>
                    <th scope="col">Needs review</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => {
                    const counts = countsFor(item);
                    return (
                      <tr key={item.id}>
                        <th scope="row">
                          <span className="batch-file-name">{item.name}</span>
                          <span className="batch-file-meta">{formatBytes(item.size)}</span>
                        </th>
                        <td>
                          {statusFor(item)}
                          {item.error ? <p className="batch-row-error">{item.error}</p> : null}
                        </td>
                        <td>{item.result ? counts.match : '—'}</td>
                        <td>{item.result ? counts.mismatch : '—'}</td>
                        <td>
                          {item.result ? (
                            <span className="batch-review-count">
                              {counts.needs_review}
                              {counts.unreadable > 0 ? <small>{counts.unreadable} unreadable</small> : null}
                            </span>
                          ) : '—'}
                        </td>
                        <td>
                          {item.status === 'error' && queueRef.current ? (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => retry(item.id)}
                              disabled={isProcessing}
                              aria-label={`Retry ${item.name}`}
                            >
                              Retry
                            </button>
                          ) : <span className="muted">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="batch-empty-state" role="status">
              <p className="eyebrow">No matching labels</p>
              <h3>Adjust the filters to see another review result.</h3>
            </div>
          )
        ) : (
          <div className="batch-empty-state" role="status">
            <p className="eyebrow">Ready when you are</p>
            <h3>Your local review queue will appear here.</h3>
            <p>Choose label images above, then begin a batch to see each item arrive as it completes.</p>
          </div>
        )}
      </SectionCard>
    </section>
  );
}
