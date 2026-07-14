import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { App } from './App';
import { CANONICAL_WARNING_BODY, CANONICAL_WARNING_HEADING } from './domain/constants';
import { validateLabel } from './domain/validation';
import type { ApplicationData, Candidate, LabelExtraction, ReviewFlags } from './domain/types';
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

const enterManualRecoveryEvidence = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> => {
  await user.click(await screen.findByRole('button', { name: /add brand name candidate/i }));
  await user.type(
    screen.getByRole('textbox', { name: /brand name agent-entered candidate/i }),
    'HUMAN BRAND',
  );
  await user.click(screen.getByRole('button', { name: /save brand name candidate/i }));
  await user.click(screen.getByRole('button', { name: /add proof candidate/i }));
  await user.type(
    screen.getByRole('textbox', { name: /proof agent-entered candidate/i }),
    '90 Proof',
  );
  await user.click(screen.getByRole('button', { name: /save proof candidate/i }));
  await user.click(screen.getByRole('button', { name: /remove proof evidence/i }));
  await user.click(
    screen.getByRole('checkbox', { name: /warning heading is uppercase and bold/i }),
  );
};

const emptyReviewFlags = (): ReviewFlags => ({
  warningTypographyConfirmed: false,
  warningLegibilityConfirmed: false,
});

const batchFixture: QueueItem[] = [
  {
    id: 'mismatch',
    file: new File(['label'], 'mismatch.png', { type: 'image/png' }),
    name: 'mismatch.png',
    size: 5,
    status: 'ready',
    progress: 1,
    reviewFlags: emptyReviewFlags(),
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
    reviewFlags: emptyReviewFlags(),
    error: 'Temporary OCR failure',
  },
];

const ocrCandidate = (value: string, rawText = value): Candidate => ({
  value,
  rawText,
  confidence: 0.99,
  source: 'ocr',
});

const batchApplication: ApplicationData = {
  brandName: 'OLD TOM',
  classType: 'Bourbon Whiskey',
  abv: '45%',
  proof: '90 Proof',
  netContents: '750 mL',
  producerAddress: 'Example, KY',
  isImported: false,
};

const matchingBatchExtraction = (): LabelExtraction => ({
  brandName: ocrCandidate('OLD TOM', 'OLD TOM FROM OCR'),
  classType: ocrCandidate('Bourbon Whiskey'),
  abv: ocrCandidate('45%'),
  proof: ocrCandidate('90 Proof'),
  netContents: ocrCandidate('750 mL'),
  producerAddress: ocrCandidate('Example, KY'),
  warningText: ocrCandidate(CANONICAL_WARNING_BODY),
  warningHeading: ocrCandidate(CANONICAL_WARNING_HEADING),
});

const readyBatchItem = (name = 'ready.png'): QueueItem => {
  const application = { ...batchApplication };
  const extraction = matchingBatchExtraction();
  const reviewFlags = emptyReviewFlags();

  return {
    id: name,
    file: new File(['label'], name, { type: 'image/png' }),
    name,
    size: 5,
    application,
    reviewFlags,
    status: 'ready',
    progress: 1,
    extraction,
    rawText: 'OLD TOM FROM OCR',
    source: 'ocr',
    result: validateLabel({ application, extraction, flags: reviewFlags }),
  };
};

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

it('opens an explicit foreign-origin scenario with fixture evidence and a review finding', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /explore scenarios/i }));
  expect(screen.getByRole('button', { name: /clear candidates, visual checks remain/i }))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: /declared-brand conflict/i }))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: /domestic declaration, foreign origin/i }))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: /title-case warning heading/i }))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: /low-confidence evidence/i }))
    .toBeInTheDocument();
  const foreignOrigin = screen.getByRole('button', {
    name: /domestic declaration, foreign origin/i,
  });
  foreignOrigin.focus();
  await user.keyboard('{Enter}');

  expect(
    screen.getByText(/precomputed illustrative fixture — not a live OCR timing result/i),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('figure', { name: /illustrative label fixture/i }),
  ).toHaveTextContent('Product of Scotland');
  expect(
    screen.getByRole('row', { name: /country of origin/i }),
  ).toHaveTextContent('Needs review');
  expect(screen.getByText(/fixture text: product of scotland/i)).toBeInTheDocument();
  expect(screen.queryByText(/raw OCR: product of scotland/i)).not.toBeInTheDocument();
  expect(screen.getByRole('heading', {
    name: /domestic declaration \/ foreign-origin evidence/i,
  })).toHaveFocus();
});

it('opens the declared-brand conflict with a visible mismatch', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /explore scenarios/i }));
  await user.click(screen.getByRole('button', { name: /declared-brand conflict/i }));

  expect(
    screen.getByText(/application brand intentionally conflicts with visible label evidence/i),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /^mismatch$/i })).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /brand name/i })).toHaveTextContent('Mismatch');
});

it('opens the title-case warning fixture with the shown warning-heading mismatch', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /explore scenarios/i }));
  await user.click(screen.getByRole('button', { name: /title-case warning heading/i }));

  const fixture = screen.getByRole('figure', { name: /illustrative label fixture/i });
  expect(fixture).toHaveTextContent('Produced by North Coast Spirits, Portland, OR');
  expect(within(fixture).getByText('Government Warning:')).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /warning heading/i })).toHaveTextContent('Mismatch');
});

