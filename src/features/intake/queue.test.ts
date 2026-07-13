import type { ApplicationData, LabelExtraction } from '../../domain/types';
import type { ExtractFromImage } from '../extraction/types';
import { createReviewQueue, queueWorkerFromExtractor } from './queue';

const file = (name: string, type = 'image/png') =>
  new File(['label'], name, { type });

const application: ApplicationData = {
  brandName: 'OLD TOM',
  classType: 'Bourbon Whiskey',
  abv: '45%',
  proof: '90 Proof',
  netContents: '750 mL',
  producerAddress: 'Example, KY',
  isImported: false,
};

const extraction: LabelExtraction = {
  brandName: { value: 'OLD TOM', rawText: 'OLD TOM', confidence: 0.99, source: 'fixture' },
  classType: {
    value: 'Bourbon Whiskey',
    rawText: 'Bourbon Whiskey',
    confidence: 0.99,
    source: 'fixture',
  },
  abv: { value: '45%', rawText: '45%', confidence: 0.99, source: 'fixture' },
  proof: { value: '90 Proof', rawText: '90 Proof', confidence: 0.99, source: 'fixture' },
  netContents: { value: '750 mL', rawText: '750 mL', confidence: 0.99, source: 'fixture' },
  producerAddress: {
    value: 'Example, KY',
    rawText: 'Example, KY',
    confidence: 0.99,
    source: 'fixture',
  },
};

