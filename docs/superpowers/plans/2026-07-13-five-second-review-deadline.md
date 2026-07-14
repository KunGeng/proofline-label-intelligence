# Five-second review-ready deadline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every active single-label or batch OCR attempt hand the reviewer a usable manual-evidence path after five seconds, while preserving human evidence across an explicit retry.

**Architecture:** The OCR engine owns the five-second automated-extraction budget and returns a distinct `deadline-exceeded` result after safely aborting preparation, worker acquisition, initialization, or recognition. A small shared manual-evidence module records field-level human locks and merges OCR only into untouched empty fields. The single-label app and batch queue map the new outcome to manual review rather than an extraction error; the benchmark explicitly disables the deadline.

**Tech Stack:** React 19, TypeScript 5.7, Vite 6, Vitest 2, Testing Library, browser-local `tesseract.js`.

## Global Constraints

- Use a 5,000 millisecond OCR deadline for normal `extractFromImage` calls; `deadlineMs: null` explicitly disables it for the benchmark.
- Start the deadline when an extraction begins, before image preparation and worker acquisition. In batch, do not start it while an item waits in the batch scheduler.
- An external abort that occurs first returns `cancelled`; a deadline that occurs first returns `deadline-exceeded`. Clear the deadline timer and all listeners in every terminal path.
- Preserve human-entered candidates, deliberately cleared candidates, candidate provenance, and visual-confirmation flags across retry. OCR may fill only untouched, empty candidate fields.
- A batch deadline is `manual_review_required`, not an extraction error; it retains the `File`, optional application data, and any completed thumbnail, and the queue continues.
- Keep the existing two-worker OCR cap and 300-file batch cap. Do not add a backend, external OCR, persistence, analytics, authentication, uploads, or dependencies.
- Keep the benchmark and guided fixtures honest: benchmark timing is uncapped and fixture cases remain precomputed.
- Describe the deadline as an automated-wait target under normal responsive browser scheduling, not an absolute real-time guarantee while a browser event loop is blocked.
- Use the repo-pinned runtime for every verification command:

```sh
RUNTIME_NODE=/Users/kun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
PNPM_MJS=/Users/kun/.cache/node/corepack/v1/pnpm/11.12.0/bin/pnpm.mjs
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS"
```

## File Map

- Create: `src/features/review/manualEvidence.ts` — pure field-lock, manual-candidate, deliberate-clear, and OCR-merge functions.
- Create: `src/features/review/manualEvidence.test.ts` — isolated tests for retry merge semantics.
- Modify: `src/features/extraction/types.ts` — deadline option in the existing extraction contract.
- Modify: `src/features/extraction/ocr.ts` — default deadline, internal abort bridge, distinct deadline result, and cleanup.
- Modify: `src/features/extraction/ocr.test.ts` — fake-timer lifecycle and precedence tests.
- Modify: `src/App.tsx` — map the deadline result to manual review, retain the original `File`, and retry without replacing human evidence.
- Modify: `src/components/ReviewDesk.tsx` — deadline copy, explicit retry control, candidate clearing, and manual entry workspace when no application facts exist.
- Modify: `src/App.test.tsx` — single review, batch UI, benchmark, focus, retry, and late-result coverage.
- Modify: `src/features/intake/queue.ts` — manual-review queue status, deadline mapping, and draft-preserving retry.
- Modify: `src/features/intake/queue.test.ts` — queue deadline, continuation, and retry-preservation tests.
- Modify: `src/components/BatchQueue.tsx` — manual-review filter/status/actions and a batch manual-workspace route.
- Modify: `src/styles.css` — visual treatment for the manual-review-required status and manual retry action.
- Modify: `src/components/BenchmarkPanel.tsx` — explicit uncapped extraction calls.
- Modify: `src/features/intake/export.test.ts` — deadline status/reason export coverage.
- Modify: `README.md`, `docs/DESIGN.md`, and `src/readme.test.ts` — accurate deadline, batch, benchmark, and scope documentation.

---

### Task 1: Establish the reusable human-evidence merge contract

**Files:**
- Create: `src/features/review/manualEvidence.ts`
- Create: `src/features/review/manualEvidence.test.ts`

**Interfaces:**
- Consumes: `Candidate` and `LabelExtraction` from `src/domain/types.ts`.
- Produces: `EvidenceField`, `ManualEvidenceLocks`, `evidenceFields`, `setManualCandidate`, `clearManualCandidate`, and `mergeUntouchedOcrEvidence` for both `App.tsx` and `queue.ts`.

- [ ] **Step 1: Write failing pure-policy tests**

Create `src/features/review/manualEvidence.test.ts` with the exact behavior the UI and queue will share:

```ts
import {
  clearManualCandidate,
  mergeUntouchedOcrEvidence,
  setManualCandidate,
  type ManualEvidenceLocks,
} from './manualEvidence';

it('preserves a human value and fills only an untouched empty field', () => {
  const manuallyEntered = setManualCandidate({}, 'brandName', 'OLD TOM RESERVE');
  const locks: ManualEvidenceLocks = { brandName: true };

  expect(mergeUntouchedOcrEvidence(manuallyEntered, {
    brandName: { value: 'OLD TOM', rawText: 'OLD TOM', confidence: 0.99, source: 'ocr' },
    abv: { value: '45%', rawText: '45% Alc./Vol.', confidence: 0.99, source: 'ocr' },
  }, locks)).toMatchObject({
    brandName: { value: 'OLD TOM RESERVE', source: 'agent', confidence: 1 },
    abv: { value: '45%', source: 'ocr' },
  });
});

it('keeps a deliberate blank absent after OCR retries', () => {
  const initial = setManualCandidate({}, 'proof', '90 Proof');
  const cleared = clearManualCandidate(initial, 'proof');

  expect(mergeUntouchedOcrEvidence(cleared, {
    proof: { value: '90 Proof', rawText: '90 Proof', confidence: 0.99, source: 'ocr' },
  }, { proof: true })).not.toHaveProperty('proof');
});
```