it('shows degraded Old Tom evidence as a low-confidence fixture without live OCR', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /explore scenarios/i }));
  await user.click(screen.getByRole('button', { name: /low-confidence evidence/i }));

  expect(
    screen.getByText(/precomputed low-confidence fixture shown with a visual degradation treatment/i),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('img', {
      name: /label preview: old tom distillery \/ degraded evidence/i,
    }),
  ).toHaveClass('label-preview__image--degraded');
  expect(screen.getByRole('row', { name: /brand name/i })).toHaveTextContent('55% confidence');
  expect(screen.getByRole('heading', { name: /^unreadable$/i })).toBeInTheDocument();
  expect(extractFromImage).not.toHaveBeenCalled();
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
      reviewFlags: emptyReviewFlags(),
    },
  ];

  render(<App initialBatchItems={extractionOnly} />);

  expect(screen.getByText('Application data required')).toBeInTheDocument();
  expect(screen.queryByText(/^Match$/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /open full review for triage\.png/i }),
  ).not.toBeInTheDocument();
});

it('opens a filename-only deadline row in manual review without leaving the queue automatically', async () => {
  const user = userEvent.setup();
  const item: QueueItem = {
    id: 'deadline-triage',
    file: new File(['label'], 'deadline-triage.png', { type: 'image/png' }),
    name: 'deadline-triage.png',
    size: 5,
    reviewFlags: emptyReviewFlags(),
    status: 'manual_review_required',
    progress: 1,
    isManualEvidence: true,
    error: 'OCR stopped after five seconds. Open manual review to inspect the original label.',
    durationMs: 5_000,
  };
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:deadline-triage'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

  try {
    render(<App initialBatchItems={[item]} />);

    expect(
      screen.getByText('Manual review required', { selector: '.batch-status--manual' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Extraction error')).not.toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: /batch review progress/i }),
    ).toHaveTextContent('1 label requires manual review.');
    await user.selectOptions(screen.getByLabelText(/^show$/i), 'manual_review_required');
    await user.click(
      screen.getByRole('button', { name: /view evidence for deadline-triage\.png/i }),
    );
    const evidence = screen.getByRole('region', {
      name: /evidence for deadline-triage\.png/i,
    });
    expect(evidence).not.toHaveTextContent(/Extracted locally in/i);
    expect(
      screen.getByText('OCR stopped after five seconds. Open manual review to inspect the original label.'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /open manual review for deadline-triage\.png/i }),
    );
    expect(screen.getByRole('heading', { name: /manual evidence entry/i })).toBeInTheDocument();
    expect(
      await screen.findByRole('img', { name: /label preview: deadline-triage\.png/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back to batch/i }));
    expect(
      screen.getByText('Manual review required', { selector: '.batch-status--manual' }),
    ).toBeInTheDocument();
  } finally {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreate,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevoke,
    });
  }
});

it('opens an application-backed deadline row with comparison fields without rerunning OCR', async () => {
  const user = userEvent.setup();
  const item: QueueItem = {
    id: 'deadline-application',
    file: new File(['label'], 'deadline-application.png', { type: 'image/png' }),
    name: 'deadline-application.png',
    size: 5,
    application: batchApplication,
    reviewFlags: emptyReviewFlags(),
    status: 'manual_review_required',
    progress: 1,
    extraction: {},
    isManualEvidence: true,
    error: 'OCR stopped after five seconds. Open manual review to inspect the original label.',
    durationMs: 5_000,
  };

  render(<App initialBatchItems={[item]} />);

  await user.click(
    screen.getByRole('button', { name: /open manual review for deadline-application\.png/i }),
  );

  expect(screen.getByRole('heading', { name: /field comparison/i })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /application/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /manual evidence entry/i })).not.toBeInTheDocument();
  expect(
    screen.getByText('OCR stopped after five seconds. Open manual review to inspect the original label.'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Local OCR finished in 5\.0 s on this device\./i)).not.toBeInTheDocument();
  expect(extractFromImage).not.toHaveBeenCalled();
});

