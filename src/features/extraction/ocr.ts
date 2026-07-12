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

let activeWorkers = 0;
const waitingForWorker: Array<() => void> = [];

export interface PreparedImage {
  image: HTMLCanvasElement;
  thumbnailUrl: string;
}

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
    throw new Error('Upload a JPEG, PNG, or WebP image.');
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Images must be 10 MB or smaller.');
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

export const extractFromImage: ExtractFromImage = async (file, onProgress) => {
  let worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | undefined;
  let thumbnailUrl: string | undefined;
  let workerSlotAcquired = false;

  onProgress({ phase: 'preparing', value: 0 });

  try {
    const prepared = await prepareImage(file);
    thumbnailUrl = prepared.thumbnailUrl;

    await acquireWorker();
    workerSlotAcquired = true;
    worker = await Tesseract.createWorker('eng', undefined, {
      workerPath: `${LOCAL_OCR_PATH}worker.min.js`,
      corePath: LOCAL_OCR_PATH,
      langPath: LOCAL_OCR_PATH,
      gzip: true,
      workerBlobURL: false,
      logger: reportWorkerProgress(onProgress),
    });

    onProgress({ phase: 'reading', value: 0 });
    const result = await worker.recognize(prepared.image);
    const rawText = result.data.text;
    const confidence = clampProgress(result.data.confidence / 100);

    onProgress({ phase: 'validating', value: 1 });

    return {
      extraction: extractFromText(rawText, confidence),
      rawText,
      thumbnailUrl,
      source: 'ocr',
    };
  } catch {
    return unreadableResult(thumbnailUrl);
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // A failed worker is already represented as an unreadable result.
      }
    }

    if (workerSlotAcquired) {
      releaseWorker();
    }
  }
};