- [ ] **Step 2: Run the new tests and confirm the missing-module failure**

Run:

```sh
RUNTIME_NODE=/Users/kun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
PNPM_MJS=/Users/kun/.cache/node/corepack/v1/pnpm/11.12.0/bin/pnpm.mjs
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run -- src/features/review/manualEvidence.test.ts
```

Expected: FAIL because `./manualEvidence` does not exist.

- [ ] **Step 3: Implement the lock and merge helpers**

Create `src/features/review/manualEvidence.ts` using a lock map instead of encoding a deliberate blank as a fake OCR candidate:

```ts
import type { Candidate, LabelExtraction } from '../../domain/types';

export type EvidenceField = keyof LabelExtraction;
export type ManualEvidenceLocks = Partial<Record<EvidenceField, true>>;

export const evidenceFields: EvidenceField[] = [
  'brandName',
  'classType',
  'abv',
  'proof',
  'netContents',
  'producerAddress',
  'countryOfOrigin',
  'warningText',
  'warningHeading',
];

export const setManualCandidate = (
  extraction: LabelExtraction,
  field: EvidenceField,
  value: string,
): LabelExtraction => {
  const previous = extraction[field];
  return {
    ...extraction,
    [field]: {
      value,
      rawText: previous?.rawText ?? '',
      confidence: 1,
      source: 'agent',
    } satisfies Candidate,
  };
};

export const clearManualCandidate = (
  extraction: LabelExtraction,
  field: EvidenceField,
): LabelExtraction => {
  const { [field]: _removed, ...remaining } = extraction;
  return remaining;
};

export const mergeUntouchedOcrEvidence = (
  current: LabelExtraction,
  fresh: LabelExtraction,
  locks: ManualEvidenceLocks,
): LabelExtraction => evidenceFields.reduce<LabelExtraction>((merged, field) => {
  if (locks[field] || merged[field] || !fresh[field]) {
    return merged;
  }
  return { ...merged, [field]: fresh[field] };
}, { ...current });
```

`true` in `ManualEvidenceLocks` means the reviewer has either entered or deliberately cleared the field. The candidate remains in `LabelExtraction` for a value and is absent for a deliberate blank.

- [ ] **Step 4: Run the focused helper tests and typecheck**

Run:

```sh
RUNTIME_NODE=/Users/kun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
PNPM_MJS=/Users/kun/.cache/node/corepack/v1/pnpm/11.12.0/bin/pnpm.mjs
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run -- src/features/review/manualEvidence.test.ts
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the isolated policy layer**

```sh
git add src/features/review/manualEvidence.ts src/features/review/manualEvidence.test.ts
git commit -m "feat: preserve manual evidence across OCR retries"
```

### Task 2: Add a hard, abort-safe OCR deadline

**Files:**
- Modify: `src/features/extraction/types.ts:22-29`
- Modify: `src/features/extraction/ocr.ts:17-22, 193-218, 457-624`
- Modify: `src/features/extraction/ocr.test.ts:166-483`

**Interfaces:**
- Consumes: the existing `AbortSignal` behavior, worker queue, `raceWithCancellation`, and initializer cleanup.
- Produces: `ExtractionOptions.deadlineMs?: number | null`, exported `OCR_DEADLINE_MS`, and the existing result shape with `error: 'deadline-exceeded'`.

- [ ] **Step 1: Add deadline test cases before changing the engine**

In `src/features/extraction/ocr.test.ts`, add `vi.useFakeTimers()` tests using existing `deferred`, `preparedImage`, and worker helpers. Cover these assertions:

```ts
it('returns deadline-exceeded while image preparation is pending', async () => {
  vi.useFakeTimers();
  const prepareImage = vi.fn().mockReturnValue(new Promise(() => undefined));
  const engine = createOcrEngine({ prepareImage });

  const result = engine.extract(file(), vi.fn());
  await vi.advanceTimersByTimeAsync(5_000);

  await expect(result).resolves.toMatchObject({ error: 'deadline-exceeded', source: 'ocr' });
});

it('returns deadline-exceeded while waiting for a worker slot and leaves capacity usable', async () => {
  vi.useFakeTimers();
  const releaseRecognition = deferred<void>();
  const heldWorker = (text: string) => ({
    recognize: vi.fn().mockImplementation(async () => {
      await releaseRecognition.promise;
      return { data: { text, words: [], lines: [] } };
    }),
    terminate: vi.fn().mockResolvedValue(undefined),
  }) as unknown as OcrWorker;
  const workerFactoryMock = vi.fn()
    .mockResolvedValueOnce(heldWorker('ONE'))
    .mockResolvedValueOnce(heldWorker('TWO'));
  const engine = createOcrEngine({
    createWorker: workerFactoryMock as unknown as WorkerFactory,
    prepareImage: preparedImage,
  });

  const first = engine.extract(file(), vi.fn(), { deadlineMs: null });
  const second = engine.extract(file(), vi.fn(), { deadlineMs: null });
  await Promise.resolve();
  const waiting = engine.extract(file(), vi.fn());
  await vi.advanceTimersByTimeAsync(5_000);

  await expect(waiting).resolves.toMatchObject({ error: 'deadline-exceeded' });
  expect(workerFactoryMock).toHaveBeenCalledTimes(2);
  releaseRecognition.resolve();
  await Promise.all([first, second]);
});