it('keeps batch manual values and deliberate blanks when retry OCR returns another deadline', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage)
    .mockResolvedValueOnce({
      extraction: {},
      rawText: '',
      source: 'ocr',
      error: 'deadline-exceeded',
    })
    .mockResolvedValueOnce({
      extraction: {},
      rawText: '',
      source: 'ocr',
      error: 'deadline-exceeded',
    });

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a batch/i }));
  await user.upload(
    screen.getByLabelText(/^choose label images$/i),
    new File(['label'], 'deadline-retry.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: /begin batch review/i }));
  const initialManualReview = await screen.findByRole('button', {
    name: /open manual review for deadline-retry\.png/i,
  });
  expect(
    screen.getByRole('button', { name: /retry OCR for deadline-retry\.png/i }),
  ).toBeInTheDocument();
  await user.click(initialManualReview);
  await user.click(screen.getByRole('button', { name: /add brand name candidate/i }));
  await user.type(
    screen.getByRole('textbox', { name: /brand name agent-entered candidate/i }),
    'HUMAN BRAND',
  );
  await user.click(screen.getByRole('button', { name: /save brand name candidate/i }));
  await user.click(screen.getByRole('button', { name: /add proof candidate/i }));
  await user.type(
    screen.getByRole('textbox', { name: /proof agent-entered candidate/i }),
    '90 Proof',
  );
  await user.click(screen.getByRole('button', { name: /save proof candidate/i }));
  await user.click(screen.getByRole('button', { name: /remove proof evidence/i }));
  await user.click(screen.getByRole('button', { name: /^retry OCR$/i }));

  const returningManualReview = await screen.findByRole('button', {
    name: /open manual review for deadline-retry\.png/i,
  });
  await waitFor(() => {
    expect(returningManualReview).toHaveFocus();
  });
  await user.click(returningManualReview);
  expect(screen.getByText('HUMAN BRAND')).toBeInTheDocument();
  expect(screen.queryByText('90 Proof')).not.toBeInTheDocument();
  expect(extractFromImage).toHaveBeenCalledTimes(2);
});

it('reopens application-backed manual evidence with retry context after a retry returns a generic error', async () => {
  const user = userEvent.setup();
  const file = new File(['label'], 'deadline-error-retry.png', { type: 'image/png' });
  const csvText = [
    'filename,brandName,classType,abv,proof,netContents,producerAddress,isImported,countryOfOrigin',
    'deadline-error-retry.png,OLD TOM,Bourbon Whiskey,45%,90 Proof,750 mL,"Example, KY",false,',
  ].join('\n');
  const csv = new File([csvText], 'applications.csv', { type: 'text/csv' });
  Object.defineProperty(csv, 'text', { configurable: true, value: async () => csvText });
  vi.mocked(extractFromImage)
    .mockResolvedValueOnce({
      extraction: {},
      rawText: '',
      source: 'ocr',
      error: 'deadline-exceeded',
      durationMs: 5_000,
    })
    .mockResolvedValueOnce({
      extraction: { brandName: ocrCandidate('OCR BRAND') },
      rawText: 'OCR BRAND',
      source: 'ocr',
      error: 'The image could not be decoded.',
      durationMs: 1_234,
    });

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a batch/i }));
  await user.upload(
    screen.getByLabelText(/^choose label images$/i),
    file,
  );
  await user.upload(screen.getByLabelText(/^optional application CSV$/i), csv);
  expect(await screen.findByText('Ready: applications.csv')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /begin batch review/i }));
  await user.click(
    await screen.findByRole('button', {
      name: /open manual review for deadline-error-retry\.png/i,
    }),
  );
  await user.click(screen.getByRole('button', { name: /add brand name candidate/i }));
  await user.type(
    screen.getByRole('textbox', { name: /brand name agent-entered candidate/i }),
    'HUMAN BRAND',
  );
  await user.click(screen.getByRole('button', { name: /save brand name candidate/i }));
  await user.click(screen.getByRole('button', { name: /^retry OCR$/i }));

  expect(await screen.findByText('The image could not be decoded.')).toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: /view evidence for deadline-error-retry\.png/i }),
  );
  expect(
    screen.getByRole('region', { name: /evidence for deadline-error-retry\.png/i }),
  ).not.toHaveTextContent(/Extracted locally in/i);
  await user.click(
    screen.getByRole('button', {
      name: /open manual review for deadline-error-retry\.png/i,
    }),
  );

  expect(screen.getByText('HUMAN BRAND')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(
    /OCR retry failed.*manual evidence remains editable/i,
  );
  expect(screen.getByRole('heading', { name: /field comparison/i })).toBeInTheDocument();
  expect(screen.queryByText(/Local OCR finished in 1\.2 s on this device\./i)).not.toBeInTheDocument();
  expect(extractFromImage).toHaveBeenCalledTimes(2);
});

it('reopens preserved batch manual evidence after a manual retry completes without application data', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage)
    .mockResolvedValueOnce({
      extraction: {},
      rawText: '',
      source: 'ocr',
      error: 'deadline-exceeded',
    })
    .mockResolvedValueOnce({
      extraction: {
        brandName: ocrCandidate('OCR BRAND'),
        proof: ocrCandidate('90 Proof'),
        abv: ocrCandidate('45%'),
      },
      rawText: 'OCR BRAND 90 Proof 45%',
      source: 'ocr',
    });

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a batch/i }));
  await user.upload(
    screen.getByLabelText(/^choose label images$/i),
    new File(['label'], 'deadline-no-app-retry.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: /begin batch review/i }));
  await user.click(
    await screen.findByRole('button', {
      name: /open manual review for deadline-no-app-retry\.png/i,
    }),
  );
  await user.click(screen.getByRole('button', { name: /add brand name candidate/i }));
  await user.type(
    screen.getByRole('textbox', { name: /brand name agent-entered candidate/i }),
    'HUMAN BRAND',
  );
  await user.click(screen.getByRole('button', { name: /save brand name candidate/i }));
  await user.click(screen.getByRole('button', { name: /add proof candidate/i }));
  await user.type(
    screen.getByRole('textbox', { name: /proof agent-entered candidate/i }),
    '90 Proof',
  );
  await user.click(screen.getByRole('button', { name: /save proof candidate/i }));
  await user.click(screen.getByRole('button', { name: /remove proof evidence/i }));
  await user.click(screen.getByRole('button', { name: /^retry OCR$/i }));

  expect(await screen.findByText('Application data required')).toBeInTheDocument();
  await user.click(
    screen.getByRole('button', {
      name: /open manual review for deadline-no-app-retry\.png/i,
    }),
  );

  expect(screen.getByText('HUMAN BRAND')).toBeInTheDocument();
  expect(screen.getByText('45%')).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /proof/i })).toHaveTextContent('No evidence entered');
  expect(extractFromImage).toHaveBeenCalledTimes(2);
});

