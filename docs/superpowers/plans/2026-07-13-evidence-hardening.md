# Evidence Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a conservative, browser-local label-review upgrade with correct import-origin handling, complete batch handoff, field-level OCR confidence, speed recovery, benchmark evidence, scenario fixtures, and an updated public deployment.

**Architecture:** Keep the static React/Vite application and same-origin Tesseract assets. Replace page-wide OCR confidence with a resolver derived from matched word/line confidence, expose a reusable OCR-engine facade for extraction and prewarming, and keep an embedded `ReviewDesk` mounted inside batch review so a row can be completed without interrupting the queue.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, tesseract.js 5, pnpm 11.12.0, Sites static hosting.

## Global Constraints

- Never upload label images, application facts, OCR text, benchmark results, or corrections.
- Do not add a backend, cloud OCR, authentication, persistence, COLA integration, analytics, or telemetry.
- Preserve raw OCR text after corrections and mark corrections `Agent-entered` with confidence `1`.
- The UI must never call a label `approved`; a clean result remains “No discrepancies detected — agent approval required.”
- Keep U.S. distilled-spirit prototype scope; block only explicitly out-of-scope beer, wine, cider, seltzer, malt, and ready-to-drink terms.
- Do not claim a universal sub-five-second OCR guarantee. Offer a visible five-second recovery and show device-local measurements.
- Keep batch concurrency at two workers and image selection at 300 files.
- Retain accessible labels, `aria-live` status, keyboard focus restoration, and object-URL cleanup.

---

## File Structure

| File | Responsibility after this work |
| --- | --- |
| `src/domain/types.ts` | Review flags, warning-legibility field, candidate/extraction contracts. |
| `src/domain/validation.ts` | Conservative import-origin and two-part warning visual validation. |
| `src/domain/scope.ts` | Explicit unsupported-beverage detection shared by single and CSV intake. |
| `src/features/extraction/confidence.ts` | Match raw candidate evidence to OCR word/line confidences. |
| `src/features/extraction/parser.ts` | Resolver-aware candidates and bounded multiline importer/address extraction. |
| `src/features/extraction/ocr.ts` | OCR-engine facade, pooled prewarm, timings, abort-safe extraction. |
| `src/features/extraction/types.ts` | Extraction timing and optional abort contract. |
| `src/features/intake/queue.ts` | Retained application data and per-row review flags. |
| `src/components/ReviewDesk.tsx` | Generic exit action, slow-recovery controls, legibility confirmation, fixture evidence. |
| `src/components/BatchQueue.tsx` | Mounted batch-owned full-review handoff and row revalidation. |
| `src/components/BenchmarkPanel.tsx` | On-device two-run sample benchmark. |
| `src/components/DemoLabelFixture.tsx` | Truthful HTML/CSS label fixtures for scenario evidence. |
| `src/components/Landing.tsx` | Scenario chooser and benchmark entry point. |
| `src/components/IntakeForm.tsx` | Explicit scope guard before OCR. |
| `src/App.tsx` | Intent-triggered prewarm, slow/manual single review, scenario routing, benchmark view. |
| `src/features/demo/cases.ts` | Self-contained disclosed demo cases. |
| `src/styles.css` | Responsive styles for slow recovery, benchmark, fixtures, and embedded batch review. |
| `README.md`, `docs/DESIGN.md`, `.github/workflows/ci.yml`, `src/readme.test.ts` | Accurate setup, behavior, benchmark, scope, and toolchain documentation. |

## Task 1: Make validation conservative and enforce explicit product scope

**Files:**
- Create: `src/domain/scope.ts`
- Test: `src/domain/scope.test.ts`
- Modify: `src/domain/types.ts`, `src/domain/constants.ts`, `src/domain/validation.ts`, `src/domain/validation.test.ts`, `src/components/IntakeForm.tsx`, `src/features/intake/csv.ts`, `src/features/intake/csv.test.ts`

**Interfaces:**
- Produces `ReviewFlags`, `isExplicitlyOutOfScopeBeverage(value)`, `unsupportedBeverageMessage(value)`, and the `warningLegibility` field.
- Consumes existing `ApplicationData`, `LabelExtraction`, and validator field-state precedence.
- Later tasks use `ReviewFlags` on single and batch reviews.

- [ ] **Step 1: Write failing domain tests for the new flags and import-origin rule**

```ts
it('routes readable foreign origin evidence on a domestic declaration to review', () => {
  const result = validateLabel(fixture(
    { countryOfOrigin: candidate('Scotland', 0.96) },
    { warningTypographyConfirmed: true, warningLegibilityConfirmed: true },
  ));

  expect(byField(result, 'countryOfOrigin')).toMatchObject({
    state: 'needs_review',
    expected: 'Domestic product declared',
  });
});

it('requires a separate warning-legibility confirmation', () => {
  const result = validateLabel(fixture({}, {
    warningTypographyConfirmed: true,
    warningLegibilityConfirmed: false,
  }));

  expect(byField(result, 'warningLegibility')).toMatchObject({ state: 'needs_review' });
});
```

- [ ] **Step 2: Write failing scope tests**

```ts
it.each(['wine', 'Malt beverage', 'hard cider', 'ready-to-drink seltzer'])(
  'rejects explicitly unsupported %s',
  (classType) => expect(isExplicitlyOutOfScopeBeverage(classType)).toBe(true),
);

it.each(['Kentucky Straight Bourbon Whiskey', 'Cognac', 'Rum'])
  ('does not reject a potentially distilled %s', (classType) => {
    expect(isExplicitlyOutOfScopeBeverage(classType)).toBe(false);
  });
```