it('terminates a late-initializing worker after the deadline', async () => {
  vi.useFakeTimers();
  const pendingWorker = deferred<OcrWorker>();
  const lateTerminate = vi.fn().mockResolvedValue(undefined);
  const replacementRecognize = vi.fn().mockResolvedValue({
    data: { text: 'OLD TOM', words: [], lines: [] },
  });
  const workerFactoryMock = vi.fn()
    .mockReturnValueOnce(pendingWorker.promise)
    .mockResolvedValueOnce({ recognize: replacementRecognize, terminate: vi.fn() });
  const engine = createOcrEngine({
    createWorker: workerFactoryMock as unknown as WorkerFactory,
    prepareImage: preparedImage,
  });

  const expired = engine.extract(file(), vi.fn());
  await waitForWorkerFactory(workerFactoryMock);
  await vi.advanceTimersByTimeAsync(5_000);
  await expect(expired).resolves.toMatchObject({ error: 'deadline-exceeded' });

  pendingWorker.resolve({ terminate: lateTerminate } as unknown as OcrWorker);
  await waitForMockCall(lateTerminate);
  await engine.extract(file(), vi.fn(), { deadlineMs: null });
  expect(replacementRecognize).toHaveBeenCalledTimes(1);
});

it('retires a worker whose recognition passes the deadline', async () => {
  vi.useFakeTimers();
  const pendingRecognition = deferred<{ data: { text: string; words: []; lines: [] } }>();
  const expiredTerminate = vi.fn().mockResolvedValue(undefined);
  const replacementRecognize = vi.fn().mockResolvedValue({
    data: { text: 'OLD TOM', words: [], lines: [] },
  });
  const engine = createOcrEngine({
    createWorker: vi.fn()
      .mockResolvedValueOnce({ recognize: vi.fn().mockReturnValue(pendingRecognition.promise), terminate: expiredTerminate })
      .mockResolvedValueOnce({ recognize: replacementRecognize, terminate: vi.fn() }) as unknown as WorkerFactory,
    prepareImage: preparedImage,
  });

  const expired = engine.extract(file(), vi.fn());
  await vi.advanceTimersByTimeAsync(5_000);
  await expect(expired).resolves.toMatchObject({ error: 'deadline-exceeded' });
  expect(expiredTerminate).toHaveBeenCalledTimes(1);
  await engine.extract(file(), vi.fn(), { deadlineMs: null });
  expect(replacementRecognize).toHaveBeenCalledTimes(1);
});

it('uses the first terminal cause when caller cancellation and the deadline race', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const engine = createOcrEngine({ prepareImage: vi.fn().mockReturnValue(new Promise(() => undefined)) });
  const cancelled = engine.extract(file(), vi.fn(), { signal: controller.signal });
  controller.abort();
  await expect(cancelled).resolves.toMatchObject({ error: 'cancelled' });

  const controllerAfterDeadline = new AbortController();
  const deadlineThenAbort = engine.extract(file(), vi.fn(), {
    signal: controllerAfterDeadline.signal,
  });
  await vi.advanceTimersByTimeAsync(5_000);
  controllerAfterDeadline.abort();
  await expect(deadlineThenAbort).resolves.toMatchObject({ error: 'deadline-exceeded' });
});

it('clears a completed deadline timer instead of retiring a reusable worker later', async () => {
  vi.useFakeTimers();
  const terminate = vi.fn().mockResolvedValue(undefined);
  const engine = createOcrEngine({
    createWorker: vi.fn().mockResolvedValue({
      recognize: vi.fn().mockResolvedValue({ data: { text: 'OLD TOM', words: [], lines: [] } }),
      terminate,
    }) as unknown as WorkerFactory,
    prepareImage: preparedImage,
  });

  await engine.extract(file(), vi.fn());
  await vi.advanceTimersByTimeAsync(5_000);

  expect(terminate).not.toHaveBeenCalled();
});
```

Also add `vi.useRealTimers()` to the existing `afterEach` so later suites do not inherit fake clocks.

- [ ] **Step 2: Run the OCR test file and confirm deadline assertions fail**

Run:

```sh
RUNTIME_NODE=/Users/kun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
PNPM_MJS=/Users/kun/.cache/node/corepack/v1/pnpm/11.12.0/bin/pnpm.mjs
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run -- src/features/extraction/ocr.test.ts
```

Expected: FAIL because the options contract and `deadline-exceeded` outcome are absent.

- [ ] **Step 3: Extend the extraction contract and implement the timeout bridge**

In `src/features/extraction/types.ts`, make benchmark opt-out explicit without changing existing callers:

```ts
export interface ExtractionOptions {
  signal?: AbortSignal;
  /** `undefined` uses the product deadline; `null` intentionally runs uncapped. */
  deadlineMs?: number | null;
}
```

In `src/features/extraction/ocr.ts`, add the exported production default and a deadline result alongside the existing cancellation result:

```ts
export const OCR_DEADLINE_MS = 5_000;

const deadlineExceededResult = (thumbnailUrl?: string): ExtractionJobResult => ({
  extraction: {},
  rawText: '',
  thumbnailUrl,
  error: 'deadline-exceeded',
  source: 'ocr',
});
```

At the top of `extract`, create one internal `AbortController`, resolve the configured deadline, and keep a first-wins terminal cause:

```ts
type TerminalCause = 'cancelled' | 'deadline-exceeded';

const deadlineMs = options?.deadlineMs === undefined
  ? OCR_DEADLINE_MS
  : options.deadlineMs;
const internalAbort = new AbortController();
let terminalCause: TerminalCause | undefined;

const finishWith = (cause: TerminalCause): void => {
  if (terminalCause) return;
  terminalCause = cause;
  internalAbort.abort();
  workerSlotRequest?.cancel();
  if (pooled) retireWorker(pooled);
  cancelPreparation?.();
  cancelRecognition?.();
};

