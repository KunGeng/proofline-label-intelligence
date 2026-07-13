import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { CANONICAL_WARNING_BODY, CANONICAL_WARNING_HEADING } from './domain/constants';
import type { Candidate } from './domain/types';
import { extractFromImage, prewarmOcr } from './features/extraction/ocr';
import type { ExtractionJobResult } from './features/extraction/types';
import { serializeResults } from './features/intake/export';
import type { QueueItem } from './features/intake/queue';

vi.mock('./features/extraction/ocr', () => ({
  extractFromImage: vi.fn(),
  prewarmOcr: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(prewarmOcr).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.mocked(extractFromImage).mockReset();
  vi.mocked(prewarmOcr).mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

const fillManualReviewForm = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> => {
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
  return screen.getByRole('button', { name: /start evidence review/i });
};

const startManualReview = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
  await user.click(await fillManualReviewForm(user));
};

const startPendingManualReview = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> => {
  const submit = await fillManualReviewForm(user);
  vi.useFakeTimers();
  fireEvent.click(submit);
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

const batchErrorFixture: QueueItem[] = [
  {
    id: 'error',
    file: new File(['label'], 'error.png', { type: 'image/png' }),
    name: 'error.png',
    size: 5,
    status: 'error',
    progress: 1,
    error: 'Temporary OCR failure',
  },
];

const ocrCandidate = (value: string): Candidate => ({
  value,
  rawText: value,
  confidence: 0.99,
  source: 'ocr',
});

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

it('offers a starter CSV and exact validation schema in batch intake', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a batch/i }));

  expect(screen.getByRole('link', { name: /download starter csv/i }))
    .toHaveAttribute('href', '/batch-template.csv');
  expect(screen.getByText(/brandName, classType, abv, netContents/i)).toBeInTheDocument();
});

it('filters a completed batch and exports the visible review data', async () => {
  const user = userEvent.setup();
  render(<App initialBatchItems={batchFixture} />);

  await user.selectOptions(screen.getByLabelText(/show/i), 'mismatch');

  expect(screen.getAllByRole('row')).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: /export results/i }));
  expect(serializeResults(batchFixture)).toContain('filename,status');
});

it('keeps batch row failures descriptive without injecting row alerts', () => {
  render(<App initialBatchItems={batchErrorFixture} />);

  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  expect(
    screen.getByRole('status', { name: /batch review progress/i }),
  ).toHaveTextContent('1 extraction error needs attention.');
});

it('keeps the batch results scrollport keyboard reachable at narrow widths', () => {
  render(<App initialBatchItems={batchFixture} />);

  const scrollport = screen.getByRole('region', {
    name: /batch review results table/i,
  });
  expect(scrollport).toHaveAttribute('tabindex', '0');
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

it('renders extracted evidence for a filename-only triage row after its detail control opens', async () => {
  const user = userEvent.setup();
  const extractionOnly: QueueItem[] = [
    {
      id: 'triage-evidence',
      file: new File(['label'], 'triage-evidence.png', { type: 'image/png' }),
      name: 'triage-evidence.png',
      size: 5,
      status: 'extracted_pending_application',
      progress: 1,
      thumbnailUrl: 'blob:triage-evidence-preview',
      rawText: 'OLD TOM\n45% Alc./Vol.',
      extraction: {
        brandName: ocrCandidate('OLD TOM'),
        abv: ocrCandidate('45%'),
      },
    },
  ];

  render(<App initialBatchItems={extractionOnly} />);

  const trigger = screen.getByRole('button', {
    name: /view evidence for triage-evidence\.png/i,
  });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await user.click(trigger);

  const detail = screen.getByRole('region', {
    name: /evidence for triage-evidence\.png/i,
  });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(detail).toHaveTextContent('Application data required');
  expect(detail).toHaveTextContent('OLD TOM');
  expect(detail).toHaveTextContent('Raw OCR');
  expect(detail).toHaveTextContent('45% Alc./Vol.');
  expect(screen.getByRole('img', { name: /label preview: triage-evidence\.png/i })).toBeInTheDocument();
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

it('keeps a replacement batch processing when a cleared extraction settles late', async () => {
  const user = userEvent.setup();
  const oldExtraction = deferred<ExtractionJobResult>();
  const newExtraction = deferred<ExtractionJobResult>();
  vi.mocked(extractFromImage).mockImplementation((file) =>
    file.name === 'old.png' ? oldExtraction.promise : newExtraction.promise,
  );

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a batch/i }));
  const imageInput = screen.getByLabelText(/^choose label images$/i);
  await user.upload(imageInput, new File(['old'], 'old.png', { type: 'image/png' }));
  await user.click(screen.getByRole('button', { name: /begin batch review/i }));

  expect(screen.getByRole('button', { name: /batch review in progress/i })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: /clear this batch/i }));

  await user.upload(imageInput, new File(['new'], 'new.png', { type: 'image/png' }));
  await user.click(screen.getByRole('button', { name: /begin batch review/i }));
  oldExtraction.resolve({ extraction: {}, rawText: 'OLD', source: 'ocr' });

  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /batch review in progress/i })).toBeDisabled();
    expect(screen.getByText('0 of 1 processed')).toBeInTheDocument();
  });

  newExtraction.resolve({ extraction: {}, rawText: 'NEW', source: 'ocr' });
  expect(await screen.findByText('Application data required')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^begin batch review$/i })).toBeEnabled();
});

