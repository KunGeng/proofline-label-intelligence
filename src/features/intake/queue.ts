import { validateLabel } from '../../domain/validation';
import type {
  ApplicationData,
  LabelExtraction,
  VerificationResult,
} from '../../domain/types';
import type { ExtractFromImage, ExtractionJobResult } from '../extraction/types';

const MAX_SELECTED_FILES = 300;
const MAX_CONCURRENT_WORKERS = 2;
let activeWorkerSlots = 0;
const waitingForWorkerSlot: Array<() => void> = [];

export type QueueStatus =
  | 'queued'
  | 'preparing'
  | 'reading'
  | 'validating'
  | 'ready'
  | 'error'
  | 'extracted_pending_application';

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
  status: QueueStatus;
  progress: number;
  result?: VerificationResult;
  extraction?: LabelExtraction;
  rawText?: string;
  source?: ExtractionJobResult['source'];
  thumbnailUrl?: string;
  error?: string;
}

export type QueueWorker = (
  job: QueueJob,
  report: (progress: number, status: QueueStatus) => void,
) => Promise<ExtractionJobResult>;

export interface ReviewQueue {
  items: QueueItem[];
  start(): Promise<void>;
  retry(id: string): Promise<void>;
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

const acquireWorkerSlot = (): Promise<void> =>
  new Promise((resolve) => {
    if (activeWorkerSlots < MAX_CONCURRENT_WORKERS) {
      activeWorkerSlots += 1;
      resolve();
      return;
    }

    waitingForWorkerSlot.push(resolve);
  });

const releaseWorkerSlot = (): void => {
  const next = waitingForWorkerSlot.shift();
  if (next) {
    next();
    return;
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

const resetForRetry = (item: QueueItem): void => {
  releaseObjectUrl(item.thumbnailUrl);
  item.status = 'queued';
  item.progress = 0;
  item.result = undefined;
  item.extraction = undefined;
  item.rawText = undefined;
  item.source = undefined;
  item.thumbnailUrl = undefined;
  item.error = undefined;
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
      status: 'queued',
      progress: 0,
    };

    sourceJobs.set(item, job);
    return item;
  });

  const pending: PendingQueueItem[] = [];
  const scheduled = new Map<QueueItem, Promise<void>>();
  const activeTokens = new Map<QueueItem, number>();
  let activeWorkers = 0;
  let nextToken = 0;

  const run = async (item: QueueItem, token: number): Promise<void> => {
    const job = sourceJobs.get(item);
    if (!job) {
      item.status = 'error';
      item.error = 'The queued job is unavailable.';
      return;
    }

    const isCurrent = (): boolean => activeTokens.get(item) === token;
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

    try {
      await acquireWorkerSlot();
      workerSlotAcquired = true;
      if (!isCurrent()) {
        return;
      }

      const output = await worker(job, report);
      if (!isCurrent()) {
        return;
      }

      item.extraction = output.extraction;
      item.rawText = output.rawText;
      item.source = output.source;
      item.thumbnailUrl = output.thumbnailUrl;

      if (output.error) {
        item.status = 'error';
        item.error = output.error;
        return;
      }

      if (!job.application) {
        item.status = 'extracted_pending_application';
        item.progress = 1;
        return;
      }

      item.status = 'validating';
      item.result = validateLabel({
        application: job.application,
        extraction: output.extraction,
        flags: { warningTypographyConfirmed: false },
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
      if (workerSlotAcquired) {
        releaseWorkerSlot();
      }
    }
  };

  const drain = (): void => {
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
    await Promise.all(
      items
        .filter((item) => item.status === 'queued' || scheduled.has(item))
        .map((item) => schedule(item)),
    );
  };

  const retry = async (id: string): Promise<void> => {
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

  return { items, start, retry };
};
