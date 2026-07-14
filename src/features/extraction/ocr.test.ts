import type { WorkerFactory } from './ocr';
import type { ExtractionProgress } from './types';
import {
  createExtractFromImage,
  createOcrEngine,
  extractFromImage,
  WORKER_INITIALIZATION_TIMEOUT_MS,
} from './ocr';

type OcrWorker = Awaited<ReturnType<WorkerFactory>>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const preparedImage = async () => ({
  image: document.createElement('canvas'),
  thumbnailUrl: 'data:image/jpeg;base64,fixture',
});

const file = () => new File(['fixture'], 'label.png', { type: 'image/png' });

const waitForWorkerFactory = async (
  createWorker: ReturnType<typeof vi.fn>,
  expectedCalls = 1,
): Promise<void> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (createWorker.mock.calls.length >= expectedCalls) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error(`Worker factory was not called ${expectedCalls} times.`);
};

const waitForMockCall = async (mock: ReturnType<typeof vi.fn>): Promise<void> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (mock.mock.calls.length > 0) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error('Mock was not called.');
};

const flushMicrotasks = async (): Promise<void> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Promise.resolve();
  }
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('OCR engine facade', () => {
  it('warms one reusable worker without recognizing an image', async () => {
    const image = document.createElement('canvas');
    const prepareImage = vi.fn().mockResolvedValue({
      image,
      thumbnailUrl: 'data:image/jpeg;base64,fixture',
    });
    const recognize = vi.fn().mockResolvedValue({
      data: { text: 'OLD TOM DISTILLERY', confidence: 99, words: [], lines: [] },
    });
    const terminate = vi.fn().mockResolvedValue(undefined);
    const worker = { recognize, terminate } as unknown as OcrWorker;
    const workerFactoryMock = vi.fn().mockResolvedValue(worker);
    const engine = createOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage,
    });

    await engine.prewarm();

    expect(workerFactoryMock).toHaveBeenCalledTimes(1);
    expect(prepareImage).not.toHaveBeenCalled();
    expect(recognize).not.toHaveBeenCalled();

    await engine.extract(file(), vi.fn());

    expect(workerFactoryMock).toHaveBeenCalledTimes(1);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(terminate).not.toHaveBeenCalled();
  });

  it('uses word confidence instead of page confidence and requests only needed outputs', async () => {
    const image = document.createElement('canvas');
    const recognize = vi.fn().mockResolvedValue({
      data: {
        text: '45% Alc./Vol.',
        confidence: 99,
        words: [
          { text: '45%', confidence: 96 },
          { text: 'Alc./Vol.', confidence: 62 },
        ],
        lines: [],
      },
    });
    const worker = {
      recognize,
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const engine = createOcrEngine({
      createWorker: vi.fn().mockResolvedValue(worker) as unknown as WorkerFactory,
      prepareImage: vi.fn().mockResolvedValue({
        image,
        thumbnailUrl: 'data:image/jpeg;base64,fixture',
      }),
    });

    const result = await engine.extract(file(), vi.fn());

    expect(result.extraction.abv).toMatchObject({
      value: '45%',
      rawText: '45% Alc./Vol.',
      confidence: 0.62,
    });
    expect(recognize).toHaveBeenCalledWith(image, {}, {
      text: true,
      blocks: true,
      hocr: false,
      tsv: false,
    });
  });

  it('returns measured preparation, worker-wait, recognition, and total timings', async () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(90)
      .mockReturnValueOnce(100);

    const worker = {
      recognize: vi.fn().mockResolvedValue({
        data: { text: 'OLD TOM DISTILLERY', confidence: 99, words: [], lines: [] },
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const engine = createOcrEngine({
      createWorker: vi.fn().mockResolvedValue(worker) as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });

    const result = await engine.extract(file(), vi.fn());

    expect(result.timings).toEqual({
      preparationMs: 20,
      workerWaitMs: 20,
      recognitionMs: 40,
      totalMs: 90,
    });
    expect(result.durationMs).toBe(90);
  });

  it('settles an aborted recognition, retires its worker, and replaces it', async () => {
    const pendingRecognition = new Promise<never>(() => undefined);
    const abortedRecognize = vi.fn().mockReturnValue(pendingRecognition);
    const abortedTerminate = vi.fn().mockResolvedValue(undefined);
    const abortedWorker = {
      recognize: abortedRecognize,
      terminate: abortedTerminate,
    } as unknown as OcrWorker;
    const replacementRecognize = vi.fn().mockResolvedValue({
      data: { text: 'OLD TOM DISTILLERY', confidence: 99, words: [], lines: [] },
    });
    const replacementWorker = {
      recognize: replacementRecognize,
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const workerFactoryMock = vi
      .fn()
      .mockResolvedValueOnce(abortedWorker)
      .mockResolvedValueOnce(replacementWorker);
    const engine = createOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });
    const controller = new AbortController();

    const cancelled = engine.extract(file(), vi.fn(), { signal: controller.signal });
    await waitForMockCall(abortedRecognize);
    controller.abort();

    await expect(cancelled).resolves.toMatchObject({
      extraction: {},
      rawText: '',
      error: 'cancelled',
      source: 'ocr',
    });
    expect(abortedTerminate).toHaveBeenCalledTimes(1);

    await engine.extract(file(), vi.fn());

    expect(workerFactoryMock).toHaveBeenCalledTimes(2);
    expect(replacementRecognize).toHaveBeenCalledTimes(1);
  });

  it('keeps a cancelled unresolved initializer lease quarantined until late cleanup', async () => {
    const cancelledPendingWorker = deferred<OcrWorker>();
    const heldPendingWorker = deferred<OcrWorker>();
    const cancelledTermination = deferred<void>();
    const cancelledLateTerminate = vi.fn().mockReturnValue(cancelledTermination.promise);
    const heldLateTerminate = vi.fn().mockResolvedValue(undefined);
    const cancelledLateWorker = {
      terminate: cancelledLateTerminate,
    } as unknown as OcrWorker;
    const heldLateWorker = { terminate: heldLateTerminate } as unknown as OcrWorker;
    const replacementRecognize = vi.fn().mockResolvedValue({
      data: { text: 'OLD TOM DISTILLERY', confidence: 99, words: [], lines: [] },
    });
    const replacementWorker = {
      recognize: replacementRecognize,
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const workerFactoryMock = vi
      .fn()
      .mockReturnValueOnce(cancelledPendingWorker.promise)
      .mockReturnValueOnce(heldPendingWorker.promise)
      .mockResolvedValueOnce(replacementWorker);
    const engine = createOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });
    const cancelledController = new AbortController();
    const heldController = new AbortController();

    const cancelled = engine.extract(file(), vi.fn(), {
      deadlineMs: null,
      signal: cancelledController.signal,
    });
    const held = engine.extract(file(), vi.fn(), {
      deadlineMs: null,
      signal: heldController.signal,
    });
    let replacement: ReturnType<typeof engine.extract> | undefined;

    try {
      await waitForWorkerFactory(workerFactoryMock, 2);
      cancelledController.abort();

      await expect(cancelled).resolves.toMatchObject({
        error: 'cancelled',
        source: 'ocr',
      });

      replacement = engine.extract(file(), vi.fn(), { deadlineMs: null });
      await flushMicrotasks();
      const factoryCallsBeforeLateCleanup = workerFactoryMock.mock.calls.length;

      expect(factoryCallsBeforeLateCleanup).toBe(2);

      cancelledPendingWorker.resolve(cancelledLateWorker);
      await waitForMockCall(cancelledLateTerminate);
      await flushMicrotasks();
      expect(workerFactoryMock).toHaveBeenCalledTimes(2);

      cancelledTermination.resolve();
      await waitForWorkerFactory(workerFactoryMock, 3);
      await expect(replacement).resolves.toMatchObject({
        rawText: 'OLD TOM DISTILLERY',
        source: 'ocr',
      });

      heldController.abort();
      await expect(held).resolves.toMatchObject({ error: 'cancelled', source: 'ocr' });
      heldPendingWorker.resolve(heldLateWorker);
      await waitForMockCall(heldLateTerminate);

      expect(cancelledLateTerminate).toHaveBeenCalledTimes(1);
      expect(heldLateTerminate).toHaveBeenCalledTimes(1);
      expect(workerFactoryMock).toHaveBeenCalledTimes(3);
      expect(replacementRecognize).toHaveBeenCalledTimes(1);
    } finally {
      cancelledTermination.resolve();
      cancelledController.abort();
      heldController.abort();
      cancelledPendingWorker.resolve(cancelledLateWorker);
      heldPendingWorker.resolve(heldLateWorker);
      await Promise.allSettled([
        cancelled,
        held,
        ...(replacement ? [replacement] : []),
      ]);
      await flushMicrotasks();
    }
  });

  it('returns cancelled when validating progress aborts the extraction', async () => {
    const terminate = vi.fn().mockResolvedValue(undefined);
    const worker = {
      recognize: vi.fn().mockResolvedValue({
        data: { text: 'OLD TOM DISTILLERY', confidence: 99, words: [], lines: [] },
      }),
      terminate,
    } as unknown as OcrWorker;
    const engine = createOcrEngine({
      createWorker: vi.fn().mockResolvedValue(worker) as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });
    const controller = new AbortController();
    const onProgress = vi.fn((event: ExtractionProgress) => {
      if (event.phase === 'validating') {
        controller.abort();
      }
    });

    const result = await engine.extract(file(), onProgress, { signal: controller.signal });

    expect(result).toMatchObject({
      error: 'cancelled',
      source: 'ocr',
    });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('stops reporting progress after an aborted initialization', async () => {
    const pendingWorker = deferred<OcrWorker>();
    const lateTerminate = vi.fn().mockResolvedValue(undefined);
    const lateWorker = { terminate: lateTerminate } as unknown as OcrWorker;
    const workerFactoryMock = vi.fn().mockReturnValue(pendingWorker.promise);
    const engine = createOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });
    const controller = new AbortController();
    const onProgress = vi.fn();

    const cancelled = engine.extract(file(), onProgress, { signal: controller.signal });
    await waitForWorkerFactory(workerFactoryMock);
    const logger = workerFactoryMock.mock.calls[0]?.[2]?.logger;

    expect(logger).toEqual(expect.any(Function));

    try {
      controller.abort();
      await expect(cancelled).resolves.toMatchObject({ error: 'cancelled' });
      const callsAfterCancellation = onProgress.mock.calls.length;

      logger?.({ status: 'recognizing text', progress: 0.5 });

      expect(onProgress).toHaveBeenCalledTimes(callsAfterCancellation);
    } finally {
      pendingWorker.resolve(lateWorker);
      await waitForMockCall(lateTerminate);
    }
  });

  it('settles a cancelled extraction while image preparation remains pending', async () => {
    const pendingPreparation = new Promise<Awaited<ReturnType<typeof preparedImage>>>(
      () => undefined,
    );
    const prepareImage = vi.fn().mockReturnValue(pendingPreparation);
    const workerFactoryMock = vi.fn();
    const engine = createOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage,
    });
    const controller = new AbortController();

    const cancelled = engine.extract(file(), vi.fn(), { signal: controller.signal });
    await waitForMockCall(prepareImage);
    const completion = vi.fn();
    void cancelled.then(completion);
    controller.abort();

    await waitForMockCall(completion);

    expect(completion).toHaveBeenCalledWith(expect.objectContaining({
      error: 'cancelled',
      source: 'ocr',
    }));
    expect(workerFactoryMock).not.toHaveBeenCalled();
  });

  it('returns deadline-exceeded while image preparation is pending', async () => {
    vi.useFakeTimers();
    const prepareImage = vi.fn().mockReturnValue(new Promise(() => undefined));
    const engine = createOcrEngine({ prepareImage });

    const result = engine.extract(file(), vi.fn());
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4_999);

    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toMatchObject({
      error: 'deadline-exceeded',
      source: 'ocr',
    });
  });

  it('returns deadline-exceeded while waiting for a worker slot and leaves capacity usable', async () => {
    vi.useFakeTimers();
    const releaseRecognition = deferred<void>();
    const heldWorker = (text: string) => ({
      recognize: vi.fn().mockImplementation(async () => {
        await releaseRecognition.promise;
        return { data: { text, words: [], lines: [] } };
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    }) as unknown as OcrWorker;
    const workerFactoryMock = vi
      .fn()
      .mockResolvedValueOnce(heldWorker('ONE'))
      .mockResolvedValueOnce(heldWorker('TWO'));
    const engine = createOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });

    const first = engine.extract(file(), vi.fn(), { deadlineMs: null });
    const second = engine.extract(file(), vi.fn(), { deadlineMs: null });
    await Promise.resolve();
    const waiting = engine.extract(file(), vi.fn());
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(waiting).resolves.toMatchObject({ error: 'deadline-exceeded' });
    expect(workerFactoryMock).toHaveBeenCalledTimes(2);
    releaseRecognition.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toMatchObject({ rawText: 'ONE', source: 'ocr' });
    expect(firstResult.error).toBeUndefined();
    expect(secondResult).toMatchObject({ rawText: 'TWO', source: 'ocr' });
    expect(secondResult.error).toBeUndefined();

    const afterRelease = await engine.extract(file(), vi.fn());

    expect(afterRelease).toMatchObject({ source: 'ocr' });
    expect(afterRelease.error).toBeUndefined();
    expect(['ONE', 'TWO']).toContain(afterRelease.rawText);
    expect(workerFactoryMock).toHaveBeenCalledTimes(2);
  });

  it('does not replace two deadline-expired workers until late initialization cleanup releases a lease', async () => {
    vi.useFakeTimers();
    const firstPendingWorker = deferred<OcrWorker>();
    const secondPendingWorker = deferred<OcrWorker>();
    const firstTermination = deferred<void>();
    const firstLateTerminate = vi.fn().mockReturnValue(firstTermination.promise);
    const secondLateTerminate = vi.fn().mockResolvedValue(undefined);
    const firstLateWorker = { terminate: firstLateTerminate } as unknown as OcrWorker;
    const secondLateWorker = { terminate: secondLateTerminate } as unknown as OcrWorker;
    const replacementRecognize = vi.fn().mockResolvedValue({
      data: { text: 'OLD TOM', words: [], lines: [] },
    });
    const workerFactoryMock = vi
      .fn()
      .mockReturnValueOnce(firstPendingWorker.promise)
      .mockReturnValueOnce(secondPendingWorker.promise)
      .mockResolvedValueOnce({ recognize: replacementRecognize, terminate: vi.fn() });
    const engine = createOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });

    const firstExpired = engine.extract(file(), vi.fn());
    const secondExpired = engine.extract(file(), vi.fn());
    let replacement: ReturnType<typeof engine.extract> | undefined;

    try {
      await waitForWorkerFactory(workerFactoryMock, 2);
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(firstExpired).resolves.toMatchObject({ error: 'deadline-exceeded' });
      await expect(secondExpired).resolves.toMatchObject({ error: 'deadline-exceeded' });

      replacement = engine.extract(file(), vi.fn(), { deadlineMs: null });
      await flushMicrotasks();
      const factoryCallsBeforeLateCleanup = workerFactoryMock.mock.calls.length;

      expect(factoryCallsBeforeLateCleanup).toBe(2);

      firstPendingWorker.resolve(firstLateWorker);
      await waitForMockCall(firstLateTerminate);
      await flushMicrotasks();
      expect(workerFactoryMock).toHaveBeenCalledTimes(2);

      firstTermination.resolve();
      await waitForWorkerFactory(workerFactoryMock, 3);
      await expect(replacement).resolves.toMatchObject({
        rawText: 'OLD TOM',
        source: 'ocr',
      });

      secondPendingWorker.resolve(secondLateWorker);
      await waitForMockCall(secondLateTerminate);
      expect(firstLateTerminate).toHaveBeenCalledTimes(1);
      expect(secondLateTerminate).toHaveBeenCalledTimes(1);
      expect(replacementRecognize).toHaveBeenCalledTimes(1);
    } finally {
      firstTermination.resolve();
      firstPendingWorker.resolve(firstLateWorker);
      secondPendingWorker.resolve(secondLateWorker);
      await Promise.allSettled([
        firstExpired,
        secondExpired,
        ...(replacement ? [replacement] : []),
      ]);
      await flushMicrotasks();
    }
  });

  it('keeps a deadline lease quarantined when its late worker termination rejects', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { createOcrEngine: createIsolatedOcrEngine } = await import('./ocr');
    const expiredPendingWorker = deferred<OcrWorker>();
    const heldPendingWorker = deferred<OcrWorker>();
    const lateTerminate = vi.fn().mockRejectedValue(new Error('late termination failed'));
    const expiredLateWorker = { terminate: lateTerminate } as unknown as OcrWorker;
    const heldLateTerminate = vi.fn().mockResolvedValue(undefined);
    const heldLateWorker = { terminate: heldLateTerminate } as unknown as OcrWorker;
    const replacementWorker = {
      recognize: vi.fn().mockResolvedValue({
        data: { text: 'OLD TOM', words: [], lines: [] },
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const workerFactoryMock = vi
      .fn()
      .mockReturnValueOnce(expiredPendingWorker.promise)
      .mockReturnValueOnce(heldPendingWorker.promise)
      .mockResolvedValueOnce(replacementWorker);
    const engine = createIsolatedOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });
    const heldController = new AbortController();
    const replacementController = new AbortController();
    const expired = engine.extract(file(), vi.fn());
    const held = engine.extract(file(), vi.fn(), {
      deadlineMs: null,
      signal: heldController.signal,
    });
    let replacement: ReturnType<typeof engine.extract> | undefined;

    try {
      await waitForWorkerFactory(workerFactoryMock, 2);
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(expired).resolves.toMatchObject({
        error: 'deadline-exceeded',
        source: 'ocr',
      });

      expiredPendingWorker.resolve(expiredLateWorker);
      await waitForMockCall(lateTerminate);
      await flushMicrotasks();

      replacement = engine.extract(file(), vi.fn(), {
        deadlineMs: null,
        signal: replacementController.signal,
      });
      await flushMicrotasks();

      expect(workerFactoryMock).toHaveBeenCalledTimes(2);
    } finally {
      heldController.abort();
      replacementController.abort();
      expiredPendingWorker.resolve(expiredLateWorker);
      heldPendingWorker.resolve(heldLateWorker);
      await Promise.allSettled([
        expired,
        held,
        ...(replacement ? [replacement] : []),
      ]);
      await flushMicrotasks();
      vi.resetModules();
    }
  });

  it('keeps a ready-worker lease quarantined when deadline termination rejects', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { createOcrEngine: createIsolatedOcrEngine } = await import('./ocr');
    const expiredRecognition = deferred<{
      data: { text: string; words: []; lines: [] };
    }>();
    const heldRecognition = deferred<{
      data: { text: string; words: []; lines: [] };
    }>();
    const replacementRecognition = deferred<{
      data: { text: string; words: []; lines: [] };
    }>();
    const expiredTerminate = vi.fn().mockRejectedValue(new Error('ready worker termination failed'));
    const heldTerminate = vi.fn().mockResolvedValue(undefined);
    const replacementTerminate = vi.fn().mockResolvedValue(undefined);
    const expiredRecognize = vi.fn().mockReturnValue(expiredRecognition.promise);
    const heldRecognize = vi.fn().mockReturnValue(heldRecognition.promise);
    const replacementRecognize = vi.fn().mockReturnValue(replacementRecognition.promise);
    const expiredWorker = {
      recognize: expiredRecognize,
      terminate: expiredTerminate,
    } as unknown as OcrWorker;
    const heldWorker = {
      recognize: heldRecognize,
      terminate: heldTerminate,
    } as unknown as OcrWorker;
    const replacementWorker = {
      recognize: replacementRecognize,
      terminate: replacementTerminate,
    } as unknown as OcrWorker;
    const workerFactoryMock = vi
      .fn()
      .mockResolvedValueOnce(expiredWorker)
      .mockResolvedValueOnce(heldWorker)
      .mockResolvedValueOnce(replacementWorker);
    const engine = createIsolatedOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });
    const heldController = new AbortController();
    const replacementController = new AbortController();
    const expired = engine.extract(file(), vi.fn());
    const held = engine.extract(file(), vi.fn(), {
      deadlineMs: null,
      signal: heldController.signal,
    });
    let replacement: ReturnType<typeof engine.extract> | undefined;

    try {
      await waitForWorkerFactory(workerFactoryMock, 2);
      await waitForMockCall(expiredRecognize);
      await waitForMockCall(heldRecognize);

      await vi.advanceTimersByTimeAsync(5_000);
      await expect(expired).resolves.toMatchObject({
        error: 'deadline-exceeded',
        source: 'ocr',
      });
      await waitForMockCall(expiredTerminate);

      replacement = engine.extract(file(), vi.fn(), {
        deadlineMs: null,
        signal: replacementController.signal,
      });
      await flushMicrotasks();

      expect(workerFactoryMock).toHaveBeenCalledTimes(2);
    } finally {
      heldController.abort();
      replacementController.abort();
      expiredRecognition.resolve({ data: { text: 'expired', words: [], lines: [] } });
      heldRecognition.resolve({ data: { text: 'held', words: [], lines: [] } });
      replacementRecognition.resolve({ data: { text: 'replacement', words: [], lines: [] } });
      await Promise.allSettled([
        expired,
        held,
        ...(replacement ? [replacement] : []),
      ]);
      await flushMicrotasks();
      vi.resetModules();
    }
  });

  it('retires a worker whose recognition passes the deadline', async () => {
    vi.useFakeTimers();
    const pendingRecognition = deferred<{
      data: { text: string; words: []; lines: [] };
    }>();
    const expiredTerminate = vi.fn().mockResolvedValue(undefined);
    const replacementRecognize = vi.fn().mockResolvedValue({
      data: { text: 'OLD TOM', words: [], lines: [] },
    });
    const engine = createOcrEngine({
      createWorker: vi
        .fn()
        .mockResolvedValueOnce({
          recognize: vi.fn().mockReturnValue(pendingRecognition.promise),
          terminate: expiredTerminate,
        })
        .mockResolvedValueOnce({ recognize: replacementRecognize, terminate: vi.fn() }) as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });

    const expired = engine.extract(file(), vi.fn());
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(expired).resolves.toMatchObject({ error: 'deadline-exceeded' });
    expect(expiredTerminate).toHaveBeenCalledTimes(1);
    await engine.extract(file(), vi.fn(), { deadlineMs: null });
    expect(replacementRecognize).toHaveBeenCalledTimes(1);
  });

  it('uses the first terminal cause when caller cancellation and the deadline race', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const engine = createOcrEngine({
      prepareImage: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });
    const cancelled = engine.extract(file(), vi.fn(), { signal: controller.signal });
    controller.abort();
    await expect(cancelled).resolves.toMatchObject({ error: 'cancelled' });

    const controllerAfterDeadline = new AbortController();
    const deadlineThenAbort = engine.extract(file(), vi.fn(), {
      signal: controllerAfterDeadline.signal,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    controllerAfterDeadline.abort();
    await expect(deadlineThenAbort).resolves.toMatchObject({ error: 'deadline-exceeded' });
  });

  it('clears a completed deadline timer instead of retiring a reusable worker later', async () => {
    vi.useFakeTimers();
    const terminate = vi.fn().mockResolvedValue(undefined);
    const engine = createOcrEngine({
      createWorker: vi.fn().mockResolvedValue({
        recognize: vi.fn().mockResolvedValue({
          data: { text: 'OLD TOM', words: [], lines: [] },
        }),
        terminate,
      }) as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });

    await engine.extract(file(), vi.fn());
    await vi.advanceTimersByTimeAsync(5_000);

    expect(terminate).not.toHaveBeenCalled();
  });
});