it('keeps the newest CSV selection while an earlier read resolves late', async () => {
  const user = userEvent.setup();
  const firstRead = deferred<string>();
  const secondRead = deferred<string>();
  const firstCsv = new File(['first'], 'first.csv', { type: 'text/csv' });
  const secondCsv = new File(['second'], 'second.csv', { type: 'text/csv' });
  Object.defineProperty(firstCsv, 'text', { configurable: true, value: () => firstRead.promise });
  Object.defineProperty(secondCsv, 'text', { configurable: true, value: () => secondRead.promise });

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a batch/i }));
  await user.upload(
    screen.getByLabelText(/^choose label images$/i),
    new File(['label'], 'label.png', { type: 'image/png' }),
  );
  const csvInput = screen.getByLabelText(/^optional application CSV$/i);
  await user.upload(csvInput, firstCsv);

  expect(screen.getByText('Reading first.csv…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /begin batch review/i })).toBeDisabled();

  await user.upload(csvInput, secondCsv);
  firstRead.resolve('filename,brandName\nlabel.png,Old Tom');

  await waitFor(() => {
    expect(screen.getByText('Reading second.csv…')).toBeInTheDocument();
    expect(screen.queryByText(/Ready: first\.csv/i)).not.toBeInTheDocument();
  });

  secondRead.resolve('filename\nlabel.png');

  await waitFor(() => {
    expect(screen.getByText(/Ready: second\.csv/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^begin batch review$/i })).toBeEnabled();
  });
});

it('does not restore an in-flight CSV after the batch intake is cleared', async () => {
  const user = userEvent.setup();
  const csvRead = deferred<string>();
  const csv = new File(['late'], 'late.csv', { type: 'text/csv' });
  Object.defineProperty(csv, 'text', { configurable: true, value: () => csvRead.promise });

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a batch/i }));
  await user.upload(
    screen.getByLabelText(/^choose label images$/i),
    new File(['label'], 'label.png', { type: 'image/png' }),
  );
  await user.upload(screen.getByLabelText(/^optional application CSV$/i), csv);

  expect(screen.getByText('Reading late.csv…')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /clear this batch/i }));
  csvRead.resolve('filename\nlabel.png');

  await waitFor(() => {
    expect(screen.queryByText(/Ready: late\.csv/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /begin batch review/i })).toBeDisabled();
  });
});

it('rejects an empty optional CSV instead of silently running image-only triage', async () => {
  const user = userEvent.setup();
  const csv = new File([], 'empty.csv', { type: 'text/csv' });
  Object.defineProperty(csv, 'text', { configurable: true, value: async () => '' });

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a batch/i }));
  await user.upload(
    screen.getByLabelText(/^choose label images$/i),
    new File(['label'], 'label.png', { type: 'image/png' }),
  );
  await user.upload(screen.getByLabelText(/^optional application CSV$/i), csv);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The filename CSV header is required.',
  );
  expect(screen.getByRole('button', { name: /begin batch review/i })).toBeDisabled();
});