- [ ] **Step 3: Run the focused tests to verify failure**

Run: `pnpm test:run src/domain/validation.test.ts src/domain/scope.test.ts src/features/intake/csv.test.ts`

Expected: FAIL because `ReviewFlags`, `warningLegibility`, and scope exports do not exist.

- [ ] **Step 4: Add review flags and the new warning field**

```ts
// src/domain/types.ts
export interface ReviewFlags {
  warningTypographyConfirmed: boolean;
  warningLegibilityConfirmed: boolean;
}

export interface ValidationInput {
  application: ApplicationData;
  extraction: LabelExtraction;
  flags: ReviewFlags;
}
```

Add `'warningLegibility'` to `FieldKey` and `fieldLabels`. Implement this validator helper:

```ts
const warningLegibilityField = (confirmed: boolean): FieldResult => ({
  field: 'warningLegibility',
  state: confirmed ? 'match' : 'needs_review',
  expected: 'Agent confirmation required',
  observed: confirmed ? 'Agent-confirmed' : 'Awaiting agent confirmation',
  reason: confirmed
    ? 'An agent reviewed warning legibility, contrast, and placement.'
    : 'Warning legibility, contrast, and placement require explicit agent confirmation.',
});
```

Insert this field after `warningTypographyField` in `validateLabel`.

- [ ] **Step 5: Change domestic-origin handling without claiming a legal determination**

```ts
if (!input.application.isImported) {
  const originState = candidateState(input.extraction.countryOfOrigin);
  if (originState !== 'unreadable') {
    return withCandidate(
      'countryOfOrigin',
      'needs_review',
      'Domestic product declared',
      input.extraction.countryOfOrigin,
      'Readable origin evidence may conflict with the domestic declaration; verify import status.',
    );
  }

  return withCandidate(
    'countryOfOrigin',
    'match',
    'Not required for domestic product',
    input.extraction.countryOfOrigin,
    'Country of origin is not required for a domestic product.',
  );
}
```

- [ ] **Step 6: Add the shared scope helper and wire it into both intake paths**

```ts
// src/domain/scope.ts
const unsupportedPattern = /\b(?:beer|wine|cider|seltzer|malt|ready[- ]to[- ]drink|rtd)\b/i;

export const isExplicitlyOutOfScopeBeverage = (classType: string): boolean =>
  unsupportedPattern.test(classType);

export const unsupportedBeverageMessage =
  'Proofline is limited to U.S. distilled-spirit labels. Beer, wine, cider, seltzer, malt, and ready-to-drink products are outside this prototype.';
```

In `IntakeForm.submit`, append the scope error before `onSubmit`; in `parseBatchCsv`, append a line-numbered scope error before creating a `QueueJob`:

```ts
if (isExplicitlyOutOfScopeBeverage(values.classType ?? '')) {
  errors.push(`Row ${line}: ${unsupportedBeverageMessage}`);
  continue;
}
```

- [ ] **Step 7: Update all validation callers with both flags**

Use this base value everywhere a full review is created:

```ts
const emptyReviewFlags: ReviewFlags = {
  warningTypographyConfirmed: false,
  warningLegibilityConfirmed: false,
};
```

Fixture tests that intentionally expect a clean result must pass both confirmations as `true`.

- [ ] **Step 8: Run focused tests and typecheck**

Run: `pnpm test:run src/domain/validation.test.ts src/domain/scope.test.ts src/features/intake/csv.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 9: Commit the independent validation/scope change**

```bash
git add src/domain src/components/IntakeForm.tsx src/features/intake/csv.ts src/features/intake/csv.test.ts
git commit -m "feat: harden validation and product scope"
```

## Task 2: Derive conservative per-field confidence and parse real-world addresses

**Files:**
- Create: `src/features/extraction/confidence.ts`, `src/features/extraction/confidence.test.ts`
- Modify: `src/features/extraction/parser.ts`, `src/features/extraction/parser.test.ts`

**Interfaces:**
- Produces `createCandidateConfidenceResolver(words, lines)` returning `(rawEvidence: string) => number`.
- Produces `extractFromText(rawText, confidence: number | CandidateConfidenceResolver)`.
- OCR engine in Task 3 consumes this resolver.

- [ ] **Step 1: Write failing resolver tests**

```ts
it('uses the weakest matched word confidence for a candidate', () => {
  const confidenceFor = createCandidateConfidenceResolver(
    [{ text: '45%', confidence: 96 }, { text: 'Alc./Vol.', confidence: 62 }],
    [],
  );

  expect(confidenceFor('45% Alc./Vol.')).toBe(0.62);
});

it('returns below-readable confidence when evidence cannot be aligned', () => {
  expect(createCandidateConfidenceResolver([], [])('Unknown evidence')).toBeLessThan(0.6);
});
```

- [ ] **Step 2: Write failing parser tests for imported and wrapped addresses**

```ts
it('captures a wrapped importer address without swallowing warning text', () => {
  const extraction = extractFromText(`IMPORTED BY Harbor Imports\n12 Wharf Street\nBoston, MA 02110\nGOVERNMENT WARNING: ${CANONICAL_WARNING_BODY}`, 0.96);

  expect(extraction.producerAddress).toMatchObject({
    value: 'Harbor Imports 12 Wharf Street Boston, MA 02110',
    rawText: 'IMPORTED BY Harbor Imports\n12 Wharf Street\nBoston, MA 02110',
  });
});
```

- [ ] **Step 3: Run focused parser tests to verify failure**

Run: `pnpm test:run src/features/extraction/confidence.test.ts src/features/extraction/parser.test.ts`

Expected: FAIL because the resolver and multiline importer extraction do not exist.

- [ ] **Step 4: Implement confidence normalization and contiguous token matching**

```ts
export interface OcrConfidenceToken {
  text: string;
  confidence: number;
}