it('returns focus to a direct Retry OCR row action after another deadline', async () => {
  const user = userEvent.setup();
  const retryResult = deferred<ExtractionJobResult>();
  vi.mocked(extractFromImage)
    .mockResolvedValueOnce({
      extraction: {},
      rawText: '',
      source: 'ocr',
      error: 'deadline-exceeded',
    })
    .mockReturnValueOnce(retryResult.promise);

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a batch/i }));
  await user.upload(
    screen.getByLabelText(/^choose label images$/i),
    new File(['label'], 'deadline-row-retry.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: /begin batch review/i }));

  await user.click(
    await screen.findByRole('button', { name: /retry OCR for deadline-row-retry\.png/i }),
  );
  await waitFor(() => {
    expect(screen.getByText('0 of 1 processed')).toBeInTheDocument();
  });

  retryResult.resolve({
    extraction: {},
    rawText: '',
    source: 'ocr',
    error: 'deadline-exceeded',
  });

  const restoredRetry = await screen.findByRole('button', {
    name: /retry OCR for deadline-row-retry\.png/i,
  });
  await waitFor(() => {
    expect(restoredRetry).toHaveFocus();
  });
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
      reviewFlags: emptyReviewFlags(),
      thumbnailUrl: 'blob:triage-evidence-preview',
      rawText: 'OLD TOM\n45% Alc./Vol.',
      durationMs: 1_210,
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
  expect(detail).toHaveTextContent('Extracted locally in 1.2 s.');
  expect(screen.getByRole('img', { name: /label preview: triage-evidence\.png/i })).toBeInTheDocument();
});

it('reports extracted timing for a ready evidence drawer', async () => {
  const user = userEvent.setup();
  const item: QueueItem = {
    ...readyBatchItem('ready-evidence.png'),
    durationMs: 2_345,
  };

  render(<App initialBatchItems={[item]} />);

  await user.click(
    screen.getByRole('button', { name: /view evidence for ready-evidence\.png/i }),
  );

  expect(
    screen.getByRole('region', { name: /evidence for ready-evidence\.png/i }),
  ).toHaveTextContent('Extracted locally in 2.3 s.');
});

it('opens a ready batch row in full review without re-running OCR', async () => {
  const user = userEvent.setup();
  render(<App initialBatchItems={[readyBatchItem()]} />);

  await user.click(
    screen.getByRole('button', { name: /open full review for ready\.png/i }),
  );

  expect(screen.getByRole('button', { name: /back to batch/i })).toBeInTheDocument();
  expect(extractFromImage).not.toHaveBeenCalled();
});

it('moves keyboard focus to the full-review heading after opening a batch item', async () => {
  const user = userEvent.setup();
  render(<App initialBatchItems={[readyBatchItem()]} />);

  const trigger = screen.getByRole('button', {
    name: /open full review for ready\.png/i,
  });
  trigger.focus();
  await user.keyboard('{Enter}');

  expect(
    await screen.findByRole('heading', { name: 'ready.png' }),
  ).toHaveFocus();
});

it('returns focus to the full-review row action after going back to the batch', async () => {
  const user = userEvent.setup();
  render(<App initialBatchItems={[readyBatchItem()]} />);

  const trigger = screen.getByRole('button', {
    name: /open full review for ready\.png/i,
  });
  await user.click(trigger);
  await user.click(screen.getByRole('button', { name: /back to batch/i }));

  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: /open full review for ready\.png/i }),
    ).toHaveFocus();
  });
});

it('releases the full-review object URL when returning to the batch', async () => {
  const user = userEvent.setup();
  const item = readyBatchItem();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const create = vi.fn(() => 'blob:batch-full-review');
  const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });

  try {
    render(<App initialBatchItems={[item]} />);

    await user.click(
      screen.getByRole('button', { name: /open full review for ready\.png/i }),
    );

    expect(create).toHaveBeenCalledWith(item.file);
    await user.click(screen.getByRole('button', { name: /back to batch/i }));

    await waitFor(() => {
      expect(revoke).toHaveBeenCalledWith('blob:batch-full-review');
    });
  } finally {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreate,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevoke,
    });
  }
});