it('orients the fixture-backed demo around the next three review actions', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /open guided demo/i }));

  expect(
    screen.getByRole('heading', { name: /a quick way through this sample/i }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /inspect the raw ocr/i })).toHaveAttribute(
    'href',
    '#raw-evidence',
  );
  expect(screen.getByRole('link', { name: /inspect the field comparison/i })).toHaveAttribute(
    'href',
    '#field-comparison',
  );
  expect(
    screen.getByRole('link', { name: /complete the visual typography check/i }),
  ).toHaveAttribute('href', '#typography-confirmation');
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
    screen.getByText('Evidence is available, but an agent review is still required.'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: /needs review/i }),
  ).toBeInTheDocument();
});

it('labels a manual review with next reviewer actions', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage).mockResolvedValueOnce({
    extraction: {},
    rawText: '',
    source: 'ocr',
  });

  await startManualReview(user);

  expect(
    await screen.findByRole('heading', { name: /next reviewer actions/i }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: /a quick way through this sample/i }),
  ).not.toBeInTheDocument();
});

it('offers manual review after five seconds and ignores a late OCR result', async () => {
  const user = userEvent.setup();
  const result = deferred<ExtractionJobResult>();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue('blob:old-tom'),
    revokeObjectURL: vi.fn(),
  });
  vi.mocked(extractFromImage).mockReturnValueOnce(result.promise);

  await startPendingManualReview(user);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });

  expect(screen.getByText(/this is taking longer than expected/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /review manually now/i }));
  expect(screen.getByText(/manual evidence mode/i)).toBeInTheDocument();

  await act(async () => {
    result.resolve({
      extraction: {},
      rawText: 'OLD TOM',
      source: 'ocr',
      durationMs: 4_321,
    });
    await Promise.resolve();
  });

  expect(screen.queryByText(/local OCR finished/i)).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: /label preview: old-tom\.png/i })).toHaveAttribute(
    'src',
    'blob:old-tom',
  );
});

it('moves focus to the manual-evidence disclosure after recovery', async () => {
  const user = userEvent.setup();
  const result = deferred<ExtractionJobResult>();
  vi.mocked(extractFromImage).mockReturnValueOnce(result.promise);

  await startPendingManualReview(user);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });

  fireEvent.click(screen.getByRole('button', { name: /review manually now/i }));

  expect(screen.getByText(/manual evidence mode/i)).toHaveFocus();

  await act(async () => {
    result.resolve({ extraction: {}, rawText: '', source: 'ocr' });
    await Promise.resolve();
  });
});

it('uses one polite live region for slow-review recovery', async () => {
  const user = userEvent.setup();
  const result = deferred<ExtractionJobResult>();
  vi.mocked(extractFromImage).mockReturnValueOnce(result.promise);

  await startPendingManualReview(user);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });

  expect(screen.getByText(/this is taking longer than expected/i).closest('aside'))
    .not.toHaveAttribute('role', 'status');

  await act(async () => {
    result.resolve({ extraction: {}, rawText: '', source: 'ocr' });
    await Promise.resolve();
  });
});

it('allows an explicit OCR stop after fifteen seconds before manual review', async () => {
  const user = userEvent.setup();
  const result = deferred<ExtractionJobResult>();
  let signal: AbortSignal | undefined;
  vi.mocked(extractFromImage).mockImplementationOnce((_file, _onProgress, options) => {
    signal = options?.signal;
    return result.promise;
  });

  await startPendingManualReview(user);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });

  fireEvent.click(screen.getByRole('button', { name: /stop OCR and review manually/i }));

  expect(signal?.aborted).toBe(true);
  expect(screen.getByText(/manual evidence mode/i)).toBeInTheDocument();

  await act(async () => {
    result.resolve({ extraction: {}, rawText: '', source: 'ocr' });
    await Promise.resolve();
  });
});

it('cancels a still-running manual-path extraction when the reviewer leaves it', async () => {
  const user = userEvent.setup();
  const result = deferred<ExtractionJobResult>();
  let signal: AbortSignal | undefined;
  vi.mocked(extractFromImage).mockImplementationOnce((_file, _onProgress, options) => {
    signal = options?.signal;
    return result.promise;
  });

  await startPendingManualReview(user);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  fireEvent.click(screen.getByRole('button', { name: /review manually now/i }));
  fireEvent.click(screen.getByRole('button', { name: /review another label/i }));

  expect(signal?.aborted).toBe(true);

  await act(async () => {
    result.resolve({ extraction: {}, rawText: '', source: 'ocr' });
    await Promise.resolve();
  });
});

