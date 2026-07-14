import Tesseract from 'tesseract.js';
import { createCandidateConfidenceResolver } from './confidence';
import { extractFromText } from './parser';
import type {
  ExtractFromImage,
  ExtractionJobResult,
  ExtractionProgress,
  ProgressListener,
} from './types';

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2_000;
const MAX_CONCURRENT_WORKERS = 2;
const LOCAL_OCR_PATH = '/ocr/';

export const WORKER_INITIALIZATION_TIMEOUT_MS = 10_000;
export const OCR_DEADLINE_MS = 5_000;
export type WorkerFactory = typeof Tesseract.createWorker;
type OcrWorker = Awaited<ReturnType<WorkerFactory>>;

let activeWorkers = 0;
const waitingForWorker: WorkerSlotRequest[] = [];

export interface PreparedImage {
  image: HTMLCanvasElement;
  thumbnailUrl: string;
}

export type ImagePreparer = (file: File) => Promise<PreparedImage>;

export interface ExtractFromImageDependencies {
  createWorker?: WorkerFactory;
  prepareImage?: ImagePreparer;
  initializationTimeoutMs?: number;
}

class ImageInputError extends Error {}

class OcrCancellationError extends Error {}

interface WorkerSlotRequest {
  promise: Promise<boolean>;
  grant(): boolean;
  cancel(): void;
}

const clampProgress = (value: number): number => Math.max(0, Math.min(1, value));

const acquireWorker = (): WorkerSlotRequest => {
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

      const waitingIndex = waitingForWorker.indexOf(request);
      if (waitingIndex >= 0) {
        waitingForWorker.splice(waitingIndex, 1);
      }
    },
  };

  if (activeWorkers < MAX_CONCURRENT_WORKERS) {
    activeWorkers += 1;
    request.grant();
  } else {
    waitingForWorker.push(request);
  }

  return request;
};

const releaseWorker = (): void => {
  while (waitingForWorker.length > 0) {
    const next = waitingForWorker.shift()!;
    if (next.grant()) {
      return;
    }
  }

  activeWorkers -= 1;
};

const loadImageElement = async (file: File): Promise<HTMLImageElement> => {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The image could not be decoded.'));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const imageSourceFor = async (
  file: File,
): Promise<ImageBitmap | HTMLImageElement> => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Older browsers may not support the orientation option. The Image fallback
      // still uses the browser's normal EXIF handling where it is available.
    }
  }

  return loadImageElement(file);
};

export const prepareImage = async (file: File): Promise<PreparedImage> => {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new ImageInputError('Upload a JPEG, PNG, or WebP image.');
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageInputError('Images must be 10 MB or smaller.');
  }

  const source = await imageSourceFor(file);

  try {
    const sourceWidth =
      'naturalWidth' in source ? source.naturalWidth : source.width;
    const sourceHeight =
      'naturalHeight' in source ? source.naturalHeight : source.height;

    if (!sourceWidth || !sourceHeight) {
      throw new Error('The image could not be decoded.');
    }

    const longestEdge = Math.max(sourceWidth, sourceHeight);
    const scale = longestEdge > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longestEdge : 1;
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('The image could not be prepared.');
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(source, 0, 0, width, height);

    return {
      image: canvas,
      thumbnailUrl: canvas.toDataURL('image/jpeg', 0.84),
    };
  } finally {
    (source as ImageBitmap).close?.();
  }
};

const reportWorkerProgress = (onProgress: ProgressListener) =>
  (message: { status?: string; progress?: number }): void => {
    const phase: ExtractionProgress['phase'] = message.status
      ?.toLowerCase()
      .includes('recognizing')
      ? 'reading'
      : 'preparing';

    onProgress({
      phase,
      value: clampProgress(message.progress ?? 0),
    });
  };

const unreadableResult = (thumbnailUrl?: string): ExtractionJobResult => ({
  extraction: {},
  rawText: '',
  thumbnailUrl,
  error: 'unreadable',
  source: 'ocr',
});

const inputErrorResult = (
  error: ImageInputError,
  thumbnailUrl?: string,
): ExtractionJobResult => ({
  extraction: {},
  rawText: '',
  thumbnailUrl,
  error: error.message,
  source: 'ocr',
});

const cancelledResult = (thumbnailUrl?: string): ExtractionJobResult => ({
  extraction: {},
  rawText: '',
  thumbnailUrl,
  error: 'cancelled',
  source: 'ocr',
});

