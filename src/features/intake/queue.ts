import { validateLabel } from '../../domain/validation';
import type {
  ApplicationData,
  LabelExtraction,
  ReviewFlags,
  VerificationResult,
} from '../../domain/types';
import type { ExtractFromImage, ExtractionJobResult } from '../extraction/types';
import {
  mergeUntouchedOcrEvidence,
  type ManualEvidenceLocks,
} from '../review/manualEvidence';

const MAX_SELECTED_FILES = 300;
const MAX_CONCURRENT_WORKERS = 2;

const createEmptyReviewFlags = (): ReviewFlags => ({
  warningTypographyConfirmed: false,
  warningLegibilityConfirmed: false,
});

interface WorkerSlotRequest {
  promise: Promise<boolean>;
  grant(): boolean;
  cancel(): void;
}

let activeWorkerSlots = 0;
const waitingForWorkerSlot: WorkerSlotRequest[] = [];

export type QueueStatus =
  | 'queued'
  | 'preparing'
  | 'reading'
  | 'validating'
  | 'ready'
  | 'error'
  | 'extracted_pending_application'
  | 'manual_review_required';

export interface QueueJob {
  id: string;
  file: File;
  application?: ApplicationData;
}

export interface QueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  application?: ApplicationData;
  reviewFlags: ReviewFlags;
  status: QueueStatus;
  progress: number;
  result?: VerificationResult;
  extraction?: LabelExtraction;
  rawText?: string;
  source?: ExtractionJobResult['source'];
  thumbnailUrl?: string;
  error?: string;
  durationMs?: number;
  manualEvidenceLocks?: ManualEvidenceLocks;
  isManualEvidence?: boolean;
}

export type QueueWorker = (
  job: QueueJob,
  report: (progress: number, status: QueueStatus) => void,
) => Promise<ExtractionJobResult>;

export interface ReviewQueue {
  items: QueueItem[];
  start(): Promise<void>;
  retry(id: string): Promise<void>;
  clear(): void;
}

interface PendingQueueItem {
  item: QueueItem;
  token: number;
  resolve: () => void;
}

const workerCountFor = (concurrency: number): number => {
  if (!Number.isFinite(concurrency)) {
    return 1;
  }

  return Math.min(
    MAX_CONCURRENT_WORKERS,
    Math.max(1, Math.floor(concurrency)),
  );
};

const acquireWorkerSlot = (): WorkerSlotRequest => {
  let settled = false;
  let resolveRequest!: (acquired: boolean) => void;
  const promise = new Promise<boolean>((resolve) => {
    resolveRequest = resolve;
  });
  let request!: WorkerSlotRequest;

  const settle = (acquired: boolean): boolean => {
    if (settled) {
      return false;
    }

    settled = true;
    resolveRequest(acquired);
    return true;
  };

  request = {
    promise,
    grant: () => settle(true),
    cancel: () => {
      if (!settle(false)) {
        return;
      }

      const waitingIndex = waitingForWorkerSlot.indexOf(request);
      if (waitingIndex >= 0) {
        waitingForWorkerSlot.splice(waitingIndex, 1);
      }
    },
  };

  if (activeWorkerSlots < MAX_CONCURRENT_WORKERS) {
    activeWorkerSlots += 1;
    request.grant();
  } else {
    waitingForWorkerSlot.push(request);
  }

  return request;
};

const releaseWorkerSlot = (): void => {
  while (waitingForWorkerSlot.length > 0) {
    const next = waitingForWorkerSlot.shift()!;
    if (next.grant()) {
      return;
    }
  }

  activeWorkerSlots -= 1;
};

const clampProgress = (progress: number): number =>
  Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));

const isWorkerStatus = (
  status: QueueStatus,
): status is 'preparing' | 'reading' | 'validating' =>
  status === 'preparing' || status === 'reading' || status === 'validating';

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : 'Label extraction failed.';