it('prewarms OCR only after a reviewer enters a single or batch intake', async () => {
  const user = userEvent.setup();
  render(<App />);

  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  expect(prewarmOcr).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: /open guided demo/i }));
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  expect(prewarmOcr).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: /new review/i }));
  await waitFor(() => {
    expect(prewarmOcr).toHaveBeenCalledTimes(1);
  });

  await user.click(screen.getByRole('button', { name: /^batch review$/i }));
  await waitFor(() => {
    expect(prewarmOcr).toHaveBeenCalledTimes(2);
  });
});

it('keeps warning typography and legibility confirmations as separate reviewer checks', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage).mockResolvedValueOnce({
    extraction: {},
    rawText: '',
    source: 'ocr',
  });

  await startManualReview(user);

  const typography = await screen.findByRole('checkbox', {
    name: /i visually confirmed the warning heading is uppercase and bold/i,
  });
  const legibility = screen.getByRole('checkbox', {
    name: /i reviewed warning legibility, contrast, and placement\. exact printed type size still needs final regulatory review/i,
  });
  const legibilityRow = screen.getByRole('row', { name: /warning legibility/i });

  expect(legibilityRow).toHaveTextContent('Needs review');
  await user.click(typography);
  await user.click(legibility);

  expect(typography).toBeChecked();
  expect(legibility).toBeChecked();
  expect(legibilityRow).toHaveTextContent('Match');
  expect(legibilityRow).toHaveTextContent(
    'An agent reviewed warning legibility, contrast, and placement.',
  );
});

it('runs an in-memory same-origin sample benchmark with honest run labels and timings', async () => {
  const user = userEvent.setup();
  const fetchSample = vi.fn().mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['sample'], { type: 'image/jpeg' }),
  });
  vi.stubGlobal('fetch', fetchSample);
  vi.mocked(extractFromImage)
    .mockResolvedValueOnce({
      extraction: { brandName: ocrCandidate('Old Tom') },
      rawText: 'OLD TOM',
      source: 'ocr',
      durationMs: 1_210,
      timings: {
        preparationMs: 120,
        workerWaitMs: 890,
        recognitionMs: 200,
        totalMs: 1_210,
      },
    })
    .mockResolvedValueOnce({
      extraction: {},
      rawText: '',
      source: 'ocr',
      error: 'unreadable',
      timings: {
        preparationMs: 80,
        workerWaitMs: 0,
        recognitionMs: 740,
        totalMs: 820,
      },
    });

  render(<App />);
  await user.click(screen.getByRole('button', { name: /run local sample benchmark/i }));

  const progress = screen.getByRole('status', { name: /benchmark progress/i });
  expect(progress).toHaveAttribute('aria-live', 'polite');
  expect(screen.queryByRole('heading', { name: /first sample run/i })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /^run benchmark$/i }));

  expect(await screen.findByRole('heading', { name: /first sample run/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /second warm-worker run/i })).toBeInTheDocument();
  expect(fetchSample).toHaveBeenCalledWith('/demo/old-tom-bourbon.jpg');
  expect(extractFromImage).toHaveBeenCalledTimes(2);
  const firstRun = screen.getByRole('article', { name: /first sample run/i });
  expect(within(firstRun).getByText('Total: 1.2 s')).toBeInTheDocument();
  expect(within(firstRun).getByText('Preparation: 0.1 s')).toBeInTheDocument();
  expect(within(firstRun).getByRole('listitem')).toHaveTextContent(
    'Brand name: Old Tom — 99% confidence',
  );
  expect(screen.getByText(/extraction error: unreadable/i)).toBeInTheDocument();
  expect(screen.queryByText(/network-cold/i)).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /back to overview/i }));
  await user.click(screen.getByRole('button', { name: /run local sample benchmark/i }));
  expect(screen.getByText(/no benchmark runs yet/i)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /first sample run/i })).not.toBeInTheDocument();
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