const unreadableConfidence = 0.59;
const normalizeToken = (value: string): string =>
  value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim();

export const createCandidateConfidenceResolver = (
  words: OcrConfidenceToken[],
  lines: OcrConfidenceToken[],
) => (rawEvidence: string): number => {
  const evidence = normalizeToken(rawEvidence).split(' ').filter(Boolean);
  const pageWords = words.map((word) => ({ ...word, text: normalizeToken(word.text) }));
  const start = pageWords.findIndex((_, index) =>
    evidence.every((token, offset) => pageWords[index + offset]?.text === token),
  );

  if (start >= 0) {
    return Math.min(...pageWords.slice(start, start + evidence.length).map((word) => word.confidence / 100));
  }

  const line = lines.find((candidate) => normalizeToken(candidate.text).includes(normalizeToken(rawEvidence)));
  return line ? Math.max(0, Math.min(1, line.confidence / 100)) : unreadableConfidence;
};
```

Keep raw tokens intact for matching before normalization if a punctuation-only token would otherwise vanish.

- [ ] **Step 5: Make parser candidate construction resolver-aware**

```ts
export type CandidateConfidenceResolver = (rawEvidence: string) => number;

const confidenceFor = (
  rawEvidence: string,
  confidence: number | CandidateConfidenceResolver,
): number => typeof confidence === 'function' ? confidence(rawEvidence) : confidence;

const candidate = (
  value: string,
  rawText: string,
  confidence: number | CandidateConfidenceResolver,
): Candidate => ({
  value: normalizeWhitespace(value),
  rawText,
  confidence: confidenceFor(rawText, confidence),
  source: 'ocr',
});
```

Update all parser call sites to pass the resolver unchanged.

- [ ] **Step 6: Replace the one-line producer regex with a bounded address block parser**

```ts
const producerStartPattern = /^(?:(?:bottled|distilled|produced|imported|manufactured)\s+by|importer\s*:?)\s*/i;

const addressBlockFor = (rawText: string): string | undefined => {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim());
  const start = lines.findIndex((line) => producerStartPattern.test(line));
  if (start < 0) return undefined;

  const captured = [lines[start]];
  for (const line of lines.slice(start + 1, start + 3)) {
    if (!line || isMandatoryLine(line)) break;
    captured.push(line);
  }
  return captured.join('\n');
};
```

Strip only the initial `by`/`Importer:` prefix from the normalized value. Preserve every captured line in `rawText`.

- [ ] **Step 7: Run focused tests and verify fixture compatibility**

Run: `pnpm test:run src/features/extraction/confidence.test.ts src/features/extraction/parser.test.ts src/domain/validation.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit parser and confidence work**

```bash
git add src/features/extraction/confidence.ts src/features/extraction/confidence.test.ts src/features/extraction/parser.ts src/features/extraction/parser.test.ts
git commit -m "feat: derive conservative OCR confidence"
```

## Task 3: Refactor local OCR into a prewarmable, timed, abort-safe engine

**Files:**
- Modify: `src/features/extraction/types.ts`, `src/features/extraction/ocr.ts`, `src/features/extraction/ocr.test.ts`

**Interfaces:**
- Produces `OcrEngine`, `createOcrEngine`, `extractFromImage`, and `prewarmOcr`.
- `ExtractFromImage` accepts optional `{ signal?: AbortSignal }` without changing queue callers.
- Produces `ExtractionTimings` on successful extraction.

- [ ] **Step 1: Write failing engine tests**

```ts
it('warms one reusable worker without recognizing an image', async () => {
  const engine = createOcrEngine({ createWorker, prepareImage: preparedImage });
  await engine.prewarm();

  expect(createWorker).toHaveBeenCalledTimes(1);
  expect(worker.recognize).not.toHaveBeenCalled();
});

it('uses word confidence instead of page confidence', async () => {
  worker.recognize.mockResolvedValue({
    data: { text: '45% Alc./Vol.', confidence: 99, words: [{ text: '45%', confidence: 96 }, { text: 'Alc./Vol.', confidence: 62 }], lines: [] },
  });

  const result = await engine.extract(file(), vi.fn());
  expect(result.extraction.abv?.confidence).toBe(0.62);
});
```

- [ ] **Step 2: Run OCR tests to verify failure**

Run: `pnpm test:run src/features/extraction/ocr.test.ts`

Expected: FAIL because `createOcrEngine`, `prewarm`, timings, and resolver wiring do not exist.

- [ ] **Step 3: Extend extraction contracts**

```ts
export interface ExtractionTimings {
  preparationMs: number;
  workerWaitMs: number;
  recognitionMs: number;
  totalMs: number;
}

export interface ExtractionOptions {
  signal?: AbortSignal;
}

export interface ExtractionJobResult {
  // existing fields
  timings?: ExtractionTimings;
}

export type ExtractFromImage = (
  file: File,
  onProgress: ProgressListener,
  options?: ExtractionOptions,
) => Promise<ExtractionJobResult>;
```