it('revalidates each batch visual confirmation and preserves the queue filter and search after returning', async () => {
  const user = userEvent.setup();
  render(<App initialBatchItems={[readyBatchItem()]} />);

  await user.selectOptions(screen.getByLabelText(/^show$/i), 'needs_review');
  const search = screen.getByRole('searchbox', { name: /search filename/i });
  await user.type(search, 'ready');
  await user.click(
    screen.getByRole('button', { name: /open full review for ready\.png/i }),
  );

  await user.click(
    screen.getByRole('checkbox', {
      name: /i visually confirmed the warning heading is uppercase and bold/i,
    }),
  );
  await user.click(screen.getByRole('button', { name: /back to batch/i }));

  expect(screen.getByLabelText(/^show$/i)).toHaveValue('needs_review');
  expect(screen.getByRole('searchbox', { name: /search filename/i })).toHaveValue('ready');
  const row = screen.getByRole('row', { name: /ready\.png/i });
  expect(within(row).getAllByRole('cell')[3]).toHaveTextContent('1');

  await user.click(
    screen.getByRole('button', { name: /open full review for ready\.png/i }),
  );
  await user.click(
    screen.getByRole('checkbox', {
      name: /i reviewed warning legibility, contrast, and placement/i,
    }),
  );
  await user.click(screen.getByRole('button', { name: /back to batch/i }));

  expect(screen.getByLabelText(/^show$/i)).toHaveValue('needs_review');
  expect(screen.getByRole('searchbox', { name: /search filename/i })).toHaveValue('ready');
  expect(screen.getByText(/no matching labels/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^show$/i)).toHaveFocus();
  await user.selectOptions(screen.getByLabelText(/^show$/i), 'match');
  expect(screen.getByRole('row', { name: /ready\.png/i })).toHaveTextContent('Match');
  expect(extractFromImage).not.toHaveBeenCalled();
});

it('keeps raw OCR evidence when a batch correction becomes agent-entered', async () => {
  const user = userEvent.setup();
  const item = readyBatchItem();
  render(<App initialBatchItems={[item]} />);

  await user.click(
    screen.getByRole('button', { name: /open full review for ready\.png/i }),
  );
  await user.click(
    screen.getByRole('button', { name: /correct brand name candidate/i }),
  );
  const correction = screen.getByRole('textbox', {
    name: /brand name corrected candidate/i,
  });
  await user.clear(correction);
  await user.type(correction, 'OLD TOM RESERVE');
  await user.click(
    screen.getByRole('button', { name: /save brand name correction/i }),
  );

  const brandRow = screen.getByRole('row', { name: /brand name/i });
  expect(brandRow).toHaveTextContent('Agent-entered');
  expect(brandRow).toHaveTextContent('Human-verified');
  expect(brandRow).toHaveTextContent('Raw OCR: OLD TOM FROM OCR');
  expect(item.extraction?.brandName).toMatchObject({
    value: 'OLD TOM RESERVE',
    rawText: 'OLD TOM FROM OCR',
    confidence: 1,
    source: 'agent',
  });

  await user.click(screen.getByRole('button', { name: /back to batch/i }));
  expect(screen.getByRole('row', { name: /ready\.png/i })).toHaveTextContent('Mismatch');
});

it('keeps active batch work running while a ready item is in full review', async () => {
  const user = userEvent.setup();
  const secondExtraction = deferred<ExtractionJobResult>();
  const first = readyBatchItem('first-live.png');
  const second = readyBatchItem('second-live.png');
  const csvText = [
    'filename,brandName,classType,abv,proof,netContents,producerAddress,isImported,countryOfOrigin',
    'first-live.png,OLD TOM,Bourbon Whiskey,45%,90 Proof,750 mL,"Example, KY",false,',
    'second-live.png,OLD TOM,Bourbon Whiskey,45%,90 Proof,750 mL,"Example, KY",false,',
  ].join('\n');
  const csv = new File([csvText], 'applications.csv', { type: 'text/csv' });
  Object.defineProperty(csv, 'text', { configurable: true, value: async () => csvText });
  vi.mocked(extractFromImage).mockImplementation((file) =>
    file.name === first.name
      ? Promise.resolve({
          extraction: first.extraction!,
          rawText: first.rawText!,
          source: 'ocr',
        })
      : secondExtraction.promise,
  );

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a batch/i }));
  await user.upload(
    screen.getByLabelText(/^choose label images$/i),
    [first.file, second.file],
  );
  await user.upload(screen.getByLabelText(/^optional application CSV$/i), csv);
  expect(await screen.findByText('Ready: applications.csv')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /begin batch review/i }));

  await user.click(
    await screen.findByRole('button', {
      name: /open full review for first-live\.png/i,
    }),
  );
  secondExtraction.resolve({
    extraction: second.extraction!,
    rawText: second.rawText!,
    source: 'ocr',
  });

  await user.click(screen.getByRole('button', { name: /back to batch/i }));

  expect(
    await screen.findByRole('button', {
      name: /open full review for second-live\.png/i,
    }),
  ).toBeInTheDocument();
  expect(screen.getByText('2 of 2 processed')).toBeInTheDocument();
  expect(extractFromImage).toHaveBeenCalledTimes(2);
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
  expect(screen.getByRole('link', { name: /inspect the fixture text/i })).toHaveAttribute(
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
    screen.getByText(/precomputed fixture — not a live OCR timing result/i),
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

it('opens preserved manual evidence review for a deadline result and focuses its disclosure', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue('blob:old-tom'),
    revokeObjectURL: vi.fn(),
  });
  vi.mocked(extractFromImage).mockResolvedValueOnce({
    extraction: {},
    rawText: '',
    source: 'ocr',
    error: 'deadline-exceeded',
  });

  await startManualReview(user);

  expect(await screen.findByText(/OCR stopped after five seconds/i)).toHaveFocus();
  expect(screen.getByRole('img', { name: /label preview: old-tom\.png/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /retry OCR/i })).toBeInTheDocument();
  expect(screen.queryByRole('status', { name: /label extraction progress/i })).not.toBeInTheDocument();
});