it('lets an agent add a missing imported-origin candidate without fabricating raw OCR evidence', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage).mockResolvedValueOnce({
    extraction: {
      brandName: ocrCandidate('Old Tom'),
      classType: ocrCandidate('Bourbon Whiskey'),
      abv: ocrCandidate('45%'),
      proof: ocrCandidate('90 Proof'),
      netContents: ocrCandidate('750 mL'),
      producerAddress: ocrCandidate('Old Tom, KY'),
      warningText: ocrCandidate(CANONICAL_WARNING_BODY),
      warningHeading: ocrCandidate(CANONICAL_WARNING_HEADING),
    },
    rawText: 'Old Tom\nMade in an unreadable location',
    source: 'ocr',
  });

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.type(screen.getByRole('textbox', { name: /^brand name$/i }), 'Old Tom');
  await user.type(screen.getByRole('textbox', { name: /class\/type/i }), 'Bourbon Whiskey');
  await user.type(screen.getByRole('textbox', { name: /alcohol by volume/i }), '45%');
  await user.type(screen.getByRole('textbox', { name: /net contents/i }), '750 mL');
  await user.type(screen.getByRole('textbox', { name: /producer address/i }), 'Old Tom, KY');
  await user.click(screen.getByRole('checkbox', { name: /imported product/i }));
  await user.type(screen.getByRole('textbox', { name: /country of origin/i }), 'Scotland');
  await user.upload(
    screen.getByLabelText(/^choose label image$/i),
    new File(['label'], 'imported.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  const originRow = await screen.findByRole('row', { name: /country of origin/i });
  expect(originRow).toHaveTextContent('Unreadable');

  const addOrigin = screen.getByRole('button', {
    name: /add country of origin candidate/i,
  });
  expect(addOrigin).toHaveAttribute('aria-expanded', 'false');
  await user.click(addOrigin);

  const originInput = screen.getByRole('textbox', {
    name: /country of origin agent-entered candidate/i,
  });
  expect(addOrigin).toHaveAttribute('aria-expanded', 'true');
  expect(originInput).toHaveFocus();
  await user.type(originInput, 'Scotland');
  await user.click(screen.getByRole('button', { name: /save country of origin candidate/i }));

  expect(originRow).toHaveTextContent('Match');
  expect(originRow).toHaveTextContent('Agent-entered');
  expect(originRow).toHaveTextContent('No raw OCR candidate was extracted.');
});

it('treats an agent correction of a low-confidence candidate as human-verified', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage).mockResolvedValueOnce({
    extraction: {
      abv: { value: '43%', rawText: '43% Alc./Vol.', confidence: 0.7, source: 'ocr' },
    },
    rawText: '43% Alc./Vol.',
    source: 'ocr',
  });

  await startManualReview(user);

  const abvRow = await screen.findByRole('row', { name: /alcohol by volume/i });
  expect(abvRow).toHaveTextContent('Needs review');

  await user.click(
    screen.getByRole('button', { name: /correct alcohol by volume candidate/i }),
  );
  const correction = screen.getByRole('textbox', {
    name: /alcohol by volume corrected candidate/i,
  });
  await user.clear(correction);
  await user.type(correction, '45%');
  await user.click(
    screen.getByRole('button', { name: /save alcohol by volume correction/i }),
  );

  expect(abvRow).toHaveTextContent('Match');
  expect(abvRow).toHaveTextContent('Human-verified');
  expect(abvRow).toHaveTextContent(/raw OCR: 43% Alc\.\/Vol\./i);
});

it('reports the measured local extraction time for a real review', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage).mockResolvedValueOnce({
    extraction: {},
    rawText: 'OLD TOM',
    source: 'ocr',
    durationMs: 4321,
  });

  await startManualReview(user);

  expect(
    await screen.findByText('Local OCR finished in 4.3 s on this device.'),
  ).toBeInTheDocument();
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

it('marks missing single-label requirements and focuses the first field after submit', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  const brand = screen.getByRole('textbox', { name: /^brand name$/i });
  expect(brand).toHaveAttribute('aria-invalid', 'true');
  expect(brand).toHaveFocus();
  expect(screen.getByText('Required fields are marked Required.')).toBeInTheDocument();
});