const onCallerAbort = (): void => finishWith('cancelled');
options?.signal?.addEventListener('abort', onCallerAbort, { once: true });
if (options?.signal?.aborted) onCallerAbort();
const deadlineTimer = deadlineMs === null
  ? undefined
  : setTimeout(() => finishWith('deadline-exceeded'), deadlineMs);
```

Pass `internalAbort.signal` to `initializeWorker`, use `terminalCause` instead of a single boolean when deciding the result in `catch`, and clear `deadlineTimer` plus the caller listener in `finally`:

```ts
if (terminalCause === 'deadline-exceeded') return deadlineExceededResult(thumbnailUrl);
if (terminalCause === 'cancelled' || error instanceof OcrCancellationError) {
  return cancelledResult(thumbnailUrl);
}
```

Keep the current worker retirement, listener clearing, queued-slot cancellation, late-worker termination, and release semantics. Do not add a second timer in `App.tsx`; the engine is the sole source of the distinct deadline outcome.

- [ ] **Step 4: Run the engine tests and verify all lifecycle paths**

Run:

```sh
RUNTIME_NODE=/Users/kun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
PNPM_MJS=/Users/kun/.cache/node/corepack/v1/pnpm/11.12.0/bin/pnpm.mjs
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run -- src/features/extraction/ocr.test.ts
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" typecheck
```

Expected: both commands exit 0; all four pending phases return `deadline-exceeded`, and later work obtains worker capacity.

- [ ] **Step 5: Commit the deadline engine**

```sh
git add src/features/extraction/types.ts src/features/extraction/ocr.ts src/features/extraction/ocr.test.ts
git commit -m "feat: enforce five-second OCR deadline"
```

### Task 3: Turn a single-label deadline into an accessible, retryable manual workspace

**Files:**
- Modify: `src/App.tsx:17-386`
- Modify: `src/components/ReviewDesk.tsx:26-650`
- Modify: `src/App.test.tsx:778-918, 1132-1235`

**Interfaces:**
- Consumes: `OCR_DEADLINE_MS` behavior through `ExtractionJobResult.error`, `ManualEvidenceLocks`, and `mergeUntouchedOcrEvidence` from Task 1.
- Produces: a retained original file, manual lock map, deadline disclosure, `Retry OCR` action, and an explicit `onClearCandidate` UI callback.

- [ ] **Step 1: Replace old slow-recovery expectations with deadline mapping tests**

In `src/App.test.tsx`, replace the five-second opt-in notice and fifteen-second stop tests with mocked deadline results. Keep the engine clock tests in Task 2; these tests verify the App mapping and presentation:

```ts
it('opens preserved manual evidence review for a deadline result and focuses its disclosure', async () => {
  vi.mocked(extractFromImage).mockResolvedValueOnce({
    extraction: {}, rawText: '', source: 'ocr', error: 'deadline-exceeded',
  });

  await startManualReview(userEvent.setup());

  expect(await screen.findByText(/OCR stopped after five seconds/i)).toHaveFocus();
  expect(screen.getByRole('img', { name: /label preview: old-tom\.png/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /retry OCR/i })).toBeInTheDocument();
  expect(screen.queryByRole('status', { name: /label extraction progress/i })).not.toBeInTheDocument();
});

it('does not present OCR candidates supplied with a deadline result', async () => {
  vi.mocked(extractFromImage).mockResolvedValueOnce({
    extraction: { brandName: ocrCandidate('WRONG OCR') },
    rawText: 'WRONG OCR',
    source: 'ocr',
    error: 'deadline-exceeded',
  });

  await startManualReview(userEvent.setup());

  expect(await screen.findByText(/OCR stopped after five seconds/i)).toBeInTheDocument();
  expect(screen.queryByText('WRONG OCR')).not.toBeInTheDocument();
});