const releaseObjectUrl = (url: string | undefined): void => {
  if (
    !url?.startsWith('blob:') ||
    typeof URL === 'undefined' ||
    typeof URL.revokeObjectURL !== 'function'
  ) {
    return;
  }

  URL.revokeObjectURL(url);
};

const retainThumbnail = (item: QueueItem, nextThumbnail: string | undefined): void => {
  if (!nextThumbnail || nextThumbnail === item.thumbnailUrl) {
    return;
  }

  releaseObjectUrl(item.thumbnailUrl);
  item.thumbnailUrl = nextThumbnail;
};

const resetForRetry = (item: QueueItem): void => {
  if (item.isManualEvidence) {
    item.status = 'queued';
    item.progress = 0;
    item.result = undefined;
    item.error = undefined;
    item.durationMs = undefined;
    return;
  }

  releaseObjectUrl(item.thumbnailUrl);
  item.status = 'queued';
  item.progress = 0;
  item.result = undefined;
  item.extraction = undefined;
  item.rawText = undefined;
  item.source = undefined;
  item.thumbnailUrl = undefined;
  item.error = undefined;
  item.durationMs = undefined;
};

const discardItem = (item: QueueItem): void => {
  releaseObjectUrl(item.thumbnailUrl);
  item.result = undefined;
  item.extraction = undefined;
  item.rawText = undefined;
  item.source = undefined;
  item.thumbnailUrl = undefined;
  item.error = undefined;
  item.durationMs = undefined;
  item.progress = 0;
};

const mergeOutputEvidence = (
  item: QueueItem,
  output: ExtractionJobResult,
): LabelExtraction => item.isManualEvidence
  ? mergeUntouchedOcrEvidence(
      item.extraction ?? {},
      output.extraction,
      item.manualEvidenceLocks ?? {},
    )
  : output.extraction;

const applySuccessfulOutput = (
  item: QueueItem,
  output: ExtractionJobResult,
): void => {
  item.extraction = mergeOutputEvidence(item, output);
  item.rawText = output.rawText || item.rawText;
  item.source = output.source;
  retainThumbnail(item, output.thumbnailUrl);
};

export const queueWorkerFromExtractor = (
  extract: ExtractFromImage,
): QueueWorker => async (job, report) =>
  extract(job.file, ({ phase, value }) => report(value, phase));