- [ ] **Step 4: Build the OCR engine facade around the existing pool**

```ts
export interface OcrEngine {
  extract: ExtractFromImage;
  prewarm(): Promise<void>;
}

export const createOcrEngine = (
  dependencies: ExtractFromImageDependencies = {},
): OcrEngine => {
  const idleWorkers: PooledWorker[] = [];

  const prewarm = async (): Promise<void> => {
    await acquireWorker();
    try {
      const pooled = idleWorkers.pop() ?? await initializeWorker(
        createWorker,
        { current: undefined },
        initializationTimeoutMs,
      );
      if (!pooled.broken) idleWorkers.push(pooled);
      else void terminateWorker(pooled.worker);
    } finally {
      releaseWorker();
    }
  };

  return { extract, prewarm };
};

const defaultEngine = createOcrEngine();
export const extractFromImage = defaultEngine.extract;
export const prewarmOcr = (): Promise<void> => defaultEngine.prewarm();
```

Keep all worker acquisition/release paths balanced, including a late initialization result and aborted recognition.

- [ ] **Step 5: Request only needed Tesseract outputs and produce phase timings**

```ts
const recognitionStartedAt = now();
const result = await pooled.worker.recognize(prepared.image, {}, {
  text: true,
  blocks: true,
  hocr: false,
  tsv: false,
});
const recognitionMs = now() - recognitionStartedAt;

const confidenceFor = createCandidateConfidenceResolver(
  result.data.words ?? [],
  result.data.lines ?? [],
);

return {
  extraction: extractFromText(result.data.text, confidenceFor),
  rawText: result.data.text,
  timings: { preparationMs, workerWaitMs, recognitionMs, totalMs: now() - startedAt },
  durationMs: now() - startedAt,
  source: 'ocr',
};
```

Measure `preparationMs` before worker acquisition and `workerWaitMs` through acquire/initialization. Do not call `result.data.confidence` for parsed fields.

- [ ] **Step 6: Add abort behavior that destroys, rather than pools, the interrupted worker**

```ts
const abortRecognition = (): void => {
  pooled?.worker.terminate();
  pooled = undefined;
};

options?.signal?.addEventListener('abort', abortRecognition, { once: true });
try {
  // extraction
} finally {
  options?.signal?.removeEventListener('abort', abortRecognition);
}
```

Map an aborted run to `{ error: 'cancelled' }`; callers must ignore it after switching to manual review. Ensure a cancelled worker never re-enters `idleWorkers`.

- [ ] **Step 7: Run the OCR suite, typecheck, and inspect worker-call options**

Run: `pnpm test:run src/features/extraction/ocr.test.ts && pnpm typecheck`

Expected: PASS, including warm reuse, timeout cleanup, per-field confidence, timings, and abort cleanup.

- [ ] **Step 8: Commit OCR engine changes**

```bash
git add src/features/extraction/types.ts src/features/extraction/ocr.ts src/features/extraction/ocr.test.ts
git commit -m "feat: prewarm local OCR with field confidence"
```

## Task 4: Add a single-review slow path and an on-device benchmark

**Files:**
- Create: `src/components/BenchmarkPanel.tsx`
- Modify: `src/App.tsx`, `src/components/ReviewDesk.tsx`, `src/components/Landing.tsx`, `src/styles.css`, `src/App.test.tsx`

**Interfaces:**
- Consumes `prewarmOcr`, `extractFromImage`, `ExtractionTimings`, and existing correction controls.
- Produces `onManualReview`, `onStopOcr`, and `BenchmarkPanel` without storing benchmark data.

- [ ] **Step 1: Extend the OCR module mock and write failing slow-path tests**

```ts
vi.mock('./features/extraction/ocr', () => ({
  extractFromImage: vi.fn(),
  prewarmOcr: vi.fn(),
}));

it('offers manual review after five seconds and ignores a late OCR result', async () => {
  vi.useFakeTimers();
  const result = deferred<ExtractionJobResult>();
  vi.mocked(extractFromImage).mockReturnValueOnce(result.promise);

  await startManualReview(user);
  await vi.advanceTimersByTimeAsync(5_000);
  await user.click(screen.getByRole('button', { name: /review manually now/i }));
  expect(screen.getByText(/manual evidence mode/i)).toBeInTheDocument();

  result.resolve(successfulExtraction());
  await Promise.resolve();
  expect(screen.queryByText(/local OCR finished/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused UI test to verify failure**

Run: `pnpm test:run src/App.test.tsx`

Expected: FAIL because no recovery controls or manual mode exist.

- [ ] **Step 3: Prewarm only after reviewer intent**

In `App.resetTo`, schedule one warm operation only for `intake` and `batch`:

```ts
const schedulePrewarm = (): void => {
  const run = () => void prewarmOcr().catch(() => undefined);
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 1_500 });
  } else {
    window.setTimeout(run, 0);
  }
};
```

Use a guarded declaration for `requestIdleCallback` so TypeScript and older browsers remain supported. Do not prewarm from the landing screen before a review action:

```ts
interface IdleCapableWindow extends Window {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
}

const idleWindow = window as IdleCapableWindow;
if (idleWindow.requestIdleCallback) {
  idleWindow.requestIdleCallback(run, { timeout: 1_500 });
} else {
  window.setTimeout(run, 0);
}
```

- [ ] **Step 4: Add the five- and fifteen-second state transitions in `App`**

```ts
const [slowExtraction, setSlowExtraction] = useState(false);
const [stopAvailable, setStopAvailable] = useState(false);
const extractionAbort = useRef<AbortController>();

