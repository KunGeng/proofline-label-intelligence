import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { fieldLabel, validateLabel } from '../domain/validation';
import type {
  Candidate,
  FieldKey,
  LabelExtraction,
  ReviewFlags,
  ReviewState,
} from '../domain/types';
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
import {
  clearManualCandidate,
  setManualCandidate,
} from '../features/review/manualEvidence';
import {
  QueueEmptyIllustration,
  ScopeNotice,
  SectionCard,
  SourceChip,
  StatusBadge,
} from './ui';
import { ReviewDesk, type CandidateField } from './ReviewDesk';

const MAX_BATCH_FILES = 300;
const BATCH_WORKER_COUNT = 2;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type QueueFilter =
  | 'all'
  | 'in_progress'
  | 'extracted_pending_application'
  | 'error'
  | 'manual_review_required'
  | ReviewState;

type FieldCounts = Record<ReviewState, number>;

type ReturnFocusAction = 'manual' | 'retry';

interface ReturnFocusTarget {
  itemId: string;
  action: ReturnFocusAction;
}

interface BatchQueueProps {
  initialItems?: QueueItem[];
}

interface QueueGeneration {
  queue: ReviewQueue;
  activeOperations: number;
  // This component runs only in the browser and deliberately calls window.setInterval,
  // whose DOM handle is a number even when Node test types are available.
  refreshTimer?: number;
}

const queueStatusLabels: Record<QueueStatus, string> = {
  queued: 'Queued',
  preparing: 'Preparing image',
  reading: 'Reading label',
  validating: 'Comparing facts',
  ready: 'Ready for review',
  error: 'Extraction error',
  extracted_pending_application: 'Application data required',
  manual_review_required: 'Manual review required',
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
  'manual_review_required',
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

const errorDescriptionIdFor = (item: QueueItem): string => `batch-row-error-${item.id}`;
const evidenceIdFor = (item: QueueItem): string => `batch-evidence-${item.id}`;

const candidateEntriesFor = (
  extraction: LabelExtraction | undefined,
): Array<[keyof LabelExtraction, Candidate]> =>
  Object.entries(extraction ?? {}) as Array<[keyof LabelExtraction, Candidate]>;

const confidenceText = (candidate: Candidate): string =>
  candidate.source === 'agent'
    ? 'Human-verified'
    : `${Math.round(candidate.confidence * 100)}% confidence`;

const formatSeconds = (milliseconds: number): string =>
  `${(milliseconds / 1000).toFixed(1)} s`;

const formatEstimate = (milliseconds: number): string => {
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds < 60) {
    return `about ${seconds} s`;
  }

  return `about ${Math.ceil(seconds / 60)} min`;
};

