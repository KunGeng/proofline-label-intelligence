import type { QueueItem } from './queue';
import { downloadCsv, serializeResults } from './export';

const item = ({
  reviewFlags = {
    warningTypographyConfirmed: false,
    warningLegibilityConfirmed: false,
  },
  ...overrides
}: Partial<QueueItem> = {}): QueueItem => ({
  id: 'example',
  file: new File(['label'], 'example.png', { type: 'image/png' }),
  name: 'example.png',
  size: 5,
  reviewFlags,
  status: 'ready',
  progress: 1,
  result: {
    overallState: 'needs_review',
    fields: [
      {
        field: 'brandName',
        state: 'match',
        expected: 'Old Tom',
        observed: 'Old Tom',
        reason: 'Exact text match.',
      },
      {
        field: 'warningText',
        state: 'mismatch',
        expected: 'Expected',
        observed: 'Observed',
        reason: 'Text differs.',
      },
      {
        field: 'warningTypography',
        state: 'needs_review',
        expected: 'Agent confirmation required',
        observed: 'Awaiting agent confirmation',
        reason: 'Agent review required.',
      },
      {
        field: 'countryOfOrigin',
        state: 'unreadable',
        expected: 'Canada',
        observed: '',
        reason: 'No readable text.',
      },
    ],
  },
  ...overrides,
});

describe('serializeResults', () => {
  it('uses the documented header order and reports field-state totals with findings', () => {
    expect(serializeResults([item()])).toBe(
      'filename,status,overallState,matchCount,mismatchCount,needsReviewCount,unreadableCount,findings,error\n' +
        'example.png,ready,needs_review,1,1,1,1,warningText: mismatch; warningTypography: needs_review; countryOfOrigin: unreadable,',
    );
  });

  it('escapes commas, quotes, and line breaks without changing the schema', () => {
    const result = serializeResults([
      item({
        name: 'Old, "Tom"\nReserve.png',
        status: 'error',
        result: undefined,
        error: 'OCR said "no", retry.',
      }),
    ]);

    expect(result).toBe(
      'filename,status,overallState,matchCount,mismatchCount,needsReviewCount,unreadableCount,findings,error\n"Old, ""Tom""\nReserve.png",error,,,,,,,"OCR said ""no"", retry."',
    );
  });

  it('neutralizes formula-leading user values without trimming ordinary text', () => {
    const formulaValues = ['=SUM(A1:A2)', '+SUM(A1:A2)', '-10', '@malicious'];
    const result = serializeResults(
      formulaValues.map((value, index) => item({
        id: `formula-${index}`,
        name: value,
        status: 'error',
        result: undefined,
        error: value,
      })),
    );

    for (const value of formulaValues) {
      expect(result).toContain(`'${value}`);
    }
    expect(serializeResults([
      item({ name: ' =SUM(A1:A2)', status: 'error', result: undefined, error: '' }),
    ])).toContain(' =SUM(A1:A2),error');
  });

  it('keeps a deadline manual-review status and reason in the existing status and error columns', () => {
    const result = serializeResults([
      item({
        status: 'manual_review_required',
        result: undefined,
        error: 'OCR stopped after five seconds. Open manual review to inspect the original label.',
      }),
    ]);

    expect(result.split('\n')[1]?.split(',')).toEqual([
      'example.png',
      'manual_review_required',
      '',
      '',
      '',
      '',
      '',
      '',
      'OCR stopped after five seconds. Open manual review to inspect the original label.',
    ]);
  });

  it('returns the header alone for an empty queue', () => {
    expect(serializeResults([])).toBe(
      'filename,status,overallState,matchCount,mismatchCount,needsReviewCount,unreadableCount,findings,error',
    );
  });
});

describe('downloadCsv', () => {
  it('downloads a browser-local CSV and revokes its temporary object URL', () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const create = vi.fn(() => 'blob:batch-results');
    const revoke = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });

    try {
      downloadCsv([item()]);

      expect(create).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith('blob:batch-results');
    } finally {
      click.mockRestore();
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke });
    }
  });
});