const startSlowTimers = (): (() => void) => {
  const slow = window.setTimeout(() => setSlowExtraction(true), 5_000);
  const stop = window.setTimeout(() => setStopAvailable(true), 15_000);
  return () => { window.clearTimeout(slow); window.clearTimeout(stop); };
};
```

Pass `signal: extractionAbort.current.signal` to `extractFromImage`. `reviewManually` increments `extractionRun`, clears timers, keeps the original object URL, sets phase `ready`, clears OCR evidence, and adds a disclosure stating that no OCR candidate was used. `stopAndReviewManually` aborts first, then performs the same transition.

- [ ] **Step 5: Add recovery controls and legibility confirmation to `ReviewDesk`**

```tsx
{slowExtraction ? (
  <aside className="slow-ocr-notice" role="status">
    <strong>This is taking longer than expected.</strong>
    <p>You can keep waiting or inspect the image and enter evidence manually.</p>
    <button type="button" onClick={onManualReview}>Review manually now</button>
    {stopAvailable ? <button type="button" onClick={onStopOcr}>Stop OCR and review manually</button> : null}
  </aside>
) : null}
```

Add a second checkbox under Required visual confirmation:

```tsx
<input
  type="checkbox"
  checked={warningLegibilityConfirmed}
  onChange={(event) => onWarningLegibilityConfirmed(event.target.checked)}
/>
<span>I reviewed warning legibility, contrast, and placement. Exact printed type size still needs final regulatory review.</span>
```

- [ ] **Step 6: Build the local benchmark component**

```tsx
export function BenchmarkPanel({ onClose }: { onClose: () => void }) {
  const [runs, setRuns] = useState<ExtractionJobResult[]>([]);
  const runBenchmark = async (): Promise<void> => {
    const response = await fetch('/demo/old-tom-bourbon.jpg');
    const blob = await response.blob();
    const file = new File([blob], 'old-tom-bourbon.jpg', { type: 'image/jpeg' });
    const first = await extractFromImage(file, () => undefined);
    const second = await extractFromImage(file, () => undefined);
    setRuns([first, second]);
  };
  // render first sample run and second warm-worker run; never label either network-cold
}
```

Display total and phase timings, matched parsed fields, confidence, and any extraction error. Keep the panel empty until the reviewer clicks Run.

- [ ] **Step 7: Add responsive styles and UI assertions**

Cover the slow notice, manual-review disclosure, both visual checks, prewarm call after review intent, benchmark first/second labels, and no benchmark persistence. Use `aria-live` for benchmark progress and preserve the existing keyboard behavior.

- [ ] **Step 8: Run UI tests and typecheck**

Run: `pnpm test:run src/App.test.tsx && pnpm typecheck`

Expected: PASS.

- [ ] **Step 9: Commit single-review and benchmark behavior**

```bash
git add src/App.tsx src/App.test.tsx src/components/BenchmarkPanel.tsx src/components/Landing.tsx src/components/ReviewDesk.tsx src/styles.css
git commit -m "feat: add OCR recovery and local benchmark"
```

## Task 5: Complete the batch review workflow without unmounting the queue

**Files:**
- Modify: `src/features/intake/queue.ts`, `src/features/intake/queue.test.ts`, `src/components/BatchQueue.tsx`, `src/App.test.tsx`, `src/styles.css`

**Interfaces:**
- `QueueItem` gains `application?: ApplicationData` and `reviewFlags: ReviewFlags`.
- `BatchQueue` owns `fullReviewItemId` and delegates edits to a selected queue item.
- `ReviewDesk` receives generic `exitLabel`/`onExit` and existing correction/confirmation callbacks.

- [ ] **Step 1: Write failing queue and UI tests**

```ts
it('retains batch application data and empty review flags', async () => {
  const queue = createReviewQueue([jobWithApplication], successfulWorker, 1);
  await queue.start();
  expect(queue.items[0]).toMatchObject({
    application: jobWithApplication.application,
    reviewFlags: { warningTypographyConfirmed: false, warningLegibilityConfirmed: false },
  });
});

