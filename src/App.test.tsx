import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { extractFromImage } from './features/extraction/ocr';
import type { ExtractionJobResult } from './features/extraction/types';
import { serializeResults } from './features/intake/export';
import type { QueueItem } from './features/intake/queue';

vi.mock('./features/extraction/ocr', () => ({
  extractFromImage: vi.fn(),
}));

afterEach(() => {
  vi.mocked(extractFromImage).mockReset();
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

const startManualReview = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.type(screen.getByRole('textbox', { name: /^brand name$/i }), 'Old Tom');
  await user.type(screen.getByRole('textbox', { name: /class\/type/i }), 'Bourbon Whiskey');
  await user.type(screen.getByRole('textbox', { name: /alcohol by volume/i }), '45%');
  await user.type(screen.getByRole('textbox', { name: /net contents/i }), '750 mL');
  await user.type(screen.getByRole('textbox', { name: /producer address/i }), 'Old Tom, KY');
  await user.upload(
    screen.getByLabelText(/^choose label image$/i),
    new File(['label'], 'old-tom.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: /start evidence review/i }));
};

const batchFixture: QueueItem[] = [
  {
    id: 'mismatch',
    file: new File(['label'], 'mismatch.png', { type: 'image/png' }),
    name: 'mismatch.png',
    size: 5,
    status: 'ready',
    progress: 1,
    result: {
      overallState: 'mismatch',
      fields: [
        {
          field: 'brandName',
          state: 'mismatch',
          expected: 'Old Tom',
          observed: 'Old Tom Reserve',
          reason: 'High-confidence text conflicts with the application.',
        },
      ],
    },
  },
];

it('offers a guided demo and a label-review entry point', () => {
  render(<App />);

  expect(
    screen.getByRole('heading', { name: /review labels with evidence/i }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /open guided demo/i }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /review a label/i }),
  ).toBeInTheDocument();
});

it('filters a completed batch and exports the visible review data', async () => {
  const user = userEvent.setup();
  render(<App initialBatchItems={batchFixture} />);

  await user.selectOptions(screen.getByLabelText(/show/i), 'mismatch');

  expect(screen.getAllByRole('row')).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: /export results/i }));
  expect(serializeResults(batchFixture)).toContain('filename,status');
});

it('labels extraction-only batch rows as requiring application data', () => {
  const extractionOnly: QueueItem[] = [
    {
      id: 'triage',
      file: new File(['label'], 'triage.png', { type: 'image/png' }),
      name: 'triage.png',
      size: 5,
      status: 'extracted_pending_application',
      progress: 1,
    },
  ];

  render(<App initialBatchItems={extractionOnly} />);

  expect(screen.getByText('Application data required')).toBeInTheDocument();
  expect(screen.queryByText(/^Match$/)).not.toBeInTheDocument();
});

it('requires the complete CSV application schema before a batch can begin', async () => {
  const user = userEvent.setup();
  const csv = new File(['filename,brandName\nlabel.png,Old Tom'], 'applications.csv', {
    type: 'text/csv',
  });
  Object.defineProperty(csv, 'text', {
    configurable: true,
    value: async () => 'filename,brandName\nlabel.png,Old Tom',
  });

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a batch/i }));
  await user.upload(
    screen.getByLabelText(/^choose label images$/i),
    new File(['label'], 'label.png', { type: 'image/png' }),
  );
  await user.upload(screen.getByLabelText(/^optional application CSV$/i), csv);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'CSV has an incomplete application schema',
  );
});

it('retries a failed batch extraction with the original image', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage).mockReset();
  vi.mocked(extractFromImage)
    .mockRejectedValueOnce(new Error('Temporary OCR failure'))
    .mockResolvedValueOnce({
      extraction: {},
      rawText: 'OLD TOM',
      source: 'ocr',
    });

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a batch/i }));
  await user.upload(
    screen.getByLabelText(/^choose label images$/i),
    new File(['label'], 'retry.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: /begin batch review/i }));

  await user.click(await screen.findByRole('button', { name: /retry retry\.png/i }));

  expect(await screen.findByText('Application data required')).toBeInTheDocument();
  expect(extractFromImage).toHaveBeenCalledTimes(2);
});

it('opens the fixture-backed demo and requires warning typography confirmation', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /open guided demo/i }));

  expect(
    screen.getByText(/precomputed sample — not a live OCR timing result/i),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', {
      name: /i visually confirmed the warning heading is uppercase and bold/i,
    }),
  ).not.toBeChecked();

  await user.click(
    screen.getByRole('checkbox', {
      name: /i visually confirmed the warning heading is uppercase and bold/i,
    }),
  );

  expect(
    screen.getByText('No discrepancies detected — agent approval required.'),
  ).toBeInTheDocument();
});

