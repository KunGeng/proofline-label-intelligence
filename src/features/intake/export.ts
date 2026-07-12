import type { QueueItem } from './queue';

const RESULT_HEADERS = [
  'filename',
  'status',
  'overallState',
  'matchCount',
  'mismatchCount',
  'needsReviewCount',
  'unreadableCount',
  'error',
] as const;

type ResultCounts = Record<
  'match' | 'mismatch' | 'needs_review' | 'unreadable',
  number
>;

const emptyCounts = (): ResultCounts => ({
  match: 0,
  mismatch: 0,
  needs_review: 0,
  unreadable: 0,
});

const countFieldStates = (item: QueueItem): ResultCounts =>
  item.result?.fields.reduce<ResultCounts>((counts, field) => {
    counts[field.state] += 1;
    return counts;
  }, emptyCounts()) ?? emptyCounts();

const escapeCell = (value: string | number): string => {
  const text = String(value);

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const serializeResults = (items: QueueItem[]): string => {
  const rows = items.map((item) => {
    const counts = countFieldStates(item);
    const values = [
      item.name,
      item.status,
      item.result?.overallState ?? '',
      item.result ? counts.match : '',
      item.result ? counts.mismatch : '',
      item.result ? counts.needs_review : '',
      item.result ? counts.unreadable : '',
      item.error ?? '',
    ];

    return values.map(escapeCell).join(',');
  });

  return [RESULT_HEADERS.join(','), ...rows].join('\n');
};

export const downloadCsv = (items: QueueItem[]): void => {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof URL.revokeObjectURL !== 'function'
  ) {
    return;
  }

  const blob = new Blob([serializeResults(items)], { type: 'text/csv;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = 'proofline-batch-results.csv';
  anchor.hidden = true;
  document.body.append(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
};