it('opens a ready batch row in full review without re-running OCR', async () => {
  render(<App initialBatchItems={[readyBatchItem]} />);
  await user.click(screen.getByRole('button', { name: /open full review for ready\.png/i }));
  expect(screen.getByRole('button', { name: /back to batch/i })).toBeInTheDocument();
  expect(extractFromImage).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm test:run src/features/intake/queue.test.ts src/App.test.tsx`

Expected: FAIL because batch items lack retained application/flags and no full-review control exists.

- [ ] **Step 3: Retain full-review inputs in queue items**

```ts
export interface QueueItem {
  // existing fields
  application?: ApplicationData;
  reviewFlags: ReviewFlags;
}

const item: QueueItem = {
  id: job.id,
  file: job.file,
  name: job.file.name,
  size: job.file.size,
  application: job.application,
  reviewFlags: { warningTypographyConfirmed: false, warningLegibilityConfirmed: false },
  status: 'queued',
  progress: 0,
};
```

Call `validateLabel` with `item.application` and `item.reviewFlags`, not a hard-coded flags object.

- [ ] **Step 4: Keep `BatchQueue` mounted while showing an embedded desk**

```tsx
const [fullReviewItemId, setFullReviewItemId] = useState<string>();
const fullReviewItem = items.find((item) => item.id === fullReviewItemId);

if (fullReviewItem?.application && fullReviewItem.extraction) {
  return (
    <BatchFullReview
      item={fullReviewItem}
      onBack={() => setFullReviewItemId(undefined)}
      onCorrectCandidate={updateBatchCandidate}
      onUpdateFlags={updateBatchFlags}
    />
  );
}
```

`BatchFullReview` creates an object URL for `item.file` in an effect and revokes it on exit. It renders `ReviewDesk` with `exitLabel="Back to batch"`; do not move state to `App` or unmount the queue component. Make the exit contract generic before adding the embedded use:

```ts
interface ReviewDeskProps {
  // existing props
  exitLabel?: string;
  onExit: () => void;
}
```

```tsx
<button type="button" className="button button--secondary" onClick={onExit}>
  {exitLabel ?? 'Review another label'}
</button>
```

Pass `exitLabel="Review another label"` and the current intake reset callback from `App`; pass `exitLabel="Back to batch"` and `onBack` from `BatchFullReview`.

- [ ] **Step 5: Revalidate the same queue object after human changes**

```ts
const revalidateItem = (item: QueueItem): void => {
  if (!item.application || !item.extraction) return;
  item.result = validateLabel({
    application: item.application,
    extraction: item.extraction,
    flags: item.reviewFlags,
  });
  setItems((current) => [...current]);
};

const updateBatchCandidate = (field: CandidateField, value: string): void => {
  const item = fullReviewItem;
  if (!item) return;
  const previous = item.extraction?.[field];
  item.extraction = {
    ...item.extraction,
    [field]: previous
      ? { ...previous, value, confidence: 1, source: 'agent' }
      : { value, rawText: '', confidence: 1, source: 'agent' },
  };
  revalidateItem(item);
};
```

Use the same pattern for each `ReviewFlags` checkbox. The raw OCR value must never be overwritten.

- [ ] **Step 6: Add precise row actions and preserve triage limits**

```tsx
{item.status === 'ready' && item.application && item.extraction ? (
  <button
    type="button"
    className="text-button"
    onClick={() => setFullReviewItemId(item.id)}
    aria-label={`Open full review for ${item.name}`}
  >
    Open full review
  </button>
) : null}
```

Leave extraction-only rows as `Application data required`; do not add corrections or false validation status to them.

- [ ] **Step 7: Assert return, correction, flags, and continued queue behavior**

Add tests that confirm warning confirmations change the row result after Back to batch, correction becomes Agent-entered while raw OCR remains, current filter/search persists, and an in-progress row continues after returning.

- [ ] **Step 8: Run focused tests and typecheck**

Run: `pnpm test:run src/features/intake/queue.test.ts src/App.test.tsx && pnpm typecheck`

Expected: PASS.

- [ ] **Step 9: Commit the full batch-review path**

```bash
git add src/features/intake/queue.ts src/features/intake/queue.test.ts src/components/BatchQueue.tsx src/App.test.tsx src/styles.css
git commit -m "feat: complete individual reviews from batch"
```

## Task 6: Build truthful, one-click guided scenarios

**Files:**
- Create: `src/components/DemoLabelFixture.tsx`
- Modify: `src/features/demo/cases.ts`, `src/features/extraction/types.ts`, `src/App.tsx`, `src/components/Landing.tsx`, `src/components/ReviewDesk.tsx`, `src/App.test.tsx`, `src/styles.css`

**Interfaces:**
- `DemoCase` becomes self-contained with `rawText`, `visual`, application facts, and extraction.
- `ReviewDesk` accepts `evidencePreview?: ReactNode` in addition to an uploaded `imageUrl`.
- Landing invokes `onOpenDemoCase(id)` for each disclosed scenario.

- [ ] **Step 1: Write failing scenario tests**

```ts
it('opens an explicit foreign-origin scenario with a review finding', async () => {
  render(<App />);
  await user.click(screen.getByRole('button', { name: /explore scenarios/i }));
  await user.click(screen.getByRole('button', { name: /domestic declaration, foreign origin/i }));

  expect(screen.getByText(/precomputed fixture/i)).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /country of origin/i })).toHaveTextContent('Needs review');
});
```

- [ ] **Step 2: Run the focused UI tests to verify failure**

Run: `pnpm test:run src/App.test.tsx`

Expected: FAIL because only the hard-coded Old Tom case exists.

- [ ] **Step 3: Define self-contained demo cases**

```ts
export interface DemoCase {
  id: 'clear' | 'mismatch' | 'foreign-origin' | 'warning-heading' | 'degraded';
  title: string;
  disclosure: string;
  application: ApplicationData;
  extraction: LabelExtraction;
  rawText: string;
  visual: { kind: 'image'; src: string; className?: string } | { kind: 'fixture'; variant: 'foreign-origin' | 'warning-heading' };
}

const oldTomApplication: ApplicationData = {
  brandName: 'OLD TOM DISTILLERY',
  classType: 'Kentucky Straight Bourbon Whiskey',
  abv: '45%',
  proof: '90',
  netContents: '750 mL',
  producerAddress: 'Old Tom Distillery, Louisville, KY',
  isImported: false,
};

const withExtraction = (caseDefinition: Omit<DemoCase, 'extraction'>, confidence: number): DemoCase => ({
  ...caseDefinition,
  extraction: extractFromText(caseDefinition.rawText, confidence),
});