it('preserves raw OCR evidence when an agent corrects an extracted candidate', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /open guided demo/i }));
  await user.click(
    screen.getByRole('button', { name: /correct brand name candidate/i }),
  );

  const correction = screen.getByRole('textbox', {
    name: /brand name corrected candidate/i,
  });
  await user.clear(correction);
  await user.type(correction, 'Old Tom Reserve');
  await user.click(screen.getByRole('button', { name: /save brand name correction/i }));

  expect(screen.getByText('Agent-entered')).toBeInTheDocument();
  expect(screen.getByText(/raw OCR: OLD TOM DISTILLERY/i)).toBeInTheDocument();
});

it('never renders an approval claim', async () => {
  render(<App />);

  expect(screen.queryByText(/^approved$/i)).not.toBeInTheDocument();
});

it('shows origin only for imported products and explains unsupported uploads inline', async () => {
  const user = userEvent.setup({ applyAccept: false });
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));

  expect(
    screen.queryByRole('textbox', { name: /country of origin/i }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole('checkbox', { name: /imported product/i }));

  expect(
    screen.getByRole('textbox', { name: /country of origin/i }),
  ).toBeInTheDocument();

  const unsupportedImage = new File(['label'], 'label.gif', { type: 'image/gif' });
  await user.upload(screen.getByLabelText(/^choose label image$/i), unsupportedImage);

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Upload a JPEG, PNG, or WebP image.',
  );
});

it('shows the U.S. distilled-spirit prototype scope before manual review begins', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));

  expect(screen.getByRole('note', { name: /prototype scope/i })).toHaveTextContent(
    'Proofline currently supports U.S. distilled-spirit labels. Other beverage classes and physical-label/typography requirements remain outside automated validation.',
  );
});

it('blocks extraction until the required application facts are supplied', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Complete the required application facts: Brand name, Class/type, Alcohol by volume, Net contents, Producer address.',
  );
});

it('keeps the reviewer informed when OCR rejects unexpectedly', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage).mockRejectedValueOnce(new Error('worker failed'));

  await startManualReview(user);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'OCR could not complete. Try a clearer image or begin a new evidence review.',
  );
  expect(screen.queryByRole('heading', { name: /^unreadable$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', {
      name: /i visually confirmed the warning heading is uppercase and bold/i,
    }),
  ).not.toBeInTheDocument();
});

it('routes a resolved unreadable OCR result to choose-another-label recovery', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage).mockResolvedValueOnce({
    extraction: {},
    rawText: '',
    source: 'ocr',
    error: 'unreadable',
  });

  await startManualReview(user);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'We could not read reliable text from this label. Choose another label or provide a clearer image.',
  );
  expect(screen.getByRole('button', { name: /choose another label/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /^unreadable$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', {
      name: /i visually confirmed the warning heading is uppercase and bold/i,
    }),
  ).not.toBeInTheDocument();
});

it('shows only progress while OCR is still processing', async () => {
  const user = userEvent.setup();
  const pending = deferred<ExtractionJobResult>();
  vi.mocked(extractFromImage).mockImplementationOnce((_file, onProgress) => {
    onProgress({ phase: 'reading', value: 0.42 });
    return pending.promise;
  });

  await startManualReview(user);

  expect(screen.getByText(/reading label evidence… 42%/i)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /^unreadable$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', {
      name: /i visually confirmed the warning heading is uppercase and bold/i,
    }),
  ).not.toBeInTheDocument();

  pending.resolve({ extraction: {}, rawText: 'OLD TOM', source: 'ocr' });
  expect(await screen.findByRole('table')).toBeInTheDocument();
});

it('focuses a disclosed correction editor and restores its trigger after closing', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /open guided demo/i }));
  const trigger = screen.getByRole('button', { name: /correct brand name candidate/i });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).not.toHaveAttribute('aria-controls');

  await user.click(trigger);

  const correction = screen.getByRole('textbox', {
    name: /brand name corrected candidate/i,
  });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(trigger).toHaveAttribute('aria-controls', 'correction-brandName');
  expect(correction).toHaveFocus();

  await user.click(screen.getByRole('button', { name: /cancel correction/i }));

  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).not.toHaveAttribute('aria-controls');
  expect(trigger).toHaveFocus();
});
