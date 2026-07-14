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
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

const preparedImage = async () => ({
  image: document.createElement('canvas'),
  thumbnailUrl: 'data:image/jpeg;base64,fixture',
});

const file = () => new File(['fixture'], 'label.png', { type: 'image/png' });

const waitForWorkerFactory = async (
  createWorker: ReturnType<typeof vi.fn>,
): Promise<void> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (createWorker.mock.calls.length > 0) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error('Worker factory was not called.');
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

  it('cancels pending initialization and terminates the worker if it completes late', async () => {
    const pendingWorker = deferred<OcrWorker>();
    const lateTerminate = vi.fn().mockResolvedValue(undefined);
    const lateWorker = { terminate: lateTerminate } as unknown as OcrWorker;
    const replacementRecognize = vi.fn().mockResolvedValue({
      data: { text: 'OLD TOM DISTILLERY', confidence: 99, words: [], lines: [] },
    });
    const replacementWorker = {
      recognize: replacementRecognize,
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const workerFactoryMock = vi
      .fn()
      .mockReturnValueOnce(pendingWorker.promise)
      .mockResolvedValueOnce(replacementWorker);
    const engine = createOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });
    const controller = new AbortController();

    const cancelled = engine.extract(file(), vi.fn(), { signal: controller.signal });
    await waitForWorkerFactory(workerFactoryMock);
    controller.abort();

    await expect(cancelled).resolves.toMatchObject({
      error: 'cancelled',
      source: 'ocr',
    });

    pendingWorker.resolve(lateWorker);
    await waitForMockCall(lateTerminate);

    await engine.extract(file(), vi.fn());

    expect(lateTerminate).toHaveBeenCalledTimes(1);
    expect(workerFactoryMock).toHaveBeenCalledTimes(2);
    expect(replacementRecognize).toHaveBeenCalledTimes(1);
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

  it('terminates a late-initializing worker after the deadline', async () => {
    vi.useFakeTimers();
    const pendingWorker = deferred<OcrWorker>();
    const lateTerminate = vi.fn().mockResolvedValue(undefined);
    const replacementRecognize = vi.fn().mockResolvedValue({
      data: { text: 'OLD TOM', words: [], lines: [] },
    });
    const workerFactoryMock = vi
      .fn()
      .mockReturnValueOnce(pendingWorker.promise)
      .mockResolvedValueOnce({ recognize: replacementRecognize, terminate: vi.fn() });
    const engine = createOcrEngine({
      createWorker: workerFactoryMock as unknown as WorkerFactory,
      prepareImage: preparedImage,
    });

    const expired = engine.extract(file(), vi.fn());
    await waitForWorkerFactory(workerFactoryMock);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(expired).resolves.toMatchObject({ error: 'deadline-exceeded' });

    pendingWorker.resolve({ terminate: lateTerminate } as unknown as OcrWorker);
    await waitForMockCall(lateTerminate);
    await engine.extract(file(), vi.fn(), { deadlineMs: null });
    expect(replacementRecognize).toHaveBeenCalledTimes(1);
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
  it('times out pending workers, releases both slots, and terminates late workers', async () => {
    expect(WORKER_INITIALIZATION_TIMEOUT_MS).toBe(10_000);

    const firstPendingWorker = deferred<OcrWorker>();
    const secondPendingWorker = deferred<OcrWorker>();
    const firstLateWorker = {
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const secondLateWorker = {
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const readyWorker = {
      recognize: vi.fn().mockResolvedValue({
        data: { text: 'OLD TOM DISTILLERY', confidence: 99 },
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    } as unknown as OcrWorker;
    const createWorker = vi
      .fn()
      .mockReturnValueOnce(firstPendingWorker.promise)
      .mockReturnValueOnce(secondPendingWorker.promise)
      .mockResolvedValueOnce(readyWorker) as unknown as WorkerFactory;
    const extract = createExtractFromImage({
      createWorker,
      prepareImage: preparedImage,
      initializationTimeoutMs: 1,
    });

    const [firstResult, secondResult] = await Promise.all([
      extract(file(), vi.fn()),
      extract(file(), vi.fn()),
    ]);

    expect(firstResult).toMatchObject({ error: 'unreadable', source: 'ocr' });
    expect(secondResult).toMatchObject({ error: 'unreadable', source: 'ocr' });
    expect(createWorker).toHaveBeenCalledWith(
      'eng',
      undefined,
      expect.objectContaining({ errorHandler: expect.any(Function) }),
    );

    const recoveredResult = await extract(file(), vi.fn());

    expect(recoveredResult).toMatchObject({ source: 'ocr' });
    expect(recoveredResult.error).toBeUndefined();
    expect(readyWorker.recognize).toHaveBeenCalledTimes(1);

    firstPendingWorker.resolve(firstLateWorker);
    secondPendingWorker.resolve(secondLateWorker);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(firstLateWorker.terminate).toHaveBeenCalledTimes(1);
    expect(secondLateWorker.terminate).toHaveBeenCalledTimes(1);
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