it('prevents a duplicate manual OCR retry while the first retry is processing', async () => {
  const user = userEvent.setup();
  const retryResult = deferred<ExtractionJobResult>();
  const duplicateRetryResult = deferred<ExtractionJobResult>();
  vi.mocked(extractFromImage)
    .mockResolvedValueOnce({
      extraction: {},
      rawText: '',
      source: 'ocr',
      error: 'deadline-exceeded',
    })
    .mockReturnValueOnce(retryResult.promise)
    .mockReturnValueOnce(duplicateRetryResult.promise);

  await startManualReview(user);

  const retryButton = await screen.findByRole('button', { name: /^retry OCR$/i });
  act(() => {
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
  });

  await waitFor(() => {
    expect(extractFromImage).toHaveBeenCalledTimes(2);
  });
  const retrySignal = vi.mocked(extractFromImage).mock.calls[1]?.[2]?.signal;
  expect(retrySignal).toBeDefined();
  expect(retrySignal?.aborted).toBe(false);
  expect(screen.getByRole('button', { name: /^retry OCR$/i })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: /^retry OCR$/i }));
  expect(extractFromImage).toHaveBeenCalledTimes(2);
  expect(retrySignal?.aborted).toBe(false);

  retryResult.resolve({
    extraction: {},
    rawText: '',
    source: 'ocr',
    error: 'deadline-exceeded',
  });

  expect(await screen.findByText(/OCR stopped after five seconds/i)).toHaveFocus();
  expect(screen.getByRole('button', { name: /^retry OCR$/i })).toBeEnabled();
  expect(extractFromImage).toHaveBeenCalledTimes(2);
});

it('does not present OCR candidates supplied with a deadline result', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage).mockResolvedValueOnce({
    extraction: { brandName: ocrCandidate('WRONG OCR') },
    rawText: 'WRONG OCR',
    source: 'ocr',
    error: 'deadline-exceeded',
  });

  await startManualReview(user);

  expect(await screen.findByText(/OCR stopped after five seconds/i)).toBeInTheDocument();
  expect(screen.queryByText('WRONG OCR')).not.toBeInTheDocument();
});

it('keeps manual evidence editable when a deadline retry returns an ordinary OCR error', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:deadline-retry-error'),
    revokeObjectURL: vi.fn(),
  });
  vi.mocked(extractFromImage)
    .mockResolvedValueOnce({
      extraction: {},
      rawText: '',
      source: 'ocr',
      error: 'deadline-exceeded',
    })
    .mockResolvedValueOnce({
      extraction: {},
      rawText: '',
      source: 'ocr',
      error: 'unreadable',
    });

  await startManualReview(user);
  await enterManualRecoveryEvidence(user);
  await user.click(screen.getByRole('button', { name: /retry OCR/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    /OCR retry failed.*manual evidence remains editable/i,
  );
  expect(screen.getByRole('img', { name: /label preview: old-tom\.png/i })).toBeInTheDocument();
  expect(screen.getByText('HUMAN BRAND')).toBeInTheDocument();
  expect(screen.queryByText('90 Proof')).not.toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', { name: /warning heading is uppercase and bold/i }),
  ).toBeChecked();
  expect(screen.getByRole('button', { name: /add proof candidate/i })).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();
});

it('keeps manual evidence editable when a deadline retry rejects', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:deadline-retry-rejection'),
    revokeObjectURL: vi.fn(),
  });
  vi.mocked(extractFromImage)
    .mockResolvedValueOnce({
      extraction: {},
      rawText: '',
      source: 'ocr',
      error: 'deadline-exceeded',
    })
    .mockRejectedValueOnce(new Error('worker failed'));

  await startManualReview(user);
  await enterManualRecoveryEvidence(user);
  await user.click(screen.getByRole('button', { name: /retry OCR/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    /OCR retry failed.*manual evidence remains editable/i,
  );
  expect(screen.getByRole('img', { name: /label preview: old-tom\.png/i })).toBeInTheDocument();
  expect(screen.getByText('HUMAN BRAND')).toBeInTheDocument();
  expect(screen.queryByText('90 Proof')).not.toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', { name: /warning heading is uppercase and bold/i }),
  ).toBeChecked();
  expect(screen.getByRole('button', { name: /add proof candidate/i })).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();
});

