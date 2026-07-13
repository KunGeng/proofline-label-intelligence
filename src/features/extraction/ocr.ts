import Tesseract from 'tesseract.js';
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
export type WorkerFactory = typeof Tesseract.createWorker;
type OcrWorker = Awaited<ReturnType<WorkerFactory>>;

let activeWorkers = 0;
const waitingForWorker: Array<() => void> = [];

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

const clampProgress = (value: number): number => Math.max(0, Math.min(1, value));

const acquireWorker = (): Promise<void> =>
  new Promise((resolve) => {
    if (activeWorkers < MAX_CONCURRENT_WORKERS) {
      activeWorkers += 1;
      resolve();
      return;
    }

    waitingForWorker.push(resolve);
  });

const releaseWorker = (): void => {
  const next = waitingForWorker.shift();

  if (next) {
    next();
    return;
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

const terminateWorker = async (worker: OcrWorker): Promise<void> => {
  try {
    await worker.terminate();
  } catch {
    // A failed worker is already represented as an unreadable result.
  }
};

interface ListenerRef {
  current?: ProgressListener;
}

interface PooledWorker {
  worker: OcrWorker;
  listenerRef: ListenerRef;
  broken: boolean;
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const initializeWorker = (
  createWorker: WorkerFactory,
  listenerRef: ListenerRef,
  initializationTimeoutMs: number,
): Promise<PooledWorker> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let pooled: PooledWorker | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const rejectInitialization = (reason: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      reject(
        reason instanceof Error
          ? reason
          : new Error('OCR worker initialization failed.'),
      );
    };

    const resolveInitialization = (worker: OcrWorker): void => {
      if (settled) {
        void terminateWorker(worker);
        return;
      }

      settled = true;

      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      pooled = { worker, listenerRef, broken: false };
      resolve(pooled);
    };

    timeoutId = setTimeout(
      () => rejectInitialization(new Error('OCR worker initialization timed out.')),
      initializationTimeoutMs,
    );

    try {
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
          if (!settled) {
            rejectInitialization(reason);
            return;
          }

          if (pooled) {
            pooled.broken = true;
          }
        },
      }).then(resolveInitialization, rejectInitialization);
    } catch (error) {
      rejectInitialization(error);
    }
  });

export const createExtractFromImage = (
  dependencies: ExtractFromImageDependencies = {},
): ExtractFromImage => {
  const createWorker = dependencies.createWorker ?? Tesseract.createWorker;
  const imagePreparer = dependencies.prepareImage ?? prepareImage;
  const initializationTimeoutMs =
    dependencies.initializationTimeoutMs ?? WORKER_INITIALIZATION_TIMEOUT_MS;
  // Initialized workers are reused across extractions: worker boot, WASM
  // compilation, and language-data loading are paid once per slot, not per label.
  const idleWorkers: PooledWorker[] = [];

  return async (file, onProgress) => {
    const startedAt = now();
    let pooled: PooledWorker | undefined;
    let thumbnailUrl: string | undefined;
    let workerSlotAcquired = false;

    onProgress({ phase: 'preparing', value: 0 });

    try {
      const prepared = await imagePreparer(file);
      thumbnailUrl = prepared.thumbnailUrl;

      await acquireWorker();
      workerSlotAcquired = true;

      pooled = idleWorkers.pop();
      if (pooled) {
        pooled.listenerRef.current = onProgress;
      } else {
        pooled = await initializeWorker(
          createWorker,
          { current: onProgress },
          initializationTimeoutMs,
        );
      }

      onProgress({ phase: 'reading', value: 0 });
      const result = await pooled.worker.recognize(prepared.image);
      const rawText = result.data.text;
      const confidence = clampProgress(result.data.confidence / 100);

      onProgress({ phase: 'validating', value: 1 });

      pooled.listenerRef.current = undefined;
      if (!pooled.broken && idleWorkers.length < MAX_CONCURRENT_WORKERS) {
        idleWorkers.push(pooled);
      } else {
        void terminateWorker(pooled.worker);
      }
      pooled = undefined;

      return {
        extraction: extractFromText(rawText, confidence),
        rawText,
        thumbnailUrl,
        source: 'ocr',
        durationMs: now() - startedAt,
      };
    } catch (error) {
      return error instanceof ImageInputError
        ? inputErrorResult(error, thumbnailUrl)
        : unreadableResult(thumbnailUrl);
    } finally {
      if (pooled) {
        pooled.listenerRef.current = undefined;
        void terminateWorker(pooled.worker);
      }

      if (workerSlotAcquired) {
        releaseWorker();
      }
    }
  };
};

export const extractFromImage = createExtractFromImage();