it('explains unsupported application number formats before extraction begins', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.type(screen.getByRole('textbox', { name: /^brand name$/i }), 'Old Tom');
  await user.type(screen.getByRole('textbox', { name: /class\/type/i }), 'Bourbon Whiskey');
  await user.type(
    screen.getByRole('textbox', { name: /alcohol by volume/i }),
    '45% Alc./Vol. (90 Proof)',
  );
  await user.type(screen.getByRole('textbox', { name: /net contents/i }), '750 mL');
  await user.type(screen.getByRole('textbox', { name: /producer address/i }), 'Old Tom, KY');
  await user.upload(
    screen.getByLabelText(/^choose label image$/i),
    new File(['label'], 'old-tom.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  const abv = screen.getByRole('textbox', { name: /alcohol by volume/i });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Alcohol by volume must be a number or percentage, like 45%.',
  );
  expect(abv).toHaveAttribute('aria-invalid', 'true');
  expect(abv).toHaveFocus();
  expect(extractFromImage).not.toHaveBeenCalled();

  await user.clear(abv);
  await user.type(abv, '45%');
  vi.mocked(extractFromImage).mockResolvedValueOnce({
    extraction: {},
    rawText: 'OLD TOM',
    source: 'ocr',
  });
  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  expect(await screen.findByRole('table')).toBeInTheDocument();
});

it('blocks explicitly out-of-scope beverages before extraction begins', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage).mockResolvedValueOnce({
    extraction: {},
    rawText: '',
    source: 'ocr',
  });
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.type(screen.getByRole('textbox', { name: /^brand name$/i }), 'Old Tom');
  await user.type(screen.getByRole('textbox', { name: /class\/type/i }), 'wine');
  await user.type(screen.getByRole('textbox', { name: /alcohol by volume/i }), '45%');
  await user.type(screen.getByRole('textbox', { name: /net contents/i }), '750 mL');
  await user.type(screen.getByRole('textbox', { name: /producer address/i }), 'Old Tom, KY');
  await user.upload(
    screen.getByLabelText(/^choose label image$/i),
    new File(['label'], 'wine.png', { type: 'image/png' }),
  );

  await user.click(screen.getByRole('button', { name: /start evidence review/i }));
  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  const scopeError = screen.getByRole('alert');
  expect(scopeError).toHaveTextContent(
    /proofline is limited to u\.s\. distilled-spirit labels/i,
  );
  expect(
    scopeError.textContent?.match(/Proofline is limited to U\.S\. distilled-spirit labels\./g),
  ).toHaveLength(1);
  expect(extractFromImage).not.toHaveBeenCalled();
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

it('explains unsupported files without losing the current form values', async () => {
  const user = userEvent.setup({ applyAccept: false });
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));
  const brandName = screen.getByRole('textbox', { name: /^brand name$/i });
  const imageInput = screen.getByLabelText(/^choose label image$/i);

  await user.type(brandName, 'Old Tom');
  await user.upload(
    imageInput,
    new File(['notes'], 'notes.txt', { type: 'text/plain' }),
  );

  expect(screen.getByRole('alert')).toHaveTextContent(/jpeg, png, or webp/i);
  expect(brandName).toHaveValue('Old Tom');
  expect(imageInput).toHaveAttribute('aria-invalid', 'true');
});

it('keeps the primary review area keyboard reachable', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.tab();

  expect(document.activeElement).toHaveAccessibleName(/skip to review/i);
});

it('announces OCR progress while the evidence workspace is loading', async () => {
  const user = userEvent.setup();
  const pending = deferred<ExtractionJobResult>();
  vi.mocked(extractFromImage).mockImplementationOnce((_file, onProgress) => {
    onProgress({ phase: 'reading', value: 0.42 });
    return pending.promise;
  });

  await startManualReview(user);

  const progress = screen.getByRole('status', { name: /label extraction progress/i });
  expect(progress).toHaveAttribute('aria-live', 'polite');
  expect(progress).not.toHaveAttribute('aria-busy');
  expect(progress).toHaveTextContent(/reading label evidence… 42%/i);
  expect(screen.getByText(/preparing comparison workspace/i)).toBeInTheDocument();

  pending.resolve({ extraction: {}, rawText: 'OLD TOM', source: 'ocr' });
  expect(await screen.findByRole('table')).toBeInTheDocument();
});

it('announces an empty evidence correction as a validation error', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /open guided demo/i }));
  await user.click(screen.getByRole('button', { name: /correct brand name candidate/i }));

  const correction = screen.getByRole('textbox', {
    name: /brand name corrected candidate/i,
  });
  await user.clear(correction);
  await user.click(screen.getByRole('button', { name: /save brand name correction/i }));

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter a corrected value before saving.',
  );
  expect(correction).toHaveAttribute('aria-invalid', 'true');
});