it('keeps human value, deliberate blank, and visual flags when retry OCR fills an untouched field', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage)
    .mockResolvedValueOnce({
      extraction: {},
      rawText: '',
      source: 'ocr',
      error: 'deadline-exceeded',
    })
    .mockResolvedValueOnce({
      extraction: {
        brandName: ocrCandidate('OCR BRAND'),
        proof: ocrCandidate('90 Proof'),
        abv: ocrCandidate('45%'),
      },
      rawText: 'OCR BRAND 90 Proof 45%',
      source: 'ocr',
    });

  await startManualReview(user);
  await user.click(await screen.findByRole('button', { name: /add brand name candidate/i }));
  await user.type(
    screen.getByRole('textbox', { name: /brand name agent-entered candidate/i }),
    'HUMAN BRAND',
  );
  await user.click(screen.getByRole('button', { name: /save brand name candidate/i }));
  await user.click(screen.getByRole('button', { name: /add proof candidate/i }));
  await user.type(
    screen.getByRole('textbox', { name: /proof agent-entered candidate/i }),
    '90 Proof',
  );
  await user.click(screen.getByRole('button', { name: /save proof candidate/i }));
  await user.click(screen.getByRole('button', { name: /remove proof evidence/i }));
  expect(screen.getByRole('button', { name: /add proof candidate/i })).toHaveFocus();
  await user.click(
    screen.getByRole('checkbox', { name: /warning heading is uppercase and bold/i }),
  );
  await user.click(screen.getByRole('button', { name: /retry OCR/i }));

  expect(await screen.findByText('HUMAN BRAND')).toBeInTheDocument();
  expect(
    within(screen.getByRole('row', { name: /brand name/i })).getByText('Agent-entered'),
  ).toBeInTheDocument();
  expect(screen.queryByText('90 Proof')).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('row', { name: /alcohol by volume/i })).getByRole('button', {
      name: /correct alcohol by volume candidate/i,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', { name: /warning heading is uppercase and bold/i }),
  ).toBeChecked();
  expect(screen.getByText(/OCR stopped after five seconds/i)).not.toHaveFocus();
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
  expect(fetchSample).toHaveBeenCalledWith(
    '/demo/old-tom-bourbon.jpg',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(extractFromImage).toHaveBeenCalledTimes(2);
  expect(extractFromImage).toHaveBeenNthCalledWith(
    1,
    expect.any(File),
    expect.any(Function),
    expect.objectContaining({ deadlineMs: null }),
  );
  expect(extractFromImage).toHaveBeenNthCalledWith(
    2,
    expect.any(File),
    expect.any(Function),
    expect.objectContaining({ deadlineMs: null }),
  );
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

it('cancels a pending benchmark fetch when navigation unmounts the panel', async () => {
  const user = userEvent.setup();
  const response = deferred<{ ok: boolean; blob: () => Promise<Blob> }>();
  let fetchSignal: AbortSignal | undefined;
  const fetchSample = vi.fn((_url: string, init?: RequestInit) => {
    fetchSignal = init?.signal ?? undefined;
    return response.promise;
  });
  vi.stubGlobal('fetch', fetchSample);

  render(<App />);
  await user.click(screen.getByRole('button', { name: /run local sample benchmark/i }));
  await user.click(screen.getByRole('button', { name: /^run benchmark$/i }));

  expect(fetchSignal).toBeDefined();
  await user.click(screen.getByRole('button', { name: /^new review$/i }));

  expect(fetchSignal?.aborted).toBe(true);
  expect(
    screen.getByRole('heading', { name: /start with the facts submitted for review/i }),
  ).toBeInTheDocument();

  await act(async () => {
    response.resolve({
      ok: true,
      blob: async () => new Blob(['sample'], { type: 'image/jpeg' }),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(extractFromImage).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: /first sample run/i })).not.toBeInTheDocument();
});

it('cancels a pending benchmark OCR and ignores its cancelled result after navigation', async () => {
  const user = userEvent.setup();
  let extractionSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['sample'], { type: 'image/jpeg' }),
  }));
  vi.mocked(extractFromImage).mockImplementationOnce((_file, _onProgress, options) => {
    extractionSignal = options?.signal;
    return new Promise<ExtractionJobResult>((resolve) => {
      options?.signal?.addEventListener('abort', () => {
        resolve({ extraction: {}, rawText: '', source: 'ocr', error: 'cancelled' });
      }, { once: true });
    });
  });

  render(<App />);
  await user.click(screen.getByRole('button', { name: /run local sample benchmark/i }));
  await user.click(screen.getByRole('button', { name: /^run benchmark$/i }));
  await waitFor(() => {
    expect(extractionSignal).toBeDefined();
  });

  await user.click(screen.getByRole('button', { name: /^new review$/i }));

  expect(extractionSignal?.aborted).toBe(true);
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    screen.getByRole('heading', { name: /start with the facts submitted for review/i }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /first sample run/i })).not.toBeInTheDocument();
});