it('keeps human value, deliberate blank, and visual flags when retry OCR fills an untouched field', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage)
    .mockResolvedValueOnce({ extraction: {}, rawText: '', source: 'ocr', error: 'deadline-exceeded' })
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
  await user.type(screen.getByRole('textbox', { name: /brand name agent-entered candidate/i }), 'HUMAN BRAND');
  await user.click(screen.getByRole('button', { name: /save brand name candidate/i }));
  await user.click(screen.getByRole('button', { name: /add proof candidate/i }));
  await user.type(screen.getByRole('textbox', { name: /proof agent-entered candidate/i }), '90 Proof');
  await user.click(screen.getByRole('button', { name: /save proof candidate/i }));
  await user.click(screen.getByRole('button', { name: /remove proof evidence/i }));
  await user.click(screen.getByRole('checkbox', { name: /warning heading is uppercase and bold/i }));
  await user.click(screen.getByRole('button', { name: /retry OCR/i }));

  expect(await screen.findByText('HUMAN BRAND')).toBeInTheDocument();
  expect(screen.queryByText('90 Proof')).not.toBeInTheDocument();
  expect(screen.getByText('45%')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /warning heading is uppercase and bold/i })).toBeChecked();
});
```

- [ ] **Step 2: Run the focused App tests and confirm the current recovery UI fails them**

Run:

```sh
RUNTIME_NODE=/Users/kun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
PNPM_MJS=/Users/kun/.cache/node/corepack/v1/pnpm/11.12.0/bin/pnpm.mjs
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run -- src/App.test.tsx
```

Expected: FAIL because a deadline is currently rendered as a generic error and the UI has no retry/clear semantics.

- [ ] **Step 3: Refactor `App` around a reusable extraction run and a preserved manual draft**

Replace `slowExtraction`, `stopAvailable`, `startSlowTimers`, and `clearSlowRecovery` with engine-owned deadline handling. Extend `ActiveReview` with the original `File` and locks:

```ts
interface ActiveReview {
  phase: 'processing' | 'error' | 'ready';
  title: string;
  application: ApplicationData;
  file?: File;
  extraction: LabelExtraction;
  manualEvidenceLocks: ManualEvidenceLocks;
  rawText: string;
  isGuidedDemo?: boolean;
  isManualEvidence?: boolean;
  imageUrl?: string;
  imageClassName?: string;
  evidencePreview?: ReactNode;
  objectUrl?: string;
  disclosure?: string;
  shouldFocusReviewHeading?: boolean;
  shouldFocusManualDisclosure?: boolean;
  error?: string;
  progress?: number;
  durationMs?: number;
}
```

Extract the current body of `startReview` into a run helper that accepts `preserveDraft`. For a first run it creates the object URL, clears locks, and resets visual flags. For retry it reuses `review.file`, image URL, extraction, locks, and visual flags. Map the result with this exact policy:

```ts
const isDeadline = output.error === 'deadline-exceeded';
setReview((current) => {
  if (!current || extractionRun.current !== run) return current;
  if (isDeadline) {
    return {
      ...current,
      phase: 'ready',
      isManualEvidence: true,
      extraction: preserveDraft ? current.extraction : {},
      rawText: preserveDraft ? current.rawText : '',
      disclosure: 'OCR stopped after five seconds. The original label is ready for manual evidence review.',
      shouldFocusManualDisclosure: true,
      progress: undefined,
      durationMs: undefined,
      error: undefined,
    };
  }
  const extraction = preserveDraft
    ? mergeUntouchedOcrEvidence(current.extraction, output.extraction, current.manualEvidenceLocks)
    : output.extraction;
  return {
    ...current,
    phase: output.error ? 'error' : 'ready',
    extraction,
    rawText: output.rawText || current.rawText,
    progress: undefined,
    durationMs: output.error ? undefined : output.durationMs,
    error: output.error ? friendlyExtractionError(output.error) : undefined,
    shouldFocusManualDisclosure: false,
  };
});
```

Keep run-token checks before every state update. `retryOcr` must start a fresh controller/run token and call the helper with `preserveDraft: true`; it must not call `resetVisualConfirmations`. `correctCandidate` calls `setManualCandidate` and marks `{ [field]: true }`; a new `clearCandidate` calls `clearManualCandidate` and marks the same lock.

- [ ] **Step 4: Update `ReviewDesk` to render the manual state rather than the obsolete slow notice**

Replace `slowExtraction`, `stopAvailable`, `onManualReview`, and `onStopOcr` props with:

```ts
manualEvidence?: boolean;
onRetryOcr?: () => void;
onClearCandidate: (field: CandidateField) => void;
```

Render the manual message and retry action adjacent to the existing disclosure:

```tsx
{manualEvidence ? (
  <div className="manual-evidence-actions">
    <p>Human-entered evidence is preserved. Retry OCR can fill only untouched empty fields.</p>
    <button type="button" className="button button--secondary" onClick={onRetryOcr}>
      Retry OCR
    </button>
  </div>
) : null}
```

For every existing editable candidate row, add a `Remove {label} evidence` button that invokes `onClearCandidate(candidateField)`. This removes the candidate and leaves the App lock in place. When `manualEvidence` is true and `result` is absent (the batch/no-application route), render the following explicit no-application workspace instead of a validation table:

```tsx
{manualEvidence && !result ? (
  <SectionCard title="Manual evidence entry" eyebrow="Reviewer-recorded label facts">
    <p className="section-copy">
      No application record is attached to this label. Enter only facts you can verify on the image.
    </p>
    <table>
      <thead>
        <tr><th scope="col">Field</th><th scope="col">Evidence</th><th scope="col">Action</th></tr>
      </thead>
      <tbody>
        {evidenceFields.map((field) => {
          const candidate = extraction[field];
          return (
            <tr key={field}>
              <th scope="row">{fieldLabel(field)}</th>
              <td>{candidate ? candidate.value : 'No evidence entered'}</td>
              <td>{renderCandidateEditor(field, candidate)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </SectionCard>
) : null}
```

Extract the existing correction controls into `renderCandidateEditor(field, candidate)` so the validated table and this manual table share add, correct, remove, source-chip, and focus-restoration behavior. Do not invent application data or validation results.

Leave the existing disclosure focus effect intact. Set `shouldFocusManualDisclosure` only on the deadline transition so a retry completion does not unexpectedly move focus.

- [ ] **Step 5: Run the single-review regression suite**

Run:

```sh
RUNTIME_NODE=/Users/kun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
PNPM_MJS=/Users/kun/.cache/node/corepack/v1/pnpm/11.12.0/bin/pnpm.mjs
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run -- src/App.test.tsx
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" typecheck
```

Expected: both commands exit 0; the old five-/fifteen-second notice tests are removed and the deadline disclosure receives focus automatically.

- [ ] **Step 6: Commit single-label manual review**

```sh
git add src/App.tsx src/components/ReviewDesk.tsx src/App.test.tsx
git commit -m "feat: open manual review at OCR deadline"
```

### Task 4: Route batch deadlines to a preserved manual-review queue state

**Files:**
- Modify: `src/features/intake/queue.ts:24-335`
- Modify: `src/features/intake/queue.test.ts:1-520`
- Modify: `src/components/BatchQueue.tsx:36-1001`
- Modify: `src/styles.css:1920-1985`
- Modify: `src/App.test.tsx:262-620`
- Modify: `src/features/intake/export.test.ts:1-100`

**Interfaces:**
- Consumes: `error: 'deadline-exceeded'`, Task 1 merge helpers, and `ReviewDesk` manual props from Task 3.
- Produces: `QueueStatus = 'manual_review_required'`, `QueueItem.manualEvidenceLocks`, batch-manual `Open manual review` and `Retry OCR` actions, and an exported deadline reason.

- [ ] **Step 1: Add failing queue and UI tests for the distinct deadline path**

In `src/features/intake/queue.test.ts`, add these cases:

```ts
it('maps a deadline result to manual_review_required and preserves its review inputs', async () => {
  const original = file('deadline.png');
  const queue = createReviewQueue([
    { id: 'deadline', file: original, application },
  ], async () => ({
    extraction: {}, rawText: '', source: 'ocr',
    thumbnailUrl: 'data:image/jpeg;base64,preview', error: 'deadline-exceeded',
  }), 1);

  await queue.start();

  expect(queue.items[0]).toMatchObject({
    status: 'manual_review_required', file: original, application,
    thumbnailUrl: 'data:image/jpeg;base64,preview', progress: 1,
  });
  expect(queue.items[0]?.result).toBeUndefined();
});

it('continues the queue after a deadline item completes', async () => {
  const calls: string[] = [];
  const queue = createReviewQueue([
    { id: 'deadline', file: file('deadline.png') },
    { id: 'next', file: file('next.png') },
  ], async (job) => {
    calls.push(job.id);
    return job.id === 'deadline'
      ? { extraction: {}, rawText: '', source: 'ocr', error: 'deadline-exceeded' }
      : successfulResult();
  }, 1);

  await queue.start();

  expect(calls).toEqual(['deadline', 'next']);
  expect(queue.items.map((item) => item.status)).toEqual([
    'manual_review_required',
    'extracted_pending_application',
  ]);
});

it('preserves manual values and deliberate blanks when a deadline row retries', async () => {
  let attempts = 0;
  const queue = createReviewQueue([{ id: 'retry', file: file('retry.png'), application }], async () => {
    attempts += 1;
    return attempts === 1
      ? { extraction: {}, rawText: '', source: 'ocr', error: 'deadline-exceeded' }
      : {
          extraction: {
            brandName: { value: 'OCR BRAND', rawText: 'OCR BRAND', confidence: 0.99, source: 'ocr' },
            proof: { value: '90 Proof', rawText: '90 Proof', confidence: 0.99, source: 'ocr' },
            abv: { value: '45%', rawText: '45%', confidence: 0.99, source: 'ocr' },
          },
          rawText: 'OCR BRAND 90 Proof 45%',
          source: 'ocr',
        };
  }, 1);

  await queue.start();
  const item = queue.items[0]!;
  item.extraction = clearManualCandidate(
    setManualCandidate({}, 'brandName', 'HUMAN BRAND'),
    'proof',
  );
  item.manualEvidenceLocks = { brandName: true, proof: true };
  await queue.retry('retry');

  expect(item.extraction).toMatchObject({
    brandName: { value: 'HUMAN BRAND', source: 'agent' },
    abv: { value: '45%', source: 'ocr' },
  });
  expect(item.extraction?.proof).toBeUndefined();
});
```

In `src/App.test.tsx`, add application-backed and filename-only deadline rows with the same explicit interaction contract:

```ts
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
  };
  render(<App initialBatchItems={[item]} />);

  expect(screen.getByText('Manual review required')).toBeInTheDocument();
  expect(screen.queryByText('Extraction error')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /open manual review for deadline-triage\.png/i }));
  expect(screen.getByRole('heading', { name: /manual evidence entry/i })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /label preview: deadline-triage\.png/i })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /back to batch/i }));
  expect(screen.getByText('Manual review required')).toBeInTheDocument();
});
```

Repeat that assertion with `application: batchApplication` to prove the application-backed path renders comparison fields without rerunning OCR. In `src/features/intake/export.test.ts`, serialize a matching deadline row and assert the `manual_review_required` status and `OCR stopped after five seconds` reason remain in the existing `status` and `error` columns.

- [ ] **Step 2: Run the focused queue/UI tests and confirm they fail**

Run:

```sh
RUNTIME_NODE=/Users/kun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
PNPM_MJS=/Users/kun/.cache/node/corepack/v1/pnpm/11.12.0/bin/pnpm.mjs
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run -- src/features/intake/queue.test.ts src/features/intake/export.test.ts src/App.test.tsx
```

Expected: FAIL because `manual_review_required` and its UI path do not exist.

- [ ] **Step 3: Implement queue state, deadline mapping, and draft-preserving retry**

In `src/features/intake/queue.ts`, extend the model:

```ts
import type { ManualEvidenceLocks } from '../review/manualEvidence';

