import {
  MIN_RECOMMENDED_LONGEST_EDGE,
  classifyImageReadiness,
  inspectImageReadiness,
} from './imageReadiness';

const imageFile = (name = 'label.png'): File =>
  new File(['label'], name, { type: 'image/png' });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('marks a supported image at the boundary as ready', () => {
  expect(classifyImageReadiness(
    { type: 'image/jpeg', size: 1024 },
    { width: MIN_RECOMMENDED_LONGEST_EDGE, height: 600 },
  )).toMatchObject({ blockingError: undefined, advisory: undefined });
});

it('advises a retake for a small but otherwise valid image', () => {
  expect(classifyImageReadiness(
    { type: 'image/png', size: 1024 },
    { width: 640, height: 480 },
  )).toMatchObject({ advisory: 'insufficient-pixels' });
});

it('keeps an invalid type as a blocking error', () => {
  expect(classifyImageReadiness(
    { type: 'application/pdf', size: 1024 },
  )).toMatchObject({ blockingError: 'Upload a JPEG, PNG, or WebP image.' });
});

it('keeps an oversized image as a blocking error', () => {
  expect(classifyImageReadiness(
    { type: 'image/webp', size: (10 * 1024 * 1024) + 1 },
  )).toMatchObject({ blockingError: 'Images must be 10 MB or smaller.' });
});

it('inspects bitmap dimensions locally and releases the bitmap', async () => {
  const close = vi.fn();
  const createImageBitmap = vi.fn().mockResolvedValue({
    width: 1_200,
    height: 800,
    close,
  });
  vi.stubGlobal('createImageBitmap', createImageBitmap);

  await expect(inspectImageReadiness(imageFile())).resolves.toMatchObject({
    dimensions: { width: 1_200, height: 800 },
    advisory: undefined,
  });
  expect(createImageBitmap).toHaveBeenCalledWith(
    expect.any(File),
    { imageOrientation: 'from-image' },
  );
  expect(close).toHaveBeenCalledTimes(1);
});

it('falls back to an object URL image and revokes it after reading dimensions', async () => {
  const createObjectURL = vi.fn(() => 'blob:label');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

  class FakeImage {
    naturalWidth = 1_200;
    naturalHeight = 800;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }

  vi.stubGlobal('Image', FakeImage);

  await expect(inspectImageReadiness(imageFile())).resolves.toMatchObject({
    dimensions: { width: 1_200, height: 800 },
    advisory: undefined,
  });
  expect(createObjectURL).toHaveBeenCalledWith(expect.any(File));
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:label');
});

it('reports a decode failure as advisory guidance', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => {
      throw new Error('object URLs unavailable');
    }),
    revokeObjectURL: vi.fn(),
  });

  await expect(inspectImageReadiness(imageFile())).resolves.toMatchObject({
    advisory: 'decode-failed',
  });
});