const successfulResult = () => ({
  extraction,
  rawText: 'OLD TOM',
  source: 'fixture' as const,
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

const flushMicrotasks = async (count = 8): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
};

async function exerciseQueue(concurrency: number, count: number) {
  let active = 0;
  let maxActive = 0;
  const queue = createReviewQueue(
    Array.from({ length: count }, (_, index) => ({
      id: String(index),
      file: file(`${index}.png`),
    })),
    async () => {
      active += 1;
      maxActive = Math.max(active, maxActive);
      await Promise.resolve();
      active -= 1;
      return successfulResult();
    },
    concurrency,
  );
  await queue.start();
  return { maxActive };
}

describe('createReviewQueue', () => {
  it('adapts extractFromImage progress into queue worker progress', async () => {
    const extract: ExtractFromImage = async (_file, onProgress) => {
      onProgress({ phase: 'reading', value: 0.5 });
      return successfulResult();
    };
    const report = vi.fn();
    const worker = queueWorkerFromExtractor(extract);

    await worker({ id: 'adapter', file: file('adapter.png') }, report);

    expect(report).toHaveBeenCalledWith(0.5, 'reading');
  });

  it('records a measured extraction duration for processed items', async () => {
    const reportedDuration = 1234;
    const queue = createReviewQueue(
      [
        { id: 'reported', file: file('reported.png') },
        { id: 'measured', file: file('measured.png') },
      ],
      async (job) =>
        job.id === 'reported'
          ? { ...successfulResult(), durationMs: reportedDuration }
          : successfulResult(),
      1,
    );

    await queue.start();

    expect(queue.items[0]?.durationMs).toBe(reportedDuration);
    expect(queue.items[1]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('never starts more jobs than the concurrency cap', async () => {
    const { maxActive } = await exerciseQueue(2, 8);

    expect(maxActive).toBe(2);
  });

  it('hard-caps the worker count at two even when a larger value is requested', async () => {
    const { maxActive } = await exerciseQueue(12, 8);

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('shares the two-worker cap across separate review queues', async () => {
    const releaseWorkers = deferred<void>();
    let active = 0;
    let maxActive = 0;
    const worker = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await releaseWorkers.promise;
      active -= 1;
      return successfulResult();
    };
    const firstQueue = createReviewQueue(
      [
        { id: 'first-1', file: file('first-1.png') },
        { id: 'first-2', file: file('first-2.png') },
      ],
      worker,
      2,
    );
    const secondQueue = createReviewQueue(
      [
        { id: 'second-1', file: file('second-1.png') },
        { id: 'second-2', file: file('second-2.png') },
      ],
      worker,
      2,
    );

    const started = Promise.all([firstQueue.start(), secondQueue.start()]);
    await flushMicrotasks();

    expect(maxActive).toBe(2);
    releaseWorkers.resolve();
    await started;
  });

  it('limits a selected batch to 300 jobs', () => {
    const queue = createReviewQueue(
      Array.from({ length: 301 }, (_, index) => ({
        id: String(index),
        file: file(`${index}.png`),
      })),
      async () => successfulResult(),
      2,
    );

    expect(queue.items).toHaveLength(300);
  });

  it('triages extracted labels without application data without validating them', async () => {
    const queue = createReviewQueue(
      [{ id: 'no-csv', file: file('no-csv.png') }],
      async () => successfulResult(),
      2,
    );

    await queue.start();

    expect(queue.items[0]).toMatchObject({
      status: 'extracted_pending_application',
      extraction,
      rawText: 'OLD TOM',
    });
    expect(queue.items[0]?.result).toBeUndefined();
  });

  it('validates only after a successful extraction when application data exists', async () => {
    const queue = createReviewQueue(
      [{ id: 'with-application', file: file('with-application.png'), application }],
      async (_job, report) => {
        report(0.5, 'reading');
        return successfulResult();
      },
      2,
    );

    await queue.start();

    expect(queue.items[0]).toMatchObject({
      status: 'ready',
      progress: 1,
      result: expect.objectContaining({ overallState: 'unreadable' }),
    });
  });

  it('retains batch application data and empty review flags for a ready item', async () => {
    const job = {
      id: 'retained-application',
      file: file('retained-application.png'),
      application,
    };
    const queue = createReviewQueue([job], async () => successfulResult(), 1);

    await queue.start();

    expect(queue.items[0]).toMatchObject({
      application: job.application,
      reviewFlags: {
        warningTypographyConfirmed: false,
        warningLegibilityConfirmed: false,
      },
    });
  });

  it('keeps worker-returned errors truthful and skips validation', async () => {
    const queue = createReviewQueue(
      [{ id: 'unreadable', file: file('unreadable.png'), application }],
      async () => ({
        extraction: {},
        rawText: '',
        source: 'fixture',
        error: 'The image could not be decoded.',
      }),
      2,
    );

    await queue.start();

    expect(queue.items[0]).toMatchObject({
      status: 'error',
      error: 'The image could not be decoded.',
    });
    expect(queue.items[0]?.result).toBeUndefined();
  });

  it('retries an error item with its original file and replaces its result', async () => {
    let attempts = 0;
    const originalFile = file('retry.png');
    const queue = createReviewQueue(
      [{ id: 'retry', file: originalFile, application }],
      async (job) => {
        attempts += 1;
        expect(job.file).toBe(originalFile);
        if (attempts === 1) {
          throw new Error('Temporary OCR failure');
        }

        return successfulResult();
      },
      2,
    );

    await queue.start();
    await queue.retry('retry');

    expect(attempts).toBe(2);
    expect(queue.items[0]).toMatchObject({ status: 'ready', error: undefined });
  });

  it('queues a retry behind active workers instead of exceeding the two-worker cap', async () => {
    const releaseBlockers = deferred<void>();
    const blockersStarted = deferred<void>();
    let blockerCount = 0;
    let retryAttempts = 0;
    let active = 0;
    let maxActive = 0;
    const queue = createReviewQueue(
      [
        { id: 'retry', file: file('retry.png') },
        { id: 'blocker-1', file: file('blocker-1.png') },
        { id: 'blocker-2', file: file('blocker-2.png') },
      ],
      async (job) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (job.id === 'retry') {
          retryAttempts += 1;
          active -= 1;
          if (retryAttempts === 1) {
            throw new Error('Retry once');
          }
          return successfulResult();
        }

        blockerCount += 1;
        if (blockerCount === 2) {
          blockersStarted.resolve();
        }
        await releaseBlockers.promise;
        active -= 1;
        return successfulResult();
      },
      2,
    );

    const initialStart = queue.start();
    await blockersStarted.promise;
    const retry = queue.retry('retry');
    await flushMicrotasks();

    expect(retryAttempts).toBe(1);
    expect(maxActive).toBe(2);
    releaseBlockers.resolve();
    await Promise.all([initialStart, retry]);

    expect(retryAttempts).toBe(2);
    expect(maxActive).toBe(2);
  });

  it('does not duplicate work when start is called again while an item is scheduled', async () => {
    let calls = 0;
    let resolveWorker!: () => void;
    const workerComplete = new Promise<void>((resolve) => {
      resolveWorker = resolve;
    });
    const queue = createReviewQueue(
      [{ id: 'duplicate-start', file: file('duplicate-start.png') }],
      async () => {
        calls += 1;
        await workerComplete;
        return successfulResult();
      },
      2,
    );

    const firstStart = queue.start();
    const secondStart = queue.start();
    let secondStartSettled = false;
    void secondStart.then(() => {
      secondStartSettled = true;
    });
    await flushMicrotasks();

    expect(secondStartSettled).toBe(false);
    resolveWorker();
    await Promise.all([firstStart, secondStart]);

    expect(calls).toBe(1);
  });

  it('ignores a late progress callback from a completed attempt', async () => {
    let firstReport: ((progress: number, status: 'queued' | 'preparing' | 'reading' | 'validating' | 'ready' | 'error' | 'extracted_pending_application') => void) | undefined;
    let attempts = 0;
    const queue = createReviewQueue(
      [{ id: 'late-progress', file: file('late-progress.png') }],
      async (_job, report) => {
        attempts += 1;
        if (attempts === 1) {
          firstReport = report;
          throw new Error('First attempt failed');
        }

        return successfulResult();
      },
      2,
    );

    await queue.start();
    await queue.retry('late-progress');
    firstReport?.(0.4, 'reading');

    expect(queue.items[0]).toMatchObject({ status: 'extracted_pending_application', progress: 1 });
  });

  it('releases a replaced blob thumbnail during retry', async () => {
    const originalRevoke = URL.revokeObjectURL;
    const revoke = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revoke,
    });

    let attempts = 0;
    const queue = createReviewQueue(
      [{ id: 'thumbnail', file: file('thumbnail.png') }],
      async () => {
        attempts += 1;
        return {
          ...successfulResult(),
          thumbnailUrl: attempts === 1 ? 'blob:old-thumbnail' : 'data:image/jpeg,next',
        };
      },
      2,
    );

    try {
      await queue.start();
      await queue.retry('thumbnail');
      expect(revoke).toHaveBeenCalledWith('blob:old-thumbnail');
    } finally {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevoke,
      });
    }
  });

  it('revokes retained blob thumbnails and removes items when cleared', async () => {
    const originalRevoke = URL.revokeObjectURL;
    const revoke = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revoke,
    });
    const queue = createReviewQueue(
      [{ id: 'clear-thumbnail', file: file('clear-thumbnail.png') }],
      async () => ({ ...successfulResult(), thumbnailUrl: 'blob:retained-thumbnail' }),
      2,
    );

    try {
      await queue.start();
      queue.clear();

      expect(revoke).toHaveBeenCalledWith('blob:retained-thumbnail');
      expect(queue.items).toEqual([]);
    } finally {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevoke,
      });
    }
  });

  it('cancels locally queued work when cleared', async () => {
    const releaseFirstWorker = deferred<void>();
    let firstWorkerStarted!: () => void;
    const firstWorkerStartedPromise = new Promise<void>((resolve) => {
      firstWorkerStarted = resolve;
    });
    const calls: string[] = [];
    const queue = createReviewQueue(
      [
        { id: 'first', file: file('first.png') },
        { id: 'second', file: file('second.png') },
      ],
      async (job) => {
        calls.push(job.id);
        if (job.id === 'first') {
          firstWorkerStarted();
          await releaseFirstWorker.promise;
        }
        return successfulResult();
      },
      1,
    );

    const started = queue.start();
    await firstWorkerStartedPromise;
    queue.clear();
    releaseFirstWorker.resolve();
    await started;

    expect(calls).toEqual(['first']);
    expect(queue.items).toEqual([]);
  });

  it('cancels a job waiting for the shared semaphore when cleared', async () => {
    const releaseHolders = deferred<void>();
    const holdersStarted = deferred<void>();
    let holderCount = 0;
    const holders = createReviewQueue(
      [
        { id: 'holder-1', file: file('holder-1.png') },
        { id: 'holder-2', file: file('holder-2.png') },
      ],
      async () => {
        holderCount += 1;
        if (holderCount === 2) {
          holdersStarted.resolve();
        }
        await releaseHolders.promise;
        return successfulResult();
      },
      2,
    );
    let waitingWorkerCalls = 0;
    const waitingQueue = createReviewQueue(
      [{ id: 'waiting', file: file('waiting.png') }],
      async () => {
        waitingWorkerCalls += 1;
        return successfulResult();
      },
      2,
    );

    const holderStart = holders.start();
    const waitingStart = waitingQueue.start();

    try {
      await holdersStarted.promise;
      await flushMicrotasks();
      waitingQueue.clear();
      let waitingStartSettled = false;
      void waitingStart.then(() => {
        waitingStartSettled = true;
      });
      await flushMicrotasks();

      expect(waitingStartSettled).toBe(true);
      expect(waitingWorkerCalls).toBe(0);
      expect(waitingQueue.items).toEqual([]);
    } finally {
      releaseHolders.resolve();
      await Promise.all([holderStart, waitingStart]);
    }

    expect(waitingWorkerCalls).toBe(0);
  });

  it('ignores and releases a blob result from an active worker after clear', async () => {
    const originalRevoke = URL.revokeObjectURL;
    const revoke = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revoke,
    });
    const releaseWorker = deferred<void>();
    const workerStarted = deferred<void>();
    let report: ((progress: number, status: 'queued' | 'preparing' | 'reading' | 'validating' | 'ready' | 'error' | 'extracted_pending_application') => void) | undefined;
    const queue = createReviewQueue(
      [{ id: 'active-clear', file: file('active-clear.png') }],
      async (_job, workerReport) => {
        report = workerReport;
        workerStarted.resolve();
        await releaseWorker.promise;
        return { ...successfulResult(), thumbnailUrl: 'blob:late-thumbnail' };
      },
      2,
    );

    try {
      const started = queue.start();
      await workerStarted.promise;
      queue.clear();
      report?.(0.5, 'reading');
      releaseWorker.resolve();
      await started;

      expect(queue.items).toEqual([]);
      expect(revoke).toHaveBeenCalledWith('blob:late-thumbnail');
    } finally {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevoke,
      });
    }
  });
});