const deadlineExceededResult = (thumbnailUrl?: string): ExtractionJobResult => ({
  extraction: {},
  rawText: '',
  thumbnailUrl,
  error: 'deadline-exceeded',
  source: 'ocr',
});

const terminateWorker = async (worker: OcrWorker): Promise<boolean> => {
  try {
    await worker.terminate();
    return true;
  } catch {
    // A failed worker is already represented as an unreadable result.
    return false;
  }
};

interface ListenerRef {
  current?: ProgressListener;
}

interface PooledWorker {
  worker: OcrWorker;
  listenerRef: ListenerRef;
  broken: boolean;
  retired: boolean;
  retirement?: Promise<boolean>;
}

interface WorkerInitialization {
  result: Promise<PooledWorker>;
  settled: Promise<void>;
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

interface CancellationRace<T> {
  promise: Promise<T>;
  cancel(): void;
}

const raceWithCancellation = <T>(operation: Promise<T>): CancellationRace<T> => {
  let cancelled = false;
  let rejectCancellation!: (reason: OcrCancellationError) => void;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });

  return {
    promise: Promise.race([operation, cancellation]),
    cancel: () => {
      if (!cancelled) {
        cancelled = true;
        rejectCancellation(new OcrCancellationError());
      }
    },
  };
};

const initializeWorker = (
  createWorker: WorkerFactory,
  listenerRef: ListenerRef,
  initializationTimeoutMs: number,
  signal?: AbortSignal,
): WorkerInitialization => {
  let resolveResult!: (pooled: PooledWorker) => void;
  let rejectResult!: (reason: Error) => void;
  const result = new Promise<PooledWorker>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  let resolveSettled!: () => void;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  let resultSettled = false;
  let factoryStarted = false;
  let settlementComplete = false;
  let pooled: PooledWorker | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortInitialization: (() => void) | undefined;

  const clearInitializationResources = (): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    if (abortInitialization) {
      signal?.removeEventListener('abort', abortInitialization);
    }
  };

  const completeSettlement = (): void => {
    if (settlementComplete) {
      return;
    }

    settlementComplete = true;
    resolveSettled();
  };

  const rejectInitialization = (reason: unknown): boolean => {
    if (resultSettled) {
      return false;
    }

    resultSettled = true;
    listenerRef.current = undefined;
    clearInitializationResources();
    rejectResult(
      reason instanceof Error
        ? reason
        : new Error('OCR worker initialization failed.'),
    );
    return true;
  };

  const resolveInitialization = (worker: OcrWorker): void => {
    if (resultSettled) {
      void terminateWorker(worker).then((terminated) => {
        if (terminated) {
          completeSettlement();
        }
      });
      return;
    }

    resultSettled = true;
    clearInitializationResources();
    pooled = { worker, listenerRef, broken: false, retired: false };
    resolveResult(pooled);
    completeSettlement();
  };

  const rejectFactory = (reason: unknown): void => {
    rejectInitialization(reason);
    completeSettlement();
  };

  abortInitialization = () => {
    if (rejectInitialization(new OcrCancellationError()) && !factoryStarted) {
      completeSettlement();
    }
  };

  if (signal?.aborted) {
    abortInitialization();
    return { result, settled };
  }

  signal?.addEventListener('abort', abortInitialization, { once: true });

  timeoutId = setTimeout(
    () => rejectInitialization(new Error('OCR worker initialization timed out.')),
    initializationTimeoutMs,
  );

  try {
    factoryStarted = true;
    void createWorker('eng', undefined, {
      workerPath: `${LOCAL_OCR_PATH}worker.min.js`,
      corePath: LOCAL_OCR_PATH,
      langPath: LOCAL_OCR_PATH,
      gzip: true,
      workerBlobURL: false,
      logger: (message) => {
        const listener = listenerRef.current;
        if (listener) {
          reportWorkerProgress(listener)(message);
        }
      },
      errorHandler: (reason) => {
        if (!resultSettled) {
          rejectInitialization(reason);
          return;
        }

        if (pooled) {
          pooled.broken = true;
        }
      },
    }).then(resolveInitialization, rejectFactory);
  } catch (error) {
    rejectFactory(error);
  }

  return { result, settled };
};

const releaseAfterInitialization = (
  initialization?: WorkerInitialization,
  retirement?: Promise<boolean>,
): void => {
  if (!initialization && !retirement) {
    releaseWorker();
    return;
  }

  void Promise.all([
    initialization?.settled,
    retirement ?? Promise.resolve(true),
  ]).then(([, retired]) => {
    if (retired) {
      releaseWorker();
    }
  });
};