export const createReviewQueue = (
  jobs: QueueJob[],
  worker: QueueWorker,
  concurrency: number,
): ReviewQueue => {
  const workerCount = workerCountFor(concurrency);
  const sourceJobs = new Map<QueueItem, QueueJob>();
  const items = jobs.slice(0, MAX_SELECTED_FILES).map((job) => {
    const item: QueueItem = {
      id: job.id,
      file: job.file,
      name: job.file.name,
      size: job.file.size,
      application: job.application,
      reviewFlags: createEmptyReviewFlags(),
      status: 'queued',
      progress: 0,
    };

    sourceJobs.set(item, job);
    return item;
  });

  const pending: PendingQueueItem[] = [];
  const scheduled = new Map<QueueItem, Promise<void>>();
  const activeTokens = new Map<QueueItem, number>();
  const slotRequests = new Map<QueueItem, WorkerSlotRequest>();
  let activeWorkers = 0;
  let nextToken = 0;
  let cleared = false;

  const run = async (item: QueueItem, token: number): Promise<void> => {
    const isCurrent = (): boolean =>
      !cleared && activeTokens.get(item) === token;
    if (!isCurrent()) {
      return;
    }

    const job = sourceJobs.get(item);
    if (!job) {
      if (isCurrent()) {
        item.status = 'error';
        item.error = 'The queued job is unavailable.';
      }
      return;
    }

    const report = (progress: number, status: QueueStatus): void => {
      if (!isCurrent() || !isWorkerStatus(status)) {
        return;
      }

      item.status = status;
      item.progress = clampProgress(progress);
    };

    item.status = 'preparing';
    item.progress = 0;
    let workerSlotAcquired = false;
    let slotRequest: WorkerSlotRequest | undefined;

    try {
      slotRequest = acquireWorkerSlot();
      slotRequests.set(item, slotRequest);
      workerSlotAcquired = await slotRequest.promise;
      slotRequests.delete(item);
      if (!workerSlotAcquired || !isCurrent()) {
        return;
      }

      const startedAt = Date.now();
      const output = await worker(job, report);
      if (!isCurrent()) {
        releaseObjectUrl(output.thumbnailUrl);
        return;
      }

      item.durationMs = output.durationMs ?? Date.now() - startedAt;

      if (output.error === 'deadline-exceeded') {
        item.extraction = mergeOutputEvidence(item, output);
        item.rawText = output.rawText || item.rawText;
        item.source = output.source;
        retainThumbnail(item, output.thumbnailUrl);
        item.result = undefined;
        item.status = 'manual_review_required';
        item.isManualEvidence = true;
        item.progress = 1;
        item.error = 'OCR stopped after five seconds. Open manual review to inspect the original label.';
        return;
      }

      if (output.error) {
        applySuccessfulOutput(item, output);
        item.status = 'error';
        item.error = output.error;
        return;
      }

      applySuccessfulOutput(item, output);

      if (!item.application) {
        item.status = 'extracted_pending_application';
        item.progress = 1;
        return;
      }

      item.status = 'validating';
      item.result = validateLabel({
        application: item.application,
        extraction: item.extraction ?? {},
        flags: item.reviewFlags,
      });
      item.status = 'ready';
      item.progress = 1;
    } catch (error) {
      if (!isCurrent()) {
        return;
      }

      item.status = 'error';
      item.error = errorMessage(error);
    } finally {
      slotRequests.delete(item);
      if (workerSlotAcquired) {
        releaseWorkerSlot();
      }
    }
  };

  const drain = (): void => {
    if (cleared) {
      return;
    }

    while (activeWorkers < workerCount && pending.length > 0) {
      const next = pending.shift()!;
      activeWorkers += 1;
      activeTokens.set(next.item, next.token);

      void run(next.item, next.token).finally(() => {
        activeTokens.delete(next.item);
        activeWorkers -= 1;
        scheduled.delete(next.item);
        next.resolve();
        drain();
      });
    }
  };

  const schedule = (item: QueueItem): Promise<void> => {
    if (cleared) {
      return Promise.resolve();
    }

    const alreadyScheduled = scheduled.get(item);
    if (alreadyScheduled) {
      return alreadyScheduled;
    }

    const token = ++nextToken;
    const completion = new Promise<void>((resolve) => {
      pending.push({ item, token, resolve });
    });
    scheduled.set(item, completion);
    drain();
    return completion;
  };

  const start = async (): Promise<void> => {
    if (cleared) {
      return;
    }

    await Promise.all(
      items
        .filter((item) => item.status === 'queued' || scheduled.has(item))
        .map((item) => schedule(item)),
    );
  };

  const retry = async (id: string): Promise<void> => {
    if (cleared) {
      return;
    }

    const item = items.find((candidate) => candidate.id === id);
    if (!item) {
      return;
    }

    const alreadyScheduled = scheduled.get(item);
    if (alreadyScheduled) {
      await alreadyScheduled;
      return;
    }

    resetForRetry(item);
    await schedule(item);
  };

  const clear = (): void => {
    if (cleared) {
      return;
    }

    cleared = true;
    for (const request of slotRequests.values()) {
      request.cancel();
    }
    slotRequests.clear();
    activeTokens.clear();

    for (const queued of pending.splice(0)) {
      scheduled.delete(queued.item);
      queued.resolve();
    }
    scheduled.clear();
    sourceJobs.clear();

    for (const item of items) {
      discardItem(item);
    }
    items.splice(0, items.length);
  };

  return { items, start, retry, clear };
};