export type QueueStatus =
  | 'queued' | 'preparing' | 'reading' | 'validating' | 'ready' | 'error'
  | 'extracted_pending_application' | 'manual_review_required';

export interface QueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  application?: ApplicationData;
  reviewFlags: ReviewFlags;
  status: QueueStatus;
  progress: number;
  result?: VerificationResult;
  extraction?: LabelExtraction;
  rawText?: string;
  source?: ExtractionJobResult['source'];
  thumbnailUrl?: string;
  error?: string;
  durationMs?: number;
  manualEvidenceLocks?: ManualEvidenceLocks;
  isManualEvidence?: boolean;
}
```

Map the OCR outcome before generic errors:

```ts
if (output.error === 'deadline-exceeded') {
  item.extraction = item.isManualEvidence
    ? mergeUntouchedOcrEvidence(item.extraction ?? {}, output.extraction, item.manualEvidenceLocks ?? {})
    : output.extraction;
  item.rawText = output.rawText || item.rawText;
  item.thumbnailUrl = output.thumbnailUrl ?? item.thumbnailUrl;
  item.source = output.source;
  item.durationMs = output.durationMs ?? Date.now() - startedAt;
  item.status = 'manual_review_required';
  item.isManualEvidence = true;
  item.progress = 1;
  item.error = 'OCR stopped after five seconds. Open manual review to inspect the original label.';
  return;
}
```

Make retry preservation explicit by replacing `resetForRetry` with this branch:

```ts
const resetForRetry = (item: QueueItem): void => {
  if (item.isManualEvidence) {
    item.status = 'queued';
    item.progress = 0;
    item.result = undefined;
    item.error = undefined;
    item.durationMs = undefined;
    return;
  }

  releaseObjectUrl(item.thumbnailUrl);
  item.status = 'queued';
  item.progress = 0;
  item.result = undefined;
  item.extraction = undefined;
  item.rawText = undefined;
  item.source = undefined;
  item.thumbnailUrl = undefined;
  item.error = undefined;
  item.durationMs = undefined;
};