export interface OcrEngine {
  extract: ExtractFromImage;
  prewarm(): Promise<void>;
}

export const createOcrEngine = (
  dependencies: ExtractFromImageDependencies = {},
): OcrEngine => {
  const createWorker = dependencies.createWorker ?? Tesseract.createWorker;
  const imagePreparer = dependencies.prepareImage ?? prepareImage;
  const initializationTimeoutMs =
    dependencies.initializationTimeoutMs ?? WORKER_INITIALIZATION_TIMEOUT_MS;
  // Initialized workers are reused across extractions: worker boot, WASM
  // compilation, and language-data loading are paid once per slot, not per label.
  const idleWorkers: PooledWorker[] = [];

  const retireWorker = (pooled: PooledWorker): Promise<boolean> => {
    if (!pooled.retirement) {
      pooled.retired = true;
      pooled.listenerRef.current = undefined;
      const idleIndex = idleWorkers.indexOf(pooled);
      if (idleIndex >= 0) {
        idleWorkers.splice(idleIndex, 1);
      }
      pooled.retirement = terminateWorker(pooled.worker);
    }

    return pooled.retirement;
  };

  const takeIdleWorker = (): PooledWorker | undefined => {
    let pooled = idleWorkers.pop();

    while (pooled) {
      if (!pooled.broken && !pooled.retired) {
        return pooled;
      }

      retireWorker(pooled);
      pooled = idleWorkers.pop();
    }

    return undefined;
  };

  const warmOneWorker = async (): Promise<void> => {
    const workerSlotRequest = acquireWorker();
    const workerSlotAcquired = await workerSlotRequest.promise;
    let pooled: PooledWorker | undefined;
    let initialization: WorkerInitialization | undefined;
    let reusable = false;

    try {
      if (!workerSlotAcquired) {
        return;
      }

      pooled = takeIdleWorker();
      if (!pooled) {
        initialization = initializeWorker(
          createWorker,
          { current: undefined },
          initializationTimeoutMs,
        );
        pooled = await initialization.result;
      }

      if (
        !pooled.broken &&
        !pooled.retired &&
        idleWorkers.length < MAX_CONCURRENT_WORKERS
      ) {
        pooled.listenerRef.current = undefined;
        idleWorkers.push(pooled);
        reusable = true;
      }
    } finally {
      if (pooled && !reusable) {
        retireWorker(pooled);
      }

      if (workerSlotAcquired) {
        releaseAfterInitialization(initialization, pooled?.retirement);
      }
    }
  };

  let warming: Promise<void> | undefined;
  const prewarm = (): Promise<void> => {
    if (warming) {
      return warming;
    }

    warming = warmOneWorker().finally(() => {
      warming = undefined;
    });
    return warming;
  };

  const extract: ExtractFromImage = async (file, onProgress, options) => {
    const startedAt = now();
    let preparationMs: number | undefined;
    let pooled: PooledWorker | undefined;
    let thumbnailUrl: string | undefined;
    let workerSlotRequest: WorkerSlotRequest | undefined;
    let workerSlotAcquired = false;
    let initialization: WorkerInitialization | undefined;
    let completed = false;
    let cancelPreparation: (() => void) | undefined;
    let cancelRecognition: (() => void) | undefined;
    type TerminalCause = 'cancelled' | 'deadline-exceeded';
    const deadlineMs = options?.deadlineMs === undefined
      ? OCR_DEADLINE_MS
      : options.deadlineMs;
    const internalAbort = new AbortController();
    let terminalCause: TerminalCause | undefined;

    const isAborted = (): boolean => terminalCause !== undefined;
    const terminalResult = (): ExtractionJobResult =>
      terminalCause === 'deadline-exceeded'
        ? deadlineExceededResult(thumbnailUrl)
        : cancelledResult(thumbnailUrl);
    const finishWith = (cause: TerminalCause): void => {
      if (terminalCause) {
        return;
      }

      terminalCause = cause;
      internalAbort.abort();
      workerSlotRequest?.cancel();
      if (pooled) {
        retireWorker(pooled);
      }
      cancelPreparation?.();
      cancelRecognition?.();
    };
    const onCallerAbort = (): void => finishWith('cancelled');

    options?.signal?.addEventListener('abort', onCallerAbort, { once: true });
    if (options?.signal?.aborted) {
      onCallerAbort();
    }
    const deadlineTimer = deadlineMs === null
      ? undefined
      : setTimeout(() => finishWith('deadline-exceeded'), deadlineMs);

    try {
      if (isAborted()) {
        return terminalResult();
      }

      onProgress({ phase: 'preparing', value: 0 });
      if (isAborted()) {
        return terminalResult();
      }

      const preparation = raceWithCancellation(imagePreparer(file));
      cancelPreparation = preparation.cancel;
      if (isAborted()) {
        cancelPreparation();
      }
      const prepared = await preparation.promise;
      cancelPreparation = undefined;
      thumbnailUrl = prepared.thumbnailUrl;
      preparationMs = now() - startedAt;

      if (isAborted()) {
        return terminalResult();
      }

      const workerWaitStartedAt = now();
      workerSlotRequest = acquireWorker();
      if (isAborted()) {
        workerSlotRequest.cancel();
      }
      workerSlotAcquired = await workerSlotRequest.promise;
      workerSlotRequest = undefined;

      if (!workerSlotAcquired || isAborted()) {
        return terminalResult();
      }

      pooled = takeIdleWorker();
      if (pooled) {
        pooled.listenerRef.current = onProgress;
      } else {
        initialization = initializeWorker(
          createWorker,
          { current: onProgress },
          initializationTimeoutMs,
          internalAbort.signal,
        );
        pooled = await initialization.result;
      }

      const workerWaitMs = now() - workerWaitStartedAt;
      if (isAborted()) {
        return terminalResult();
      }

      onProgress({ phase: 'reading', value: 0 });
      if (isAborted()) {
        return terminalResult();
      }

      const recognitionStartedAt = now();
      const recognition = raceWithCancellation(
        pooled.worker.recognize(prepared.image, {}, {
          text: true,
          blocks: true,
          hocr: false,
          tsv: false,
        }),
      );
      cancelRecognition = recognition.cancel;
      if (isAborted()) {
        cancelRecognition();
      }
      const result = await recognition.promise;
      cancelRecognition = undefined;

      if (isAborted()) {
        throw new OcrCancellationError();
      }

      const recognitionMs = now() - recognitionStartedAt;
      const rawText = result.data.text;
      const confidenceFor = createCandidateConfidenceResolver(
        result.data.words ?? [],
        result.data.lines ?? [],
      );

      onProgress({ phase: 'validating', value: 1 });
      if (isAborted()) {
        throw new OcrCancellationError();
      }

      const completedAt = now();
      const totalMs = completedAt - startedAt;
      completed = true;

      return {
        extraction: extractFromText(rawText, confidenceFor),
        rawText,
        thumbnailUrl,
        source: 'ocr',
        timings: {
          preparationMs,
          workerWaitMs,
          recognitionMs,
          totalMs,
        },
        durationMs: totalMs,
      };
    } catch (error) {
      if (terminalCause === 'deadline-exceeded') {
        return deadlineExceededResult(thumbnailUrl);
      }

      if (terminalCause === 'cancelled' || error instanceof OcrCancellationError) {
        return cancelledResult(thumbnailUrl);
      }

      return error instanceof ImageInputError
        ? inputErrorResult(error, thumbnailUrl)
        : unreadableResult(thumbnailUrl);
    } finally {
      options?.signal?.removeEventListener('abort', onCallerAbort);
      if (deadlineTimer !== undefined) {
        clearTimeout(deadlineTimer);
      }
      cancelPreparation = undefined;
      cancelRecognition = undefined;
      workerSlotRequest?.cancel();

      if (pooled) {
        pooled.listenerRef.current = undefined;
        if (
          completed &&
          !isAborted() &&
          !pooled.broken &&
          !pooled.retired &&
          idleWorkers.length < MAX_CONCURRENT_WORKERS
        ) {
          idleWorkers.push(pooled);
        } else {
          retireWorker(pooled);
        }
      }

      if (workerSlotAcquired) {
        releaseAfterInitialization(initialization, pooled?.retirement);
      }
    }
  };

  return { extract, prewarm };
};

export const createExtractFromImage = (
  dependencies: ExtractFromImageDependencies = {},
): ExtractFromImage => createOcrEngine(dependencies).extract;

const defaultEngine = createOcrEngine();
export const extractFromImage = defaultEngine.extract;
export const prewarmOcr = (): Promise<void> => defaultEngine.prewarm();