export const demoCases: DemoCase[] = [
  withExtraction({
    id: 'clear',
    title: 'Old Tom Distillery / clear label',
    disclosure: 'Precomputed fixture — not a live OCR timing result.',
    application: oldTomApplication,
    rawText: OLD_TOM_RAW_TEXT,
    visual: { kind: 'image', src: '/demo/old-tom-bourbon.svg' },
  }, 0.99),
  withExtraction({
    id: 'mismatch',
    title: 'Old Tom Distillery / declared-brand conflict',
    disclosure: 'Precomputed fixture using the shown Old Tom sample. The application brand intentionally conflicts with visible label evidence.',
    application: { ...oldTomApplication, brandName: 'OLD TOM RESERVE' },
    rawText: OLD_TOM_RAW_TEXT,
    visual: { kind: 'image', src: '/demo/old-tom-bourbon.svg' },
  }, 0.99),
  withExtraction({
    id: 'foreign-origin',
    title: 'Domestic declaration / foreign-origin evidence',
    disclosure: 'Precomputed illustrative fixture — not a live OCR timing result.',
    application: { brandName: 'NORTH COAST SPIRITS', classType: 'Single Malt Whisky', abv: '46%', netContents: '750 mL', producerAddress: 'Harbor Imports, Boston, MA', isImported: false },
    rawText: `NORTH COAST SPIRITS\nSingle Malt Whisky\n46% Alc./Vol.\n750 mL\nImported by Harbor Imports\nBoston, MA\nProduct of Scotland\nGOVERNMENT WARNING: ${CANONICAL_WARNING_BODY}`,
    visual: { kind: 'fixture', variant: 'foreign-origin' },
  }, 0.96),
  withExtraction({
    id: 'warning-heading',
    title: 'Warning heading / title-case exception',
    disclosure: 'Precomputed illustrative fixture — not a live OCR timing result.',
    application: { brandName: 'NORTH COAST SPIRITS', classType: 'Single Malt Whisky', abv: '46%', netContents: '750 mL', producerAddress: 'North Coast Spirits, Portland, OR', isImported: false },
    rawText: `NORTH COAST SPIRITS\nSingle Malt Whisky\n46% Alc./Vol.\n750 mL\nProduced by North Coast Spirits, Portland, OR\nGovernment Warning: ${CANONICAL_WARNING_BODY}`,
    visual: { kind: 'fixture', variant: 'warning-heading' },
  }, 0.96),
  withExtraction({
    id: 'degraded',
    title: 'Old Tom Distillery / degraded evidence',
    disclosure: 'Precomputed low-confidence fixture shown with a visual degradation treatment — not a live OCR timing result.',
    application: oldTomApplication,
    rawText: OLD_TOM_RAW_TEXT,
    visual: { kind: 'image', src: '/demo/old-tom-bourbon.svg', className: 'label-preview__image--degraded' },
  }, 0.55),
];
```

Use the real Old Tom image for clear/mismatch/degraded cases. Set mismatch application facts to conflict visibly with the label. Set degraded candidates to low confidence. For foreign-origin and title-cased-warning cases, define raw text and fixture fields once, then derive extraction from that raw text.

- [ ] **Step 4: Render exact HTML/CSS fixture evidence**

```tsx
export function DemoLabelFixture({ variant }: { variant: 'foreign-origin' | 'warning-heading' }) {
  const heading = variant === 'warning-heading' ? 'Government Warning:' : 'GOVERNMENT WARNING:';
  return (
    <figure className="demo-label-fixture" aria-label="Illustrative label fixture">
      <p className="demo-label-fixture__brand">NORTH COAST SPIRITS</p>
      <p>Single Malt Whisky · 46% Alc./Vol. · 750 mL</p>
      <p>Imported by Harbor Imports, Boston, MA</p>
      {variant === 'foreign-origin' ? <p>Product of Scotland</p> : null}
      <p><strong>{heading}</strong> {CANONICAL_WARNING_BODY}</p>
    </figure>
  );
}
```

The exact same strings must appear in the case raw text. For the degraded real image, apply CSS-only visual treatment and disclose that the low-confidence result is a precomputed illustrative fixture.

- [ ] **Step 5: Make the scenario library discoverable without crowding the landing page**

Add an **Explore scenarios** disclosure after the primary actions. It lists five clear buttons with one-line outcomes. Keep **Open guided demo** as an immediate shortcut to the clear case.

- [ ] **Step 6: Teach `ReviewDesk` to render either uploaded or fixture evidence**

```tsx
{evidencePreview ?? (
  imageUrl ? <img className={imageClassName} src={imageUrl} alt={`Label preview: ${title}`} /> : <p className="muted">No preview is available for this label.</p>
)}
```

Do not show a fixture as OCR-derived live evidence; retain the existing disclosure line above the desk.

- [ ] **Step 7: Run scenario and accessibility tests**

Run: `pnpm test:run src/App.test.tsx src/features/extraction/parser.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Commit guided scenario work**

```bash
git add src/components/DemoLabelFixture.tsx src/components/Landing.tsx src/components/ReviewDesk.tsx src/features/demo/cases.ts src/features/extraction/types.ts src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: add guided label review scenarios"
```

## Task 7: Align documentation and CI with the finished product

**Files:**
- Modify: `README.md`, `docs/DESIGN.md`, `.github/workflows/ci.yml`, `src/readme.test.ts`, `package.json`