const applySuccessfulOutput = (item: QueueItem, output: ExtractionJobResult): void => {
  const priorThumbnail = item.thumbnailUrl;
  item.extraction = item.isManualEvidence
    ? mergeUntouchedOcrEvidence(item.extraction ?? {}, output.extraction, item.manualEvidenceLocks ?? {})
    : output.extraction;
  item.rawText = output.rawText || item.rawText;
  item.source = output.source;
  if (output.thumbnailUrl && output.thumbnailUrl !== priorThumbnail) {
    releaseObjectUrl(priorThumbnail);
    item.thumbnailUrl = output.thumbnailUrl;
  }
};
```

Call `applySuccessfulOutput` before validation in the normal success branch, retain `isManualEvidence`, and validate only when an application record exists. A retry of an ordinary extraction error keeps the destructive reset behavior shown above.

- [ ] **Step 4: Implement batch presentation and manual workspaces**

In `src/components/BatchQueue.tsx`:

```ts
type QueueFilter =
  | 'all' | 'in_progress' | 'extracted_pending_application' | 'error'
  | 'manual_review_required' | ReviewState;

const processedStatuses = new Set<QueueStatus>([
  'ready', 'error', 'extracted_pending_application', 'manual_review_required',
]);
```

Add the exact status/action branches below the existing ready/error controls:

```tsx
const requiresManualReview = item.status === 'manual_review_required';
const canViewEvidence = processedStatuses.has(item.status);

{requiresManualReview ? (
  <button
    ref={(element) => { fullReviewTriggerRefs.current[item.id] = element; }}
    type="button"
    className="text-button"
    onClick={() => openFullReview(item.id)}
    aria-label={`Open manual review for ${item.name}`}
  >
    Open manual review
  </button>
) : null}
{requiresManualReview && activeGenerationRef.current ? (
  <button
    type="button"
    className="text-button"
    onClick={() => retry(item.id)}
    aria-label={`Retry OCR for ${item.name}`}
  >
    Retry OCR
  </button>
) : null}
```

Add `manual_review_required` to the filter select as `Manual review required`, count it separately in the polite batch summary, and do not add it to `errorCount`. In `statusFor`, return `<span className="batch-status batch-status--manual">Manual review required</span>` before the generic status branch.

Relax the full-review gate from `fullReviewItem?.application && fullReviewItem.extraction` to any selected item. In `BatchFullReview`, use the following display-only result selection and callback wiring:

```tsx
const displayResult = item.application
  ? item.result ?? validateLabel({
      application: item.application,
      extraction: item.extraction ?? {},
      flags: item.reviewFlags,
    })
  : undefined;

<ReviewDesk
  title={item.name}
  extraction={item.extraction ?? {}}
  result={displayResult}
  phase="ready"
  rawText={item.rawText ?? ''}
  imageUrl={imageUrl}
  durationMs={item.durationMs}
  isGuidedDemo={false}
  shouldFocusReviewHeading
  shouldFocusManualDisclosure={false}
  manualEvidence={Boolean(item.isManualEvidence)}
  onRetryOcr={() => { onRetry(item.id); onBack(); }}
  warningTypographyConfirmed={item.reviewFlags.warningTypographyConfirmed}
  onWarningTypographyConfirmed={(confirmed) => onUpdateFlags({ warningTypographyConfirmed: confirmed })}
  warningLegibilityConfirmed={item.reviewFlags.warningLegibilityConfirmed}
  onWarningLegibilityConfirmed={(confirmed) => onUpdateFlags({ warningLegibilityConfirmed: confirmed })}
  onCorrectCandidate={onCorrectCandidate}
  onClearCandidate={onClearCandidate}
  exitLabel="Back to batch"
  onExit={onBack}
/>
```

If application facts do not exist, `ReviewDesk` renders its no-application manual-entry table. The retry callback closes full review, queues a fresh retry, and returns focus to the triggering row when the reviewer comes back.

Update `updateBatchCandidate` and new `clearBatchCandidate` to mutate the item through Task 1 helpers, add `{ [field]: true }` to `manualEvidenceLocks`, and revalidate only when application data exists. Preserve `reviewFlags` exactly as the existing flag callback does.

In `src/styles.css`, add the following narrowly scoped styles near the existing batch status rules:

```css
.batch-status--manual {
  color: #6a3f0a;
  background: #f8e2b8;
}

.manual-evidence-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin: 12px 0;
}