describe('extractFromImage worker initialization', () => {
  it('quarantines initialization-timeout leases until late workers are terminated', async () => {
    expect(WORKER_INITIALIZATION_TIMEOUT_MS).toBe(10_000);
    vi.useFakeTimers();

    const firstPendingWorker = deferred<OcrWorker>();
    const secondPendingWorker = deferred<OcrWorker>();
    const firstLateTerminate = vi.fn().mockResolvedValue(undefined);
    const secondLateTerminate = vi.fn().mockResolvedValue(undefined);
    const firstLateWorker = {
      terminate: firstLateTerminate,
    } as unknown as OcrWorker;
    const secondLateWorker = {
      terminate: secondLateTerminate,
    } as unknown as OcrWorker;
    const readyWorker = {
      recognize: vi.fn().mockResolvedValue({
        data: { text: 'OLD TOM DISTILLERY', confidence: 99 },
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const workerFactoryMock = vi
      .fn()
      .mockReturnValueOnce(firstPendingWorker.promise)
      .mockReturnValueOnce(secondPendingWorker.promise)
      .mockResolvedValueOnce(readyWorker);
    const extract = createExtractFromImage({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
      initializationTimeoutMs: 1,
    });

    const first = extract(file(), vi.fn(), { deadlineMs: null });
    const second = extract(file(), vi.fn(), { deadlineMs: null });
    let recovered: ReturnType<typeof extract> | undefined;

    try {
      await waitForWorkerFactory(workerFactoryMock, 2);
      await vi.advanceTimersByTimeAsync(1);

      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult).toMatchObject({ error: 'unreadable', source: 'ocr' });
      expect(secondResult).toMatchObject({ error: 'unreadable', source: 'ocr' });
      expect(workerFactoryMock).toHaveBeenCalledWith(
        'eng',
        undefined,
        expect.objectContaining({ errorHandler: expect.any(Function) }),
      );

      recovered = extract(file(), vi.fn(), { deadlineMs: null });
      await flushMicrotasks();
      const factoryCallsBeforeLateCleanup = workerFactoryMock.mock.calls.length;

      expect(factoryCallsBeforeLateCleanup).toBe(2);

      firstPendingWorker.resolve(firstLateWorker);
      await waitForMockCall(firstLateTerminate);
      await waitForWorkerFactory(workerFactoryMock, 3);

      const recoveredResult = await recovered;
      expect(recoveredResult).toMatchObject({ source: 'ocr' });
      expect(recoveredResult.error).toBeUndefined();
      expect(readyWorker.recognize).toHaveBeenCalledTimes(1);

      secondPendingWorker.resolve(secondLateWorker);
      await waitForMockCall(secondLateTerminate);

      expect(firstLateTerminate).toHaveBeenCalledTimes(1);
      expect(secondLateTerminate).toHaveBeenCalledTimes(1);
    } finally {
      firstPendingWorker.resolve(firstLateWorker);
      secondPendingWorker.resolve(secondLateWorker);
      await Promise.allSettled([
        first,
        second,
        ...(recovered ? [recovered] : []),
      ]);
      await flushMicrotasks();
    }
  });

  it('releases a quarantined deadline lease when its late factory rejects', async () => {
    vi.useFakeTimers();
    const rejectedPendingWorker = deferred<OcrWorker>();
    const heldPendingWorker = deferred<OcrWorker>();
    const heldLateTerminate = vi.fn().mockResolvedValue(undefined);
    const heldLateWorker = { terminate: heldLateTerminate } as unknown as OcrWorker;
    const readyWorker = {
      recognize: vi.fn().mockResolvedValue({
        data: { text: 'OLD TOM DISTILLERY', confidence: 99, words: [], lines: [] },
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const workerFactoryMock = vi
      .fn()
      .mockReturnValueOnce(rejectedPendingWorker.promise)
      .mockReturnValueOnce(heldPendingWorker.promise)
      .mockResolvedValueOnce(readyWorker);
    const engine = createOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });
    const heldController = new AbortController();
    const expired = engine.extract(file(), vi.fn());
    const held = engine.extract(file(), vi.fn(), {
      deadlineMs: null,
      signal: heldController.signal,
    });
    let replacement: ReturnType<typeof engine.extract> | undefined;

    try {
      await waitForWorkerFactory(workerFactoryMock, 2);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(expired).resolves.toMatchObject({ error: 'deadline-exceeded' });

      replacement = engine.extract(file(), vi.fn(), { deadlineMs: null });
      await flushMicrotasks();
      const factoryCallsBeforeLateSettlement = workerFactoryMock.mock.calls.length;

      expect(factoryCallsBeforeLateSettlement).toBe(2);

      rejectedPendingWorker.reject(new Error('late factory rejection'));
      await waitForWorkerFactory(workerFactoryMock, 3);
      await expect(replacement).resolves.toMatchObject({
        rawText: 'OLD TOM DISTILLERY',
        source: 'ocr',
      });

      heldController.abort();
      await expect(held).resolves.toMatchObject({ error: 'cancelled', source: 'ocr' });
      heldPendingWorker.resolve(heldLateWorker);
      await waitForMockCall(heldLateTerminate);
      expect(readyWorker.terminate).not.toHaveBeenCalled();
    } finally {
      heldController.abort();
      rejectedPendingWorker.reject(new Error('late factory rejection'));
      heldPendingWorker.resolve(heldLateWorker);
      await Promise.allSettled([
        expired,
        held,
        ...(replacement ? [replacement] : []),
      ]);
      await flushMicrotasks();
    }
  });

  it('quarantines a timed-out prewarm lease until its late worker is terminated', async () => {
    vi.useFakeTimers();
    const prewarmPendingWorker = deferred<OcrWorker>();
    const heldPendingWorker = deferred<OcrWorker>();
    const prewarmLateTerminate = vi.fn().mockResolvedValue(undefined);
    const heldLateTerminate = vi.fn().mockResolvedValue(undefined);
    const readyWorker = {
      recognize: vi.fn().mockResolvedValue({
        data: { text: 'OLD TOM DISTILLERY', confidence: 99, words: [], lines: [] },
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const workerFactoryMock = vi
      .fn()
      .mockReturnValueOnce(prewarmPendingWorker.promise)
      .mockReturnValueOnce(heldPendingWorker.promise)
      .mockResolvedValueOnce(readyWorker);
    const engine = createOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
      initializationTimeoutMs: 1,
    });
    const heldController = new AbortController();

    const prewarm = engine.prewarm();
    const prewarmOutcome = prewarm.then(
      () => undefined,
      (error: unknown) => error,
    );
    let held: ReturnType<typeof engine.extract> | undefined;
    let replacement: ReturnType<typeof engine.extract> | undefined;

    try {
      await waitForWorkerFactory(workerFactoryMock);
      await vi.advanceTimersByTimeAsync(1);
      await expect(prewarmOutcome).resolves.toMatchObject({
        message: 'OCR worker initialization timed out.',
      });

      held = engine.extract(file(), vi.fn(), {
        deadlineMs: null,
        signal: heldController.signal,
      });
      await waitForWorkerFactory(workerFactoryMock, 2);

      replacement = engine.extract(file(), vi.fn(), { deadlineMs: null });
      await flushMicrotasks();
      const factoryCallsBeforeLateCleanup = workerFactoryMock.mock.calls.length;

      expect(factoryCallsBeforeLateCleanup).toBe(2);

      prewarmPendingWorker.resolve({
        terminate: prewarmLateTerminate,
      } as unknown as OcrWorker);
      await waitForMockCall(prewarmLateTerminate);
      await waitForWorkerFactory(workerFactoryMock, 3);

      await expect(replacement).resolves.toMatchObject({
        rawText: 'OLD TOM DISTILLERY',
        source: 'ocr',
      });

      heldController.abort();
      await expect(held).resolves.toMatchObject({ error: 'cancelled', source: 'ocr' });
      heldPendingWorker.resolve({ terminate: heldLateTerminate } as unknown as OcrWorker);
      await waitForMockCall(heldLateTerminate);

      expect(prewarmLateTerminate).toHaveBeenCalledTimes(1);
      expect(heldLateTerminate).toHaveBeenCalledTimes(1);
    } finally {
      heldController.abort();
      prewarmPendingWorker.resolve({
        terminate: prewarmLateTerminate,
      } as unknown as OcrWorker);
      heldPendingWorker.resolve({ terminate: heldLateTerminate } as unknown as OcrWorker);
      await Promise.allSettled([
        prewarmOutcome,
        ...(held ? [held] : []),
        ...(replacement ? [replacement] : []),
      ]);
      await flushMicrotasks();
    }
  });

  it('turns worker-message failures into unreadable initialization results', async () => {
    const pendingWorker = deferred<OcrWorker>();
    const lateWorker = {
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const workerFactoryMock = vi.fn().mockReturnValue(pendingWorker.promise);
    const createWorker = workerFactoryMock as unknown as WorkerFactory;
    const extract = createExtractFromImage({
      createWorker,
      prepareImage: preparedImage,
      initializationTimeoutMs: 1_000,
    });

    const resultPromise = extract(file(), vi.fn());
    await waitForWorkerFactory(workerFactoryMock);
    const errorHandler = workerFactoryMock.mock.calls[0]?.[2]?.errorHandler;

    expect(errorHandler).toEqual(expect.any(Function));
    errorHandler?.('Missing local language data.');

    await expect(resultPromise).resolves.toMatchObject({
      error: 'unreadable',
      source: 'ocr',
    });

    pendingWorker.resolve(lateWorker);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lateWorker.terminate).toHaveBeenCalledTimes(1);
  });
});

describe('extractFromImage worker reuse', () => {
  it('initializes a worker once, reuses it across extractions, and reports duration', async () => {
    const readyWorker = {
      recognize: vi.fn().mockResolvedValue({
        data: { text: 'OLD TOM DISTILLERY', confidence: 99 },
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const workerFactoryMock = vi.fn().mockResolvedValue(readyWorker);
    const extract = createExtractFromImage({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });

    const firstResult = await extract(file(), vi.fn());
    const secondResult = await extract(file(), vi.fn());

    expect(firstResult.error).toBeUndefined();
    expect(secondResult.error).toBeUndefined();
    expect(firstResult.durationMs).toBeGreaterThanOrEqual(0);
    expect(secondResult.durationMs).toBeGreaterThanOrEqual(0);
    expect(workerFactoryMock).toHaveBeenCalledTimes(1);
    expect(readyWorker.recognize).toHaveBeenCalledTimes(2);
    expect(readyWorker.terminate).not.toHaveBeenCalled();
  });

  it('discards a worker after a recognition failure instead of reusing it', async () => {
    const failingWorker = {
      recognize: vi.fn().mockRejectedValue(new Error('recognition failed')),
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const replacementWorker = {
      recognize: vi.fn().mockResolvedValue({
        data: { text: 'OLD TOM DISTILLERY', confidence: 99 },
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const workerFactoryMock = vi
      .fn()
      .mockResolvedValueOnce(failingWorker)
      .mockResolvedValueOnce(replacementWorker);
    const extract = createExtractFromImage({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });

    const failedResult = await extract(file(), vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(failedResult).toMatchObject({ error: 'unreadable', source: 'ocr' });
    expect(failingWorker.terminate).toHaveBeenCalledTimes(1);

    const recoveredResult = await extract(file(), vi.fn());

    expect(recoveredResult.error).toBeUndefined();
    expect(replacementWorker.recognize).toHaveBeenCalledTimes(1);
    expect(workerFactoryMock).toHaveBeenCalledTimes(2);
  });
});

describe('extractFromImage input validation', () => {
  it('returns the MIME validation error for an unsupported image type', async () => {
    const result = await extractFromImage(
      new File(['fixture'], 'label.gif', { type: 'image/gif' }),
      vi.fn(),
    );

    expect(result).toMatchObject({
      error: 'Upload a JPEG, PNG, or WebP image.',
      source: 'ocr',
    });
  });

  it('returns the maximum-size validation error for oversized images', async () => {
    const result = await extractFromImage(
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'label.png', {
        type: 'image/png',
      }),
      vi.fn(),
    );

    expect(result).toMatchObject({
      error: 'Images must be 10 MB or smaller.',
      source: 'ocr',
    });
  });
});
