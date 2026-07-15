export const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const ACCEPTED_IMAGE_ACCEPT = [...ACCEPTED_IMAGE_TYPES].join(',');
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MIN_RECOMMENDED_LONGEST_EDGE = 1_000;
export const RETAKE_GUIDANCE =
  'A straight-on, evenly lit, glare-free retake may improve OCR.';

export interface ImageDimensions {
  width: number;
  height: number;
}

export type ImageReadinessIssue =
  | 'insufficient-pixels'
  | 'decode-failed';

export interface ImageReadiness {
  blockingError?: string;
  advisory?: ImageReadinessIssue;
  dimensions?: ImageDimensions;
}

type ImageFileMetadata = Pick<File, 'size' | 'type'> & { name?: string };
type ImageErrorContext = 'single' | 'batch';

export const imageInputErrorFor = (
  file: ImageFileMetadata,
  context: ImageErrorContext = 'single',
): string | undefined => {
  const prefix = context === 'batch' && file.name ? `${file.name}: ` : '';

  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return `${prefix}${context === 'batch' ? 'choose' : 'Upload'} a JPEG, PNG, or WebP image.`;
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return `${prefix}${context === 'batch' ? 'images' : 'Images'} must be 10 MB or smaller.`;
  }

  return undefined;
};

const usableDimensions = (width: number, height: number): ImageDimensions => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The image could not be decoded.');
  }

  return { width, height };
};

export const classifyImageReadiness = (
  file: Pick<File, 'size' | 'type'>,
  dimensions?: ImageDimensions | null,
): ImageReadiness => {
  const blockingError = imageInputErrorFor(file);
  if (blockingError) {
    return { blockingError };
  }

  if (dimensions === null) {
    return { blockingError: undefined, advisory: 'decode-failed' };
  }

  if (!dimensions) {
    return { blockingError: undefined, advisory: undefined };
  }

  if (Math.max(dimensions.width, dimensions.height) < MIN_RECOMMENDED_LONGEST_EDGE) {
    return {
      blockingError: undefined,
      advisory: 'insufficient-pixels',
      dimensions,
    };
  }

  return { blockingError: undefined, advisory: undefined, dimensions };
};

const dimensionsFromImageBitmap = async (file: File): Promise<ImageDimensions> => {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  try {
    return usableDimensions(bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
};

const dimensionsFromImageElement = async (file: File): Promise<ImageDimensions> => {
  if (
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof Image === 'undefined'
  ) {
    throw new Error('The image could not be decoded.');
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    return await new Promise<ImageDimensions>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          resolve(usableDimensions(image.naturalWidth, image.naturalHeight));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error('The image could not be decoded.'));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL?.(objectUrl);
  }
};

const inspectImageDimensions = async (file: File): Promise<ImageDimensions> => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await dimensionsFromImageBitmap(file);
    } catch {
      // Some browsers do not support the orientation option. The object-URL
      // fallback remains entirely local to the browser session.
    }
  }

  return dimensionsFromImageElement(file);
};

export const inspectImageReadiness = async (file: File): Promise<ImageReadiness> => {
  const initialReadiness = classifyImageReadiness(file);
  if (initialReadiness.blockingError) {
    return initialReadiness;
  }

  try {
    return classifyImageReadiness(file, await inspectImageDimensions(file));
  } catch {
    return classifyImageReadiness(file, null);
  }
};