**Interfaces:**
- Documents the exact `packageManager` version and browser-local benchmark/recovery behavior.
- CI installs the same pnpm version declared by the repository.

- [ ] **Step 1: Write failing documentation contract tests**

```ts
it('aligns README, package metadata, and CI on pnpm 11.12.0', async () => {
  const readme = await readFile('README.md', 'utf8');
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8');

  expect(packageJson.packageManager).toBe('pnpm@11.12.0');
  expect(readme).toContain('pnpm 11.12.0');
  expect(workflow).toMatch(/version:\s*11\.12\.0/);
});
```

- [ ] **Step 2: Run the documentation test to verify failure**

Run: `pnpm test:run src/readme.test.ts`

Expected: FAIL because the README/CI still allow or install an unspecified pnpm version.

- [ ] **Step 3: Update exact documentation claims**

Document all of the following precisely:

```markdown
- Node.js 20+ with Corepack and pnpm 11.12.0.
- One intent-triggered local OCR prewarm worker; no page-load OCR work.
- Field-level confidence is derived from matched OCR words/lines and falls back conservatively.
- After five seconds, a reviewer may continue waiting or review manually; at fifteen seconds they may stop OCR and review manually.
- Batch items with CSV application facts can open a full review; filename-only rows remain triage.
- The benchmark reports first sample run and second warm-worker run, not a universal or network-cold claim.
- Warning legibility is a manual review task; exact type size remains a final regulatory review responsibility.
```

Retain all existing privacy/no-approval and law-source caveats. Update `docs/DESIGN.md` to match the new architecture and remove statements that say no image preprocessing exists if CSS-only demo degradation is the only new treatment.

- [ ] **Step 4: Pin CI to the package-manager version**

```yaml
- uses: pnpm/action-setup@v4
  with:
    version: 11.12.0
```

Keep the existing Node 22 CI runtime and frozen lockfile install.

Set the package engine to the same exact version range:

```json
{
  "packageManager": "pnpm@11.12.0",
  "engines": { "node": ">=20", "pnpm": "11.12.0" }
}
```

- [ ] **Step 5: Run the documentation contract and full static checks**

Run: `pnpm test:run src/readme.test.ts && pnpm typecheck && pnpm build`

Expected: PASS.

- [ ] **Step 6: Commit documentation and CI alignment**

```bash
git add README.md docs/DESIGN.md .github/workflows/ci.yml src/readme.test.ts package.json pnpm-lock.yaml
git commit -m "docs: document conservative review hardening"
```

## Task 8: Verify the integrated product and publish the exact revision

**Files:**
- No planned source modifications. A browser defect restarts the relevant earlier task with a focused failing test before this release task resumes.

**Interfaces:**
- Consumes every prior task and the existing `.openai/hosting.json` Sites project.
- Produces one public Sites deployment sourced from the validated Git `HEAD`.

- [ ] **Step 1: Run the full automated suite from a clean worktree**

Run:

```bash
pnpm test:run
pnpm typecheck
pnpm build
git diff --check
git status --short
```

Expected: all tests pass, build exits `0`, no whitespace errors, and no unstaged files remain except intentional generated ignored output.

- [ ] **Step 2: Perform a local browser acceptance pass**

Verify these task flows in a normal browser:

1. Enter New review, attach the shipped JPEG, and observe the measured local OCR timing.
2. Wait until the five-second recovery state on a deliberately deferred test/slow run, then enter manual review and add an agent-entered candidate.
3. Run the benchmark and confirm it labels the two measurements “first sample run” and “second warm-worker run.”
4. Import the starter CSV and sample label, open the completed row, complete both visual checks, correct one candidate, return to batch, and confirm the finding/count changes.
5. Open each guided scenario and confirm the visible fixture, raw evidence, and result agree.
6. Try `wine` as class/type and confirm a pre-OCR scope message.

- [ ] **Step 3: Review the finished diff before release**

Run:

```bash
git diff origin/main...HEAD --check
git log --oneline origin/main..HEAD
```

Confirm every commit serves the approved specification and no source credentials, benchmark results, or local artifacts are included.

- [ ] **Step 4: Confirm a clean worktree and push exact `HEAD`**

```bash
git status --short
git push origin main
```

Expected: `git status --short` is empty before push. If browser validation finds a defect, return to its owning task, add a focused failing test, commit that task's repair, rerun the full validation suite, and repeat this release task. Never place a Sites token in Git configuration or a remote URL.

- [ ] **Step 5: Publish with Sites from the exact validated commit**

1. Obtain a short-lived write credential for the existing project ID in `.openai/hosting.json`.
2. Push the exact commit to the Sites source repository with a per-command authorization header.
3. Package `dist/` with `scripts/package-site.sh` from the Sites plugin.
4. Save a version with the current Git SHA and deploy it publicly, using the already authorized public access mode.
5. Poll until the deployment succeeds.

- [ ] **Step 6: Smoke-test the public recruiter path**

Use a normal browser user agent to confirm:

```bash
curl -A 'Mozilla/5.0' -I https://proofline-label-intelligence.kungeng0803.chatgpt.site
```

Then verify the public JavaScript contains the new benchmark and batch-review strings, and use the browser to test the shipped sample and starter CSV from the deployed origin.

- [ ] **Step 7: Record the release result**

The public URL remains `https://proofline-label-intelligence.kungeng0803.chatgpt.site`, so do not change it in this task. Report that URL, the source repository, validation result, and user-visible improvements without exposing credentials or internal deployment IDs.