it('keeps the benchmark runnable after Strict Mode replays its lifecycle cleanup', async () => {
  const user = userEvent.setup();
  const fetchSample = vi.fn().mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['sample'], { type: 'image/jpeg' }),
  });
  vi.stubGlobal('fetch', fetchSample);
  vi.mocked(extractFromImage).mockResolvedValue({
    extraction: {},
    rawText: '',
    source: 'ocr',
  });

  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await user.click(screen.getByRole('button', { name: /run local sample benchmark/i }));
  await user.click(screen.getByRole('button', { name: /^run benchmark$/i }));

  await waitFor(() => {
    expect(fetchSample).toHaveBeenCalledTimes(1);
  });
});

it('preserves fixture evidence when an agent corrects an extracted candidate', async () => {
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
  expect(screen.getByText(/fixture text: OLD TOM DISTILLERY/i)).toBeInTheDocument();
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

it('reports an out-of-scope beverage before requiring a label image', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.type(screen.getByRole('textbox', { name: /^brand name$/i }), 'Old Tom');
  await user.type(screen.getByRole('textbox', { name: /class\/type/i }), 'Wine');
  await user.type(screen.getByRole('textbox', { name: /alcohol by volume/i }), '45%');
  await user.type(screen.getByRole('textbox', { name: /net contents/i }), '750 mL');
  await user.type(screen.getByRole('textbox', { name: /producer address/i }), 'Old Tom, KY');

  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  const scopeError = screen.getByRole('alert');
  expect(scopeError).toHaveTextContent(
    /proofline is limited to u\.s\. distilled-spirit labels/i,
  );
  expect(scopeError).not.toHaveTextContent(/choose a jpeg, png, or webp label image/i);
  expect(extractFromImage).not.toHaveBeenCalled();
});

it('reports an out-of-scope imported beverage before image or origin validation', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.type(screen.getByRole('textbox', { name: /^brand name$/i }), 'Old Tom');
  await user.type(screen.getByRole('textbox', { name: /class\/type/i }), 'Wine');
  await user.type(screen.getByRole('textbox', { name: /alcohol by volume/i }), '45%');
  await user.type(screen.getByRole('textbox', { name: /net contents/i }), '750 mL');
  await user.type(screen.getByRole('textbox', { name: /producer address/i }), 'Old Tom, KY');
  await user.click(screen.getByRole('checkbox', { name: /imported product/i }));

  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  const scopeError = screen.getByRole('alert');
  expect(scopeError).toHaveTextContent(
    /proofline is limited to u\.s\. distilled-spirit labels/i,
  );
  expect(scopeError).not.toHaveTextContent(/choose a jpeg, png, or webp label image/i);
  expect(scopeError).not.toHaveTextContent(/country of origin is required/i);
  expect(extractFromImage).not.toHaveBeenCalled();
});

it('clears stale image validation when a retry becomes out of scope', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.type(screen.getByRole('textbox', { name: /^brand name$/i }), 'Old Tom');
  const classType = screen.getByRole('textbox', { name: /class\/type/i });
  await user.type(classType, 'Bourbon Whiskey');
  await user.type(screen.getByRole('textbox', { name: /alcohol by volume/i }), '45%');
  await user.type(screen.getByRole('textbox', { name: /net contents/i }), '750 mL');
  await user.type(screen.getByRole('textbox', { name: /producer address/i }), 'Old Tom, KY');

  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  const imageInput = screen.getByLabelText(/^choose label image$/i);
  expect(imageInput).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent(
    /choose a jpeg, png, or webp label image/i,
  );

  await user.clear(classType);
  await user.type(classType, 'Wine');
  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent(
    /proofline is limited to u\.s\. distilled-spirit labels/i,
  );
  expect(screen.queryByText(/choose a jpeg, png, or webp label image/i)).not.toBeInTheDocument();
  expect(imageInput).not.toHaveAttribute('aria-invalid', 'true');
  expect(extractFromImage).not.toHaveBeenCalled();
});

it('clears stale origin validation when an imported retry becomes out of scope', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.type(screen.getByRole('textbox', { name: /^brand name$/i }), 'Old Tom');
  const classType = screen.getByRole('textbox', { name: /class\/type/i });
  await user.type(classType, 'Bourbon Whiskey');
  await user.type(screen.getByRole('textbox', { name: /alcohol by volume/i }), '45%');
  await user.type(screen.getByRole('textbox', { name: /net contents/i }), '750 mL');
  await user.type(screen.getByRole('textbox', { name: /producer address/i }), 'Old Tom, KY');
  await user.click(screen.getByRole('checkbox', { name: /imported product/i }));
  await user.upload(
    screen.getByLabelText(/^choose label image$/i),
    new File(['label'], 'old-tom.png', { type: 'image/png' }),
  );

  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  const countryOfOrigin = screen.getByRole('textbox', { name: /country of origin/i });
  expect(countryOfOrigin).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent(
    /country of origin is required for an imported product/i,
  );

  await user.clear(classType);
  await user.type(classType, 'Wine');
  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent(
    /proofline is limited to u\.s\. distilled-spirit labels/i,
  );
  expect(countryOfOrigin).not.toHaveAttribute('aria-invalid', 'true');
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