function BatchEvidence({ item }: { item: QueueItem }) {
  const candidates = candidateEntriesFor(item.extraction);

  return (
    <section
      className="batch-evidence"
      id={evidenceIdFor(item)}
      role="region"
      aria-label={`Evidence for ${item.name}`}
    >
      <div className="batch-evidence__heading">
        <div>
          <p className="eyebrow">Label evidence</p>
          <h3>{item.name}</h3>
          {item.durationMs !== undefined ? (
            <p className="muted">Extracted locally in {formatSeconds(item.durationMs)}.</p>
          ) : null}
        </div>
        {item.status === 'extracted_pending_application' ? (
          <span className="batch-status batch-status--triage">Application data required</span>
        ) : null}
      </div>

      <div className="batch-evidence__grid">
        <div>
          {item.thumbnailUrl ? (
            <figure className="batch-evidence__preview">
              <img src={item.thumbnailUrl} alt={`Label preview: ${item.name}`} />
              <figcaption>Preview retained only for this browser-session review.</figcaption>
            </figure>
          ) : (
            <p className="muted">No label preview is available for this item.</p>
          )}

          <div className="batch-evidence__raw">
            <h4>Raw OCR</h4>
            <pre>{item.rawText || 'No readable text was extracted from this label.'}</pre>
          </div>
        </div>

        <div className="batch-evidence__details">
          <div>
            <h4>Extracted candidates</h4>
            {candidates.length > 0 ? (
              <ul className="batch-evidence__list">
                {candidates.map(([field, candidate]) => (
                  <li key={field}>
                    <strong>{fieldLabel(field as FieldKey)}</strong>
                    <span className="table-value">{candidate.value}</span>
                    <div className="candidate-evidence__meta">
                      <SourceChip source={candidate.source} />
                      <span>{confidenceText(candidate)}</span>
                    </div>
                    <p className="raw-evidence">
                      Raw OCR: {candidate.rawText || 'No raw OCR candidate was extracted.'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No extracted candidates are available for this item.</p>
            )}
          </div>

          {item.result ? (
            <div>
              <h4>Validation findings</h4>
              <ul className="batch-evidence__list batch-evidence__list--findings">
                {item.result.fields.map((field) => (
                  <li key={field.field}>
                    <div className="batch-evidence__finding-heading">
                      <strong>{fieldLabel(field.field)}</strong>
                      <StatusBadge state={field.state} />
                    </div>
                    <p className="finding-reason">{field.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const statusFor = (item: QueueItem) => {
  if (item.status === 'manual_review_required') {
    return <span className="batch-status batch-status--manual">Manual review required</span>;
  }

  if (item.status === 'extracted_pending_application') {
    return <span className="batch-status batch-status--triage">Application data required</span>;
  }

  if (item.status === 'ready' && item.result) {
    return <StatusBadge state={item.result.overallState} />;
  }

  return (
    <span
      className={`batch-status${item.status === 'error' ? ' batch-status--error' : ''}`}
      aria-describedby={item.error ? errorDescriptionIdFor(item) : undefined}
    >
      {queueStatusLabels[item.status]}
    </span>
  );
};

const revalidateItem = (item: QueueItem): void => {
  if (!item.application) {
    return;
  }

  item.result = validateLabel({
    application: item.application,
    extraction: item.extraction ?? {},
    flags: item.reviewFlags,
  });
};

interface BatchFullReviewProps {
  item: QueueItem;
  onBack: () => void;
  onRetry: (id: string) => void;
  onCorrectCandidate: (field: CandidateField, value: string) => void;
  onClearCandidate: (field: CandidateField) => void;
  onUpdateFlags: (flags: Partial<ReviewFlags>) => void;
}

function BatchFullReview({
  item,
  onBack,
  onRetry,
  onCorrectCandidate,
  onClearCandidate,
  onUpdateFlags,
}: BatchFullReviewProps) {
  const [imageUrl, setImageUrl] = useState<string>();

  useEffect(() => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      setImageUrl(undefined);
      return;
    }

    let objectUrl: string | undefined;
    try {
      objectUrl = URL.createObjectURL(item.file);
      setImageUrl(objectUrl);
    } catch {
      setImageUrl(undefined);
    }

    return () => {
      if (
        objectUrl &&
        typeof URL.revokeObjectURL === 'function'
      ) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [item.file]);

  const displayResult = item.application
    ? item.result ?? validateLabel({
        application: item.application,
        extraction: item.extraction ?? {},
        flags: item.reviewFlags,
      })
    : undefined;

  return (
    <div className="batch-full-review">
      <ReviewDesk
        title={item.name}
        extraction={item.extraction ?? {}}
        result={displayResult}
        phase="ready"
        rawText={item.rawText ?? ''}
        imageUrl={imageUrl}
        durationMs={item.durationMs}
        isGuidedDemo={false}
        shouldFocusReviewHeading
        shouldFocusManualDisclosure={false}
        manualEvidence={Boolean(item.isManualEvidence)}
        onRetryOcr={() => {
          onRetry(item.id);
          onBack();
        }}
        warningTypographyConfirmed={item.reviewFlags.warningTypographyConfirmed}
        onWarningTypographyConfirmed={(confirmed) =>
          onUpdateFlags({ warningTypographyConfirmed: confirmed })
        }
        warningLegibilityConfirmed={item.reviewFlags.warningLegibilityConfirmed}
        onWarningLegibilityConfirmed={(confirmed) =>
          onUpdateFlags({ warningLegibilityConfirmed: confirmed })
        }
        onCorrectCandidate={onCorrectCandidate}
        onClearCandidate={onClearCandidate}
        exitLabel="Back to batch"
        onExit={onBack}
      />
    </div>
  );
}

export function BatchQueue({ initialItems }: BatchQueueProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [csvPresent, setCsvPresent] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvText, setCsvText] = useState<string>();
  const [csvName, setCsvName] = useState<string>();
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [items, setItems] = useState<QueueItem[]>(() => initialItems ? [...initialItems] : []);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [filenameQuery, setFilenameQuery] = useState('');
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string>();
  const [fullReviewItemId, setFullReviewItemId] = useState<string>();
  const [returnFocusTarget, setReturnFocusTarget] = useState<ReturnFocusTarget>();
  const [isProcessing, setIsProcessing] = useState(false);
  const selectedFilesRef = useRef<File[]>([]);
  const activeGenerationRef = useRef<QueueGeneration | undefined>(undefined);
  const csvRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const fullReviewTriggerRefs = useRef<
    Partial<Record<string, HTMLButtonElement | null>>
  >({});
  const retryTriggerRefs = useRef<
    Partial<Record<string, HTMLButtonElement | null>>
  >({});
  const queueFilterRef = useRef<HTMLSelectElement>(null);

  const syncItems = useCallback((generation = activeGenerationRef.current): void => {
    if (
      !mountedRef.current ||
      !generation ||
      activeGenerationRef.current !== generation
    ) {
      return;
    }

    setItems([...generation.queue.items]);
  }, []);

  const stopRefreshLoop = useCallback((generation: QueueGeneration): void => {
    if (generation.refreshTimer !== undefined) {
      window.clearInterval(generation.refreshTimer);
      generation.refreshTimer = undefined;
    }
  }, []);

  const retireActiveGeneration = useCallback((): void => {
    const generation = activeGenerationRef.current;
    if (!generation) {
      return;
    }

    generation.queue.clear();
    stopRefreshLoop(generation);
    activeGenerationRef.current = undefined;
  }, [stopRefreshLoop]);

  const trackQueueWork = useCallback(
    async (generation: QueueGeneration, work: () => Promise<void>): Promise<void> => {
      generation.activeOperations += 1;
      if (activeGenerationRef.current === generation && mountedRef.current) {
        setIsProcessing(true);
        syncItems(generation);

        if (generation.refreshTimer === undefined) {
          generation.refreshTimer = window.setInterval(() => syncItems(generation), 80);
        }
      }

      try {
        await work();
      } finally {
        generation.activeOperations = Math.max(0, generation.activeOperations - 1);
        if (activeGenerationRef.current !== generation) {
          return;
        }

        syncItems(generation);

        if (generation.activeOperations === 0) {
          stopRefreshLoop(generation);
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
    setExpandedEvidenceId(undefined);
    setFullReviewItemId(undefined);
    setReturnFocusTarget(undefined);

    return () => {
      mountedRef.current = false;
      csvRequestRef.current += 1;
      retireActiveGeneration();
    };
  }, [initialItems, retireActiveGeneration]);

  useEffect(() => {
    if (fullReviewItemId !== undefined || !returnFocusTarget) {
      return;
    }

    const { itemId, action } = returnFocusTarget;
    const trigger = action === 'retry'
      ? retryTriggerRefs.current[itemId] ?? fullReviewTriggerRefs.current[itemId]
      : fullReviewTriggerRefs.current[itemId];
    if (trigger) {
      trigger.focus();
      setReturnFocusTarget(undefined);
      return;
    }

    const returningItem = items.find((item) => item.id === itemId);
    if (returningItem && inProgressStatuses.has(returningItem.status)) {
      return;
    }

    queueFilterRef.current?.focus();
    setReturnFocusTarget(undefined);
  }, [fullReviewItemId, items, returnFocusTarget]);

  const validateCsv = (text: string | undefined, files: File[]): void => {
    setCsvErrors(text !== undefined && files.length > 0 ? parseBatchCsv(text, files).errors : []);
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
    selectedFilesRef.current = validFiles;
    setFileErrors(errors);
    if (csvPresent && !csvLoading && csvText !== undefined) {
      validateCsv(csvText, validFiles);
    }
    event.target.value = '';
  };

  const chooseCsv = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const request = csvRequestRef.current + 1;
    csvRequestRef.current = request;

    if (!file) {
      setCsvPresent(false);
      setCsvLoading(false);
      setCsvText(undefined);
      setCsvName(undefined);
      setCsvErrors([]);
      return;
    }

    setCsvPresent(true);
    setCsvLoading(true);
    setCsvText(undefined);
    setCsvName(file.name);
    setCsvErrors([]);

    try {
      const nextText = await readCsvFile(file);
      if (request !== csvRequestRef.current || !mountedRef.current) {
        return;
      }

      setCsvText(nextText);
      setCsvLoading(false);
      validateCsv(nextText, selectedFilesRef.current);
    } catch {
      if (request !== csvRequestRef.current || !mountedRef.current) {
        return;
      }

      setCsvLoading(false);
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

    if (csvPresent && (csvLoading || csvText === undefined)) {
      return;
    }

    const csvResult = csvPresent ? parseBatchCsv(csvText ?? '', selectedFiles) : undefined;
    if (csvResult?.errors.length) {
      setCsvErrors(csvResult.errors);
      return;
    }

    const jobs = csvResult
      ? [...csvResult.matched, ...triageJobsFor(csvResult.unmatchedFiles)]
      : triageJobsFor(selectedFiles);

    retireActiveGeneration();
    const queue = createReviewQueue(
      jobs,
      queueWorkerFromExtractor(extractFromImage),
      BATCH_WORKER_COUNT,
    );
    const generation: QueueGeneration = { queue, activeOperations: 0 };
    activeGenerationRef.current = generation;
    setItems([...queue.items]);
    setFilter('all');
    setFilenameQuery('');
    setExpandedEvidenceId(undefined);

    void trackQueueWork(generation, () => queue.start());
  };

  const retry = (id: string): void => {
    const generation = activeGenerationRef.current;
    if (!generation) {
      return;
    }

    void trackQueueWork(generation, () => generation.queue.retry(id));
  };

  const retryWithFocus = (id: string): void => {
    const generation = activeGenerationRef.current;
    if (!generation) {
      return;
    }

    setReturnFocusTarget({ itemId: id, action: 'retry' });
    void trackQueueWork(generation, () => {
      const retryWork = generation.queue.retry(id);
      syncItems(generation);
      return retryWork;
    });
  };

  const updateBatchCandidate = useCallback(
    (field: CandidateField, value: string): void => {
      const itemId = fullReviewItemId;
      if (!itemId) {
        return;
      }

      setItems((current) => {
        const item = current.find((candidate) => candidate.id === itemId);
        if (!item) {
          return current;
        }

        item.extraction = setManualCandidate(item.extraction ?? {}, field, value);
        item.manualEvidenceLocks = { ...item.manualEvidenceLocks, [field]: true };
        revalidateItem(item);

        return [...current];
      });
    },
    [fullReviewItemId],
  );

  const clearBatchCandidate = useCallback(
    (field: CandidateField): void => {
      const itemId = fullReviewItemId;
      if (!itemId) {
        return;
      }

      setItems((current) => {
        const item = current.find((candidate) => candidate.id === itemId);
        if (!item) {
          return current;
        }

        item.extraction = clearManualCandidate(item.extraction ?? {}, field);
        item.manualEvidenceLocks = { ...item.manualEvidenceLocks, [field]: true };
        revalidateItem(item);

        return [...current];
      });
    },
    [fullReviewItemId],
  );

  const updateBatchReviewFlags = useCallback(
    (flags: Partial<ReviewFlags>): void => {
      const itemId = fullReviewItemId;
      if (!itemId) {
        return;
      }

      setItems((current) => {
        const item = current.find((candidate) => candidate.id === itemId);
        if (!item) {
          return current;
        }

        item.reviewFlags = { ...item.reviewFlags, ...flags };
        revalidateItem(item);

        return [...current];
      });
    },
    [fullReviewItemId],
  );

  const openFullReview = (id: string): void => {
    setReturnFocusTarget(undefined);
    setFullReviewItemId(id);
  };

  const closeFullReview = (): void => {
    if (fullReviewItemId) {
      setReturnFocusTarget({ itemId: fullReviewItemId, action: 'manual' });
    }
    setFullReviewItemId(undefined);
  };

  const clearBatch = (): void => {
    retireActiveGeneration();
    csvRequestRef.current += 1;
    selectedFilesRef.current = [];
    setIsProcessing(false);
    setItems([]);
    setSelectedFiles([]);
    setCsvPresent(false);
    setCsvLoading(false);
    setCsvText(undefined);
    setCsvName(undefined);
    setFileErrors([]);
    setCsvErrors([]);
    setFilter('all');
    setFilenameQuery('');
    setExpandedEvidenceId(undefined);
    setFullReviewItemId(undefined);
    setReturnFocusTarget(undefined);
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
  const errorCount = items.filter((item) => item.status === 'error').length;
  const manualReviewCount = items.filter((item) => item.status === 'manual_review_required').length;
  const hasQueue = items.length > 0;
  const hasBatchData = hasQueue || selectedFiles.length > 0 || csvPresent;
  const measuredDurations = items
    .map((item) => item.durationMs)
    .filter((duration): duration is number => duration !== undefined);
  const averageDurationMs = measuredDurations.length > 0
    ? measuredDurations.reduce((total, duration) => total + duration, 0) /
      measuredDurations.length
    : undefined;
  const remainingEstimate = isProcessing && averageDurationMs !== undefined
    ? formatEstimate(
        (averageDurationMs * (items.length - processedCount)) / BATCH_WORKER_COUNT,
      )
    : undefined;
  const errorSummary = errorCount > 0
    ? `${errorCount} extraction error${errorCount === 1 ? '' : 's'} need${errorCount === 1 ? 's' : ''} attention.`
    : undefined;
  const manualReviewSummary = manualReviewCount > 0
    ? `${manualReviewCount} label${manualReviewCount === 1 ? '' : 's'} require${manualReviewCount === 1 ? 's' : ''} manual review.`
    : undefined;
  const batchProgressSummary = errorSummary || manualReviewSummary
    ? [errorSummary, manualReviewSummary].filter(Boolean).join(' ')
    : isProcessing
      ? averageDurationMs !== undefined
        ? `Two local workers are processing label evidence — averaging ${formatSeconds(averageDurationMs)} per label, ${remainingEstimate} remaining.`
        : 'Two local workers are processing label evidence.'
      : 'Two local workers maximum';
  const fullReviewItem = items.find((item) => item.id === fullReviewItemId);

  if (fullReviewItem) {
    return (
      <BatchFullReview
        key={fullReviewItem.id}
        item={fullReviewItem}
        onBack={closeFullReview}
        onRetry={retry}
        onCorrectCandidate={updateBatchCandidate}
        onClearCandidate={clearBatchCandidate}
        onUpdateFlags={updateBatchReviewFlags}
      />
    );
  }

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
        {hasBatchData ? (
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
                aria-invalid={fileErrors.length > 0 ? true : undefined}
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
            <a className="batch-template-link" href="/batch-template.csv" download>
              Download starter CSV
            </a>
            <a className="batch-template-link" href="/demo/old-tom-bourbon.jpg" download>
              Download sample label image
            </a>
            <p className="batch-csv-panel__schema">
              For validation, include{' '}
              <code>
                filename, brandName, classType, abv, netContents, producerAddress, isImported
              </code>.
              {' '}Use <code>proof</code> when applicable and <code>countryOfOrigin</code> for
              {' '}imported products.
            </p>
            <label className="button button--secondary file-control">
              Optional application CSV
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void chooseCsv(event)}
                aria-describedby={csvErrors.length > 0 ? 'batch-csv-errors' : undefined}
                aria-invalid={csvErrors.length > 0 ? true : undefined}
              />
            </label>
            {csvName ? (
              <p className="selected-file" aria-live="polite">
                {csvLoading ? `Reading ${csvName}…` : `Ready: ${csvName}`}
              </p>
            ) : null}
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
            disabled={
              isProcessing ||
              selectedFiles.length === 0 ||
              csvLoading ||
              (csvPresent && csvText === undefined) ||
              csvErrors.length > 0
            }
          >
            {isProcessing ? 'Batch review in progress' : 'Begin batch review'}
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Review queue" eyebrow="02 / Evidence status" className="batch-results">
        <div className="batch-toolbar">
          <div
            className="batch-progress"
            role="status"
            aria-label="Batch review progress"
            aria-live="polite"
            aria-atomic="true"
          >
            <strong>{processedCount} of {items.length} processed</strong>
            <span>{batchProgressSummary}</span>
          </div>
          <div className="batch-filters">
            <label>
              Show
              <select
                ref={queueFilterRef}
                value={filter}
                onChange={(event) => setFilter(event.target.value as QueueFilter)}
              >
                <option value="all">All labels</option>
                <option value="mismatch">Mismatches</option>
                <option value="needs_review">Needs review</option>
                <option value="unreadable">Unreadable</option>
                <option value="match">Matches</option>
                <option value="extracted_pending_application">Needs application data</option>
                <option value="manual_review_required">Manual review required</option>
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
            <div
              className="batch-table-wrap"
              role="region"
              aria-label="Batch review results table. Scroll horizontally to review all columns."
              tabIndex={0}
            >
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
                    const canViewEvidence = processedStatuses.has(item.status);
                    const requiresManualReview = item.status === 'manual_review_required';
                    const canOpenManualReview = Boolean(item.isManualEvidence) && (
                      requiresManualReview ||
                      item.status === 'error' ||
                      (item.status === 'extracted_pending_application' && !item.application)
                    );
                    const isEvidenceOpen = expandedEvidenceId === item.id;
                    return (
                      <Fragment key={item.id}>
                        <tr>
                          <th scope="row">
                            <span className="batch-file-name">{item.name}</span>
                            <span className="batch-file-meta">{formatBytes(item.size)}</span>
                          </th>
                          <td>
                            {statusFor(item)}
                            {item.error ? (
                              <p className="batch-row-error" id={errorDescriptionIdFor(item)}>
                                {item.error}
                              </p>
                            ) : null}
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
                            <div className="batch-row-actions">
                              {canViewEvidence ? (
                                <button
                                  type="button"
                                  className="text-button"
                                  aria-expanded={isEvidenceOpen}
                                  aria-controls={
                                    isEvidenceOpen ? evidenceIdFor(item) : undefined
                                  }
                                  onClick={() => {
                                    setExpandedEvidenceId((current) =>
                                      current === item.id ? undefined : item.id,
                                    );
                                  }}
                                >
                                  {isEvidenceOpen
                                    ? `Hide evidence for ${item.name}`
                                    : `View evidence for ${item.name}`}
                                </button>
                              ) : null}
                              {item.status === 'ready' && item.application && item.extraction ? (
                                <button
                                  ref={(element) => {
                                    fullReviewTriggerRefs.current[item.id] = element;
                                  }}
                                  type="button"
                                  className="text-button"
                                  onClick={() => openFullReview(item.id)}
                                  aria-label={`Open full review for ${item.name}`}
                                >
                                  Open full review
                                </button>
                              ) : null}
                              {canOpenManualReview ? (
                                <button
                                  ref={(element) => {
                                    fullReviewTriggerRefs.current[item.id] = element;
                                  }}
                                  type="button"
                                  className="text-button"
                                  onClick={() => openFullReview(item.id)}
                                  aria-label={`Open manual review for ${item.name}`}
                                >
                                  Open manual review
                                </button>
                              ) : null}
                              {requiresManualReview && activeGenerationRef.current ? (
                                <button
                                  ref={(element) => {
                                    retryTriggerRefs.current[item.id] = element;
                                  }}
                                  type="button"
                                  className="text-button"
                                  onClick={() => retryWithFocus(item.id)}
                                  aria-label={`Retry OCR for ${item.name}`}
                                >
                                  Retry OCR
                                </button>
                              ) : null}
                              {item.status === 'error' && activeGenerationRef.current ? (
                                <button
                                  ref={(element) => {
                                    retryTriggerRefs.current[item.id] = element;
                                  }}
                                  type="button"
                                  className="text-button"
                                  onClick={() => retry(item.id)}
                                  aria-label={`Retry ${item.name}`}
                                >
                                  Retry
                                </button>
                              ) : null}
                              {!canViewEvidence && !(item.status === 'error' && activeGenerationRef.current) ? (
                                <span className="muted">—</span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {isEvidenceOpen ? (
                          <tr className="batch-evidence-row">
                            <td colSpan={6}><BatchEvidence item={item} /></td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="batch-empty-state" role="status">
              <QueueEmptyIllustration />
              <p className="eyebrow">No matching labels</p>
              <h3>Adjust the filters to see another review result.</h3>
            </div>
          )
        ) : (
          <div className="batch-empty-state" role="status">
            <QueueEmptyIllustration />
            <p className="eyebrow">Ready when you are</p>
            <h3>Your local review queue will appear here.</h3>
            <p>Choose label images above, then begin a batch to see each item arrive as it completes.</p>
          </div>
        )}
      </SectionCard>
    </section>
  );
}