.manual-evidence-actions p {
  margin: 0;
}
```

- [ ] **Step 5: Run the batch regression suite**

Run:

```sh
RUNTIME_NODE=/Users/kun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
PNPM_MJS=/Users/kun/.cache/node/corepack/v1/pnpm/11.12.0/bin/pnpm.mjs
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run -- src/features/intake/queue.test.ts src/features/intake/export.test.ts src/App.test.tsx
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" typecheck
```

Expected: both commands exit 0; deadline rows remain visible and the queue finishes later jobs without waiting for a reviewer.

- [ ] **Step 6: Commit batch deadline handling**

```sh
git add src/features/intake/queue.ts src/features/intake/queue.test.ts src/components/BatchQueue.tsx src/styles.css src/App.test.tsx src/features/intake/export.test.ts
git commit -m "feat: route batch OCR deadlines to manual review"
```

### Task 5: Keep benchmark behavior and documentation truthful

**Files:**
- Modify: `src/components/BenchmarkPanel.tsx:120-151`
- Modify: `src/App.test.tsx:971-1033`
- Modify: `README.md:79-131`
- Modify: `docs/DESIGN.md:84-151`
- Modify: `src/readme.test.ts:123-172`

**Interfaces:**
- Consumes: `ExtractionOptions.deadlineMs` from Task 2 and the completed batch/manual workflow from Task 4.
- Produces: an uncapped benchmark and documentation that states both the review-ready deadline and its browser-scheduling boundary.

- [ ] **Step 1: Add failing benchmark and documentation assertions**

In the existing benchmark App test, assert both calls receive the explicit opt-out:

```ts
expect(extractFromImage).toHaveBeenNthCalledWith(
  1, expect.any(File), expect.any(Function),
  expect.objectContaining({ deadlineMs: null }),
);
expect(extractFromImage).toHaveBeenNthCalledWith(
  2, expect.any(File), expect.any(Function),
  expect.objectContaining({ deadlineMs: null }),
);
```

Replace old README/DESIGN assertions with identical required phrases in both files:

```ts
expect(readme).toContain('After five seconds of automated OCR, Proofline opens manual evidence review.');
expect(readme).toContain('Batch items that reach the deadline are marked Manual review required while the queue continues.');
expect(readme).toContain('The local benchmark explicitly disables the five-second OCR deadline.');
expect(readme).toContain('normal responsive browser scheduling');
```

Run the docs test before editing its target files; it should fail on the new phrases.

- [ ] **Step 2: Make benchmark runs explicitly uncapped**

In each `BenchmarkPanel` call to `extractFromImage`, preserve the caller signal and add the opt-out:

```ts
}, { signal: abortController.signal, deadlineMs: null });
```

Do not change the fetch behavior, device-specific timing disclosure, or guided fixture behavior.

- [ ] **Step 3: Update product and design documentation together**

In `README.md` and `docs/DESIGN.md`, replace the old five-/fifteen-second recovery narrative with these precise statements:

```md
After five seconds of automated OCR, Proofline opens manual evidence review. The deadline
starts when active extraction begins and includes image preparation, worker acquisition,
initialization, and recognition. The original label and submitted facts remain available;
reviewers may enter evidence immediately or explicitly retry OCR.

Batch items that reach the deadline are marked Manual review required while the queue
continues. They retain their original file and any available evidence, including when no
application row was supplied.

The local benchmark explicitly disables the five-second OCR deadline so its first and
warm-worker timings remain an honest measurement of the current device. The deadline is
an automated-wait target under normal responsive browser scheduling, not an absolute
real-time guarantee while a browser event loop is blocked.
```

Keep the no-backend/privacy claims, two-worker/300-file limits, and warning-review scope unchanged. Update `src/readme.test.ts` so the contract test requires the same exact statements in both documents and no longer expects the fifteen-second stop action.

- [ ] **Step 4: Run documentation, focused, and full verification**

Run:

```sh
RUNTIME_NODE=/Users/kun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
PNPM_MJS=/Users/kun/.cache/node/corepack/v1/pnpm/11.12.0/bin/pnpm.mjs
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run -- src/readme.test.ts src/App.test.tsx
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" typecheck
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" build
```

Expected: all commands exit 0. The build creates `dist/client`, and the same-origin OCR artifact check remains part of `scripts/prepare-sites-worker.mjs`.

- [ ] **Step 5: Commit benchmark and documentation work**

```sh
git add src/components/BenchmarkPanel.tsx src/App.test.tsx README.md docs/DESIGN.md src/readme.test.ts
git commit -m "docs: clarify five-second review deadline"
```

### Task 6: Perform final review and deploy-safe verification

**Files:**
- Verify only: all files changed by Tasks 1–5.

**Interfaces:**
- Consumes: the complete feature branch and existing static-host build contract.
- Produces: evidence that the feature is safe to merge and deploy to AWS Amplify.

- [ ] **Step 1: Inspect the final diff for scope and accidental artifacts**

Run:

```sh
git status --short
git diff main...HEAD --check
git diff main...HEAD --stat
```

Expected: no whitespace errors, no generated OCR assets, no lockfile churn, and only the planned source, test, style, and documentation paths.

- [ ] **Step 2: Run all automated checks from a clean build state**

Run:

```sh
RUNTIME_NODE=/Users/kun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
PNPM_MJS=/Users/kun/.cache/node/corepack/v1/pnpm/11.12.0/bin/pnpm.mjs
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" typecheck
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" build
test -s dist/client/ocr/eng.traineddata.gz
```

Expected: all commands exit 0 and the compressed English training data exists in the production artifact.

- [ ] **Step 3: Run browser smoke tests before deployment**

Use the local production preview and verify these user-visible paths:

```text
1. Submit a real single label; confirm normal OCR still produces evidence.
2. Exercise a controlled deadline result; confirm the manual disclosure receives focus,
   original image remains visible, and Retry OCR is explicit.
3. Add human evidence, remove a candidate, set a visual flag, retry, and confirm only an
   untouched empty field gains OCR evidence.
4. Start a two-or-more-item batch with a controlled deadline row; confirm the next item
   completes, the row says Manual review required, and both application-backed and
   filename-only manual workspaces open without leaving the queue automatically.
5. Run the sample benchmark and confirm it still shows first and warm-worker timings.
```

- [ ] **Step 4: Request code review and hand off for AWS Amplify deployment**

```sh
git log --oneline main..HEAD
git status --short
```

Expected: all feature commits are visible, the worktree is clean, and the branch is ready for code review before push/merge. After merge to `main`, wait for the existing Amplify Hosting build, then repeat the public single-label, batch, benchmark, and `ocr/eng.traineddata.gz` smoke checks.
