import type { WorkerFactory } from './ocr';
import {
  createExtractFromImage,
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
