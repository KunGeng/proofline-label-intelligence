# Proofline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a polished, browser-first alcohol-label verification prototype that helps an agent compare U.S. distilled-spirit application data against label evidence.

**Architecture:** A Vite React/TypeScript single-page application keeps uploaded data in browser memory. An extraction adapter provides fixture-backed demo results and local Tesseract OCR for uploads; a pure domain module parses, normalizes, and validates data before UI components render an explainable human-review workflow. Batch orchestration processes at most two images concurrently, releases decoded image resources after processing, and retains file handles only to enable retry during the active session.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, Tesseract.js with same-origin language assets, Lucide React, plain CSS custom properties.

## Global Constraints

- Scope validation to U.S. distilled-spirit labels; describe other beverage classes and physical-label requirements as out of scope.
- Accept JPEG, PNG, and WebP files up to 10 MB each; permit a 300-file batch selection.
- Resize only images whose longest edge exceeds 2,000 px; run no more than two OCR workers concurrently.
- Treat extraction confidence of `>= 0.85` as high, `0.60–0.84` as review, and `< 0.60` as unreadable.
- Never show “Approved”; a clear result reads exactly: `No discrepancies detected — agent approval required.`
- Preserve raw OCR after an agent correction and label the corrected candidate `Agent-entered`.
- Compare the government warning against the exact federal canonical statement; require literal uppercase `GOVERNMENT WARNING:` and explicit reviewer confirmation for typography.
- Use `Mismatch > Unreadable > Needs review > Match` for overall-status precedence.
- Keep files, OCR text, and results in the current browser session only; no server, API key, analytics, or external runtime OCR CDN.

---

## File Structure

```text
package.json                         Dependencies and scripts
vite.config.ts                       Vite and Vitest configuration
src/main.tsx                         React bootstrap
src/App.tsx                          Route-free application state and screen selection
src/styles.css                       Design tokens, responsive layout, motion, focus styles
src/domain/types.ts                  Stable domain types
src/domain/constants.ts              Canonical warning and field labels
src/domain/normalize.ts              Deterministic text, units, and similarity helpers
src/domain/validation.ts             Pure application-versus-label evaluator
src/domain/validation.test.ts        Validation unit tests
src/features/demo/cases.ts           Fixture-backed guided demo cases
src/features/extraction/types.ts     OCR/extraction contracts
src/features/extraction/parser.ts    Raw OCR text parsers
src/features/extraction/ocr.ts       Local OCR adapter and image preparation
src/features/extraction/parser.test.ts Parser tests
src/features/intake/csv.ts           CSV parsing and filename association
src/features/intake/csv.test.ts      CSV tests
src/features/intake/queue.ts         Bounded-concurrency batch queue
src/features/intake/queue.test.ts    Queue tests
src/features/intake/export.ts        CSV serialization and browser download
src/features/intake/export.test.ts   Export tests
src/components/ui.tsx                Reusable buttons, badges, cards, and status chips
src/components/Landing.tsx           Product landing and guided demo entry point
src/components/IntakeForm.tsx        Accessible application form and image dropzone
src/components/ReviewDesk.tsx        Evidence, field comparison, and reviewer confirmation UI
src/components/BatchQueue.tsx        Batch upload, progress, filters, retries, export
src/components/AppShell.tsx          Header, progress rail, keyboard-accessible layout
src/test/setup.ts                    Testing Library setup
src/App.test.tsx                     High-value UI smoke tests
src/readme.test.ts                   Submission-document acceptance test
public/demo/old-tom-bourbon.svg      Original test label artwork
public/ocr/*                         Same-origin OCR worker/core/language assets
README.md                            Setup, usage, architecture, limits, deployment guide
```

## Task 1: Bootstrap the production-quality application shell

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/test/setup.ts`, `src/App.test.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Produces `App`, mounted by `main.tsx`.
- Produces scripts: `dev`, `build`, `test`, `test:run`, `lint`.

- [ ] **Step 1: Write the failing landing-page test.**

```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';

it('offers a guided demo and a label-review entry point', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /review labels with evidence/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /open guided demo/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /review a label/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and confirm it fails because the app scaffold is absent.**

Run: `pnpm test:run src/App.test.tsx`
Expected: test command or imported module is unavailable.

- [ ] **Step 3: Scaffold Vite React TypeScript and add runtime/test dependencies.**

Use `react`, `react-dom`, `lucide-react`, `tesseract.js`, `vite`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, and `@testing-library/user-event`. Configure Vitest with `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, and `globals: true`.

Implement the initial app contract exactly:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <p className="eyebrow">PROOFLINE / LABEL INTELLIGENCE</p>
      <h1>Review labels with evidence, not guesswork.</h1>
      <button type="button">Open guided demo</button>
      <button type="button">Review a label</button>
    </main>
  );
}
```

Define CSS tokens for ink, paper, amber, red, mint, 8 px spacing increments, visible `:focus-visible` outlines, `prefers-reduced-motion`, and a one-column mobile breakpoint at 860 px. Add `.gitignore` entries for `node_modules`, `dist`, `.DS_Store`, and test coverage output.

- [ ] **Step 4: Run the initial quality gate.**

Run: `pnpm test:run src/App.test.tsx && pnpm build`
Expected: one passing test and a generated `dist/` bundle.

- [ ] **Step 5: Commit the shell.**

```bash
git add package.json pnpm-lock.yaml vite.config.ts tsconfig.json index.html .gitignore src
git commit -m "chore: scaffold Proofline application"
```

## Task 2: Build the pure compliance domain and validation engine

**Files:**
- Create: `src/domain/types.ts`, `src/domain/constants.ts`, `src/domain/normalize.ts`, `src/domain/validation.ts`, `src/domain/validation.test.ts`

**Interfaces:**
- Consumes: no UI or OCR modules.
- Produces `validateLabel(input: ValidationInput): VerificationResult`.

- [ ] **Step 1: Write failing domain tests for exact warning checks, likely-equivalent brands, numeric conflicts, typography confirmation, and overall precedence.**

```ts
const candidate = (value: string, confidence = 0.99): Candidate => ({ value, rawText: value, confidence, source: 'fixture' });
const fixture = (overrides: Partial<LabelExtraction> = {}, flags = { warningTypographyConfirmed: false }): ValidationInput => ({
  application: { brandName: "Stone's Throw", classType: 'Bourbon Whiskey', abv: '45%', proof: '90', netContents: '750 mL', producerAddress: 'Example, KY', isImported: false },
  extraction: {
    brandName: candidate("Stone's Throw"), classType: candidate('Bourbon Whiskey'), abv: candidate('45%'), proof: candidate('90 Proof'),
    netContents: candidate('750 mL'), producerAddress: candidate('Example, KY'), warningText: candidate(CANONICAL_WARNING),
    warningHeading: candidate(CANONICAL_WARNING_HEADING), ...overrides,
  },
  flags,
});
const byField = (result: VerificationResult, field: FieldKey) => result.fields.find((item) => item.field === field)!;

it('routes a case-only brand difference to review rather than automatic match', () => {
  const result = validateLabel(fixture({ brandName: candidate("OLD TOM DISTILLERY") }));
  expect(byField(result, 'brandName')).toMatchObject({ state: 'needs_review' });
});

it('returns mismatch before unreadable and review states', () => {
  const result = validateLabel(fixture({ abv: candidate('40%', 0.99), netContents: candidate('', 0.3) }));
  expect(result.overallState).toBe('mismatch');
});

it('keeps warning typography in review until an agent confirms it', () => {
  expect(byField(validateLabel(fixture()), 'warningTypography').state).toBe('needs_review');
  expect(byField(validateLabel(fixture({}, { warningTypographyConfirmed: true })), 'warningTypography').state).toBe('match');
});
```

- [ ] **Step 2: Run the unit test and confirm it fails because `validateLabel` is undefined.**

Run: `pnpm test:run src/domain/validation.test.ts`
Expected: FAIL with an import or undefined-symbol error.

- [ ] **Step 3: Define the domain contracts and implement deterministic rules.**

```ts
export type FieldKey =
  | 'brandName' | 'classType' | 'abv' | 'proof' | 'netContents'
  | 'producerAddress' | 'countryOfOrigin' | 'warningText'
  | 'warningHeading' | 'warningTypography';
export type ReviewState = 'match' | 'mismatch' | 'needs_review' | 'unreadable';
export type CandidateSource = 'ocr' | 'fixture' | 'agent';

export interface Candidate { value: string; rawText: string; confidence: number; source: CandidateSource; }
export interface ApplicationData {
  brandName: string; classType: string; abv: string; proof?: string;
  netContents: string; producerAddress: string; isImported: boolean; countryOfOrigin?: string;
}
export interface LabelExtraction {
  brandName?: Candidate; classType?: Candidate; abv?: Candidate; proof?: Candidate;
  netContents?: Candidate; producerAddress?: Candidate; countryOfOrigin?: Candidate;
  warningText?: Candidate; warningHeading?: Candidate;
}
export interface ValidationInput {
  application: ApplicationData; extraction: LabelExtraction;
  flags: { warningTypographyConfirmed: boolean };
}
export interface FieldResult {
  field: FieldKey; state: ReviewState; expected: string; observed: string;
  confidence?: number; reason: string;
}
export interface VerificationResult { fields: FieldResult[]; overallState: ReviewState; }
```

Export `CANONICAL_WARNING`, `CANONICAL_WARNING_HEADING`, `fieldLabel`, `canonicalizeText`, `stringSimilarity`, `parseAbv`, `parseProof`, `parseMilliliters`, `candidateState`, and `validateLabel`. Normalize only whitespace, apostrophe variants, simple punctuation, unit case, and locale-safe case. Treat brand/type raw equality as match, normalized-only equality and similarity `>= 0.85` as review, high-confidence lower-similarity as mismatch, and non-high-confidence conflicts as review. Require high confidence for any OCR-driven hard mismatch. Use `['mismatch', 'unreadable', 'needs_review', 'match']` to determine the overall state.

- [ ] **Step 4: Run all domain tests.**

Run: `pnpm test:run src/domain/validation.test.ts`
Expected: PASS, including warning-title-case mismatch, ABV/proof conflict, import-country conditional behavior, and agent-confirmed typography.

- [ ] **Step 5: Commit the domain layer.**

```bash
git add src/domain
git commit -m "feat: add deterministic label validation"
```

## Task 3: Add original demo assets and a local extraction boundary

**Files:**
- Create: `public/demo/old-tom-bourbon.svg`, `public/ocr/eng.traineddata.gz`, `src/features/demo/cases.ts`, `src/features/extraction/types.ts`, `src/features/extraction/parser.ts`, `src/features/extraction/ocr.ts`, `src/features/extraction/parser.test.ts`, `scripts/sync-ocr-assets.mjs`
- Modify: `package.json`, `vite.config.ts`

**Interfaces:**
- Consumes: `ApplicationData`, `Candidate`, and `LabelExtraction` from `src/domain/types.ts`.
- Produces `extractFromText(rawText, confidence): LabelExtraction` and `extractFromImage(file, onProgress): Promise<ExtractionJobResult>`.

- [ ] **Step 1: Write parser tests with the Old Tom label facts and a malformed warning.**

```ts
it('extracts the supplied bourbon facts from readable OCR text', () => {
  const extraction = extractFromText(OLD_TOM_RAW_TEXT, 0.96);
  expect(extraction.abv?.value).toBe('45%');
  expect(extraction.proof?.value).toBe('90 Proof');
  expect(extraction.netContents?.value).toBe('750 mL');
});

it('retains the raw OCR body for evidence even when a field parser cannot find a value', () => {
  expect(extractFromText('decorative text only', 0.72).brandName).toBeUndefined();
});
```

- [ ] **Step 2: Run the parser test and confirm it fails.**

Run: `pnpm test:run src/features/extraction/parser.test.ts`
Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Create the demo, parser, and OCR adapter.**

Create an original SVG label with `OLD TOM DISTILLERY`, `Kentucky Straight Bourbon Whiskey`, `45% Alc./Vol. (90 Proof)`, `750 mL`, `Bottled by Old Tom Distillery, Louisville, KY`, and the full canonical warning. Export this fixture contract:

```ts
export interface ExtractionProgress { phase: 'preparing' | 'reading' | 'validating'; value: number; }
export interface ExtractionJobResult {
  extraction: LabelExtraction; rawText: string; thumbnailUrl?: string;
  error?: string; source: 'ocr' | 'fixture';
}
export type ProgressListener = (event: ExtractionProgress) => void;
export type ExtractFromImage = (file: File, onProgress: ProgressListener) => Promise<ExtractionJobResult>;
export interface DemoCase {
  id: string; title: string; imageUrl: string; disclosure: string;
  application: ApplicationData; extraction: LabelExtraction;
}

export const oldTomDemo: DemoCase = {
  id: 'old-tom-clear',
  title: 'Old Tom Distillery / clear label',
  imageUrl: '/demo/old-tom-bourbon.svg',
  disclosure: 'Precomputed sample — not a live OCR timing result.',
  application: { brandName: 'OLD TOM DISTILLERY', classType: 'Kentucky Straight Bourbon Whiskey', abv: '45%', proof: '90', netContents: '750 mL', producerAddress: 'Old Tom Distillery, Louisville, KY', isImported: false },
  extraction: extractFromText(OLD_TOM_RAW_TEXT, 0.99),
};
```

Implement parser regexes only for the scoped fields and preserve all raw text in `ExtractionJobResult`. Define `OLD_TOM_RAW_TEXT` in `cases.ts` as the complete textual content of the original SVG. Implement `prepareImage(file)` with MIME and 10 MB validation, EXIF-aware orientation where supported, canvas resize to a 2,000 px maximum edge, and guaranteed `URL.revokeObjectURL` cleanup. Add `scripts/sync-ocr-assets.mjs` to copy `node_modules/tesseract.js/dist/worker.min.js` and the four `tesseract-core*.wasm.js` files from `node_modules/tesseract.js-core/` into `public/ocr/`, then download `https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz` into the same directory. The running application only requests `/ocr/` paths. Configure Tesseract worker/core/language URLs to `/ocr/` assets and provide progress events `{ phase: 'preparing' | 'reading' | 'validating'; value: number }`. Export `extractFromImage` with the `ExtractFromImage` signature and return an `unreadable` error result rather than throw for a worker failure.

- [ ] **Step 4: Validate parser tests and build output.**

Run: `pnpm test:run src/features/extraction/parser.test.ts && pnpm build`
Expected: parser tests pass and the build resolves same-origin OCR asset paths.

- [ ] **Step 5: Commit extraction support and original sample asset.**

```bash
git add public/demo public/ocr scripts src/features/demo src/features/extraction package.json pnpm-lock.yaml vite.config.ts
git commit -m "feat: add local extraction and guided demo"
```

## Task 4: Implement safe intake, CSV association, and bounded batch orchestration

**Files:**
- Create: `src/features/intake/csv.ts`, `src/features/intake/csv.test.ts`, `src/features/intake/queue.ts`, `src/features/intake/queue.test.ts`

**Interfaces:**
- Consumes: `ApplicationData`, `extractFromImage`, and `validateLabel`.
- Produces `parseBatchCsv(csvText, files): CsvImportResult` and `createReviewQueue(jobs, worker, concurrency): ReviewQueue`.

- [ ] **Step 1: Write failing CSV and queue tests.**

```ts
const file = (name: string, type = 'image/png') => new File(['label'], name, { type });
async function exerciseQueue(concurrency: number, count: number) {
  let active = 0;
  let maxActive = 0;
  const queue = createReviewQueue(Array.from({ length: count }, (_, index) => ({ id: String(index), file: file(`${index}.png`) })), async () => {
    active += 1;
    maxActive = Math.max(active, maxActive);
    await Promise.resolve();
    active -= 1;
    return { extraction: {}, rawText: '', source: 'fixture' };
  }, concurrency);
  await queue.start();
  return { maxActive };
}

it('matches filename rows case-insensitively and trims whitespace', () => {
  const result = parseBatchCsv('filename,brandName\n OLD-TOM.PNG ,OLD TOM', [file('old-tom.png')]);
  expect(result.matched).toHaveLength(1);
});

it('reports duplicate rows and leaves an image without a row in triage state', () => {
  const result = parseBatchCsv('filename\na.png\na.png', [file('a.png'), file('b.png')]);
  expect(result.errors).toContainEqual(expect.stringMatching(/duplicate/i));
  expect(result.unmatchedFiles[0].name).toBe('b.png');
});

it('never starts more jobs than the concurrency cap', async () => {
  const { maxActive } = await exerciseQueue(2, 8);
  expect(maxActive).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `pnpm test:run src/features/intake`
Expected: FAIL because CSV and queue modules are absent.

- [ ] **Step 3: Implement CSV and queue contracts.**

Use the exact CSV headers `filename`, `brandName`, `classType`, `abv`, `proof`, `netContents`, `producerAddress`, `isImported`, and `countryOfOrigin`. Require `filename`; parse `isImported` only from `true` or `false`; surface all other invalid application cells as an import error. Normalized filename matching uses the lowercased basename. Images without a matching record become `extracted_pending_application`; CSV rows without files and duplicate filename rows are errors.

Implement queue state as:

```ts
export type QueueStatus = 'queued' | 'preparing' | 'reading' | 'validating' | 'ready' | 'error' | 'extracted_pending_application';
export interface QueueJob { id: string; file: File; application?: ApplicationData; }
export interface QueueItem {
  id: string; file: File; name: string; size: number; status: QueueStatus; progress: number;
  result?: VerificationResult; extraction?: LabelExtraction; thumbnailUrl?: string; error?: string;
}
export type QueueWorker = (job: QueueJob, report: (progress: number, status: QueueStatus) => void) => Promise<ExtractionJobResult>;
export interface ReviewQueue { items: QueueItem[]; start(): Promise<void>; retry(id: string): Promise<void>; }
export function createReviewQueue(jobs: QueueJob[], worker: QueueWorker, concurrency: number): ReviewQueue;
```

The queue may select 300 files but invokes its worker with concurrency `2`. After a job reaches `ready`, retain its original `File` only for retry, plus `name`, `size`, thumbnail URL, and extraction/result metadata; revoke the full-size preview URL and release every decoded bitmap when the item is replaced or cleared.

- [ ] **Step 4: Run the intake test suite.**

Run: `pnpm test:run src/features/intake`
Expected: PASS for malformed rows, no-CSV triage, filename matching, and a two-worker cap.

- [ ] **Step 5: Commit batch foundations.**

```bash
git add src/features/intake
git commit -m "feat: add CSV intake and batch queue"
```

## Task 5: Build the accessible review desk and reviewer controls

**Files:**
- Create: `src/components/ui.tsx`, `src/components/AppShell.tsx`, `src/components/Landing.tsx`, `src/components/IntakeForm.tsx`, `src/components/ReviewDesk.tsx`
- Modify: `src/App.tsx`, `src/styles.css`, `src/App.test.tsx`

**Interfaces:**
- Consumes: `DemoCase`, `ApplicationData`, `QueueItem`, `VerificationResult`, and review flags.
- Produces a single-label flow with accessible form controls and agent confirmation/correction actions.

- [ ] **Step 1: Add failing UI tests for the guided demo, manual warning confirmation, and status wording.**

```tsx
it('opens the demo and asks the reviewer to confirm warning typography', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: /open guided demo/i }));
  expect(screen.getByText(/precomputed sample/i)).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /confirm warning typography/i })).not.toBeChecked();
});

it('never renders an approval claim', async () => {
  render(<App />);
  expect(screen.queryByText(/^approved$/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI tests and confirm the added assertions fail.**

Run: `pnpm test:run src/App.test.tsx`
Expected: FAIL because the review desk and confirmation control are absent.

- [ ] **Step 3: Implement the review components.**

Use a semantic `header`, `nav`, `main`, `section`, `form`, `table`, and `button` structure. `IntakeForm` labels every field, exposes import country only when `isImported` is checked, accepts files through both a visible file input and drag/drop, and shows type/size errors inline. `ReviewDesk` renders application values, extracted candidates, raw OCR evidence, confidence, source chips, status badges, and clear reasons.

Provide an agent correction control that changes only a `Candidate` to `{ ...candidate, value, source: 'agent' }` while keeping `rawText` visible. Use this exact confirmation label: `I visually confirmed the warning heading is uppercase and bold.` It sets `warningTypographyConfirmed` and re-runs `validateLabel`. Render a clean summary only as `No discrepancies detected — agent approval required.`

- [ ] **Step 4: Run UI and domain regression tests.**

Run: `pnpm test:run src/App.test.tsx src/domain/validation.test.ts`
Expected: PASS; the demo is visibly fixture-backed and the typography state changes only after confirmation.

- [ ] **Step 5: Commit the reviewer workflow.**

```bash
git add src/components src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: add evidence-led review desk"
```

## Task 6: Deliver the batch workspace, filters, retry, and export

**Files:**
- Create: `src/components/BatchQueue.tsx`, `src/features/intake/export.ts`, `src/features/intake/export.test.ts`
- Modify: `src/App.tsx`, `src/styles.css`, `src/App.test.tsx`

**Interfaces:**
- Consumes: `ReviewQueue`, `QueueItem`, `QueueStatus`.
- Produces a reviewable batch table with CSV results export via `serializeResults(items: QueueItem[]): string` and `downloadCsv(items: QueueItem[]): void`.
- Modifies `App` to accept the test seam `initialBatchItems?: QueueItem[]`.

- [ ] **Step 1: Add a failing batch-flow test.**

```tsx
import { serializeResults } from '../features/intake/export';
const batchFixture: QueueItem[] = [{
  id: 'mismatch', file: new File(['label'], 'mismatch.png', { type: 'image/png' }), name: 'mismatch.png', size: 5,
  status: 'ready', progress: 100, result: { overallState: 'mismatch', fields: [] },
}];

it('filters a completed batch and exports the visible review data', async () => {
  const user = userEvent.setup();
  render(<App initialBatchItems={batchFixture} />);
  await user.selectOptions(screen.getByLabelText(/show/i), 'mismatch');
  expect(screen.getAllByRole('row')).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: /export results/i }));
  expect(serializeResults(batchFixture)).toContain('filename,status');
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `pnpm test:run src/App.test.tsx`
Expected: FAIL because `BatchQueue` and the export module do not exist.

- [ ] **Step 3: Implement batch review behavior.**

Expose multi-file input, optional CSV import, a visual count (`N of M processed`), status filter, searchable filename filter, error retry, and a responsive table with columns `Filename`, `Status`, `Matches`, `Mismatches`, `Needs review`, and `Action`. Rows with no CSV data must display `Application data required`, not `Match`. Implement `serializeResults(items)` with columns `filename,status,overallState,matchCount,mismatchCount,needsReviewCount,unreadableCount,error`; implement `downloadCsv(items)` by placing that string in a `Blob`, triggering an object URL download, then revoking it. Add unit tests for header order, CSV escaping, and empty queues.

- [ ] **Step 4: Run batch UI and queue tests.**

Run: `pnpm test:run src/App.test.tsx src/features/intake/queue.test.ts`
Expected: PASS for filter behavior, export schema, error retry, and two-worker queue behavior.

- [ ] **Step 5: Commit batch experience.**

```bash
git add src/components/BatchQueue.tsx src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: add batch verification workspace"
```

## Task 7: Finish visual quality, accessibility, and operational error states

**Files:**
- Modify: `src/styles.css`, `src/components/ui.tsx`, `src/components/IntakeForm.tsx`, `src/components/ReviewDesk.tsx`, `src/components/BatchQueue.tsx`, `src/App.test.tsx`

**Interfaces:**
- Preserves all contracts from prior tasks.
- Produces a recruiter-ready, responsive browser experience.

- [ ] **Step 1: Add failing tests for visible error messaging and keyboard focus.**

```tsx
const uploadFile = new File(['notes'], 'notes.txt', { type: 'text/plain' });

it('explains unsupported files without losing the current form values', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.upload(screen.getByLabelText(/label image/i), uploadFile);
  expect(screen.getByRole('alert')).toHaveTextContent(/jpeg, png, or webp/i);
});

it('keeps the primary action keyboard reachable', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.tab();
  expect(document.activeElement).toHaveAccessibleName(/skip to review/i);
});
```

- [ ] **Step 2: Run tests and confirm they fail.**

Run: `pnpm test:run src/App.test.tsx`
Expected: FAIL until alert semantics and skip link are implemented.

- [ ] **Step 3: Implement final quality states.**

Add a skip link, `aria-live="polite"` OCR and batch progress announcements, role `alert` for validation/error messages, high-contrast status chips with text labels, skeleton states during extraction, empty-state illustrations built from CSS/SVG, and reduced-motion-safe progress transitions. Confirm layouts at 320 px, 768 px, and 1440 px without horizontal page scrolling. Maintain the navy/amber/mint visual system and use red only for factual discrepancies.

- [ ] **Step 4: Run full automated verification.**

Run: `pnpm test:run && pnpm build`
Expected: all tests pass and `dist/` is created without TypeScript errors.

- [ ] **Step 5: Commit polish work.**

```bash
git add src
git commit -m "feat: polish accessible reviewer experience"
```

## Task 8: Write submission documentation and deploy the static prototype

**Files:**
- Create: `README.md`, `public/batch-template.csv`, `src/readme.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the final build command and static `dist/` output.
- Produces a recruiter-ready repository and a public static deployment.

- [ ] **Step 1: Write a failing README acceptance check.**

```ts
import { readFile } from 'node:fs/promises';

it('documents setup, limits, warning sources, and deployment', async () => {
  const readme = await readFile('README.md', 'utf8');
  expect(readme).toMatch(/pnpm install/);
  expect(readme).toMatch(/300/i);
  expect(readme).toMatch(/27 CFR Part 16/);
  expect(readme).toMatch(/deployment/i);
});
```

- [ ] **Step 2: Run the check and confirm it fails until README exists.**

Run: `pnpm test:run src/readme.test.ts`
Expected: FAIL because `README.md` and the test module are absent.

- [ ] **Step 3: Add the README, batch template, and host configuration.**

Create `src/readme.test.ts` containing the preceding check. README sections must be `What it does`, `Quick start`, `Guided demo`, `Batch CSV`, `Architecture`, `Validation behavior`, `Privacy`, `Limitations`, `Testing`, `Deployment`, and `Future Azure path`. Include the exact canonical warning source links, honest constraints (distilled spirits only; visual typography confirmation; 300 files selected, two processed at a time), and instructions for `pnpm install`, `pnpm dev`, `pnpm test:run`, and `pnpm build`.

Create `public/batch-template.csv` with this complete header and one safe illustrative row:

```csv
filename,brandName,classType,abv,proof,netContents,producerAddress,isImported,countryOfOrigin
old-tom-bourbon.svg,OLD TOM DISTILLERY,Kentucky Straight Bourbon Whiskey,45%,90,750 mL,"Old Tom Distillery, Louisville, KY",false,
```

Use the Sites build/hosting workflow to publish the `dist/` directory, then add the public URL to the README. If hosting credentials are unavailable, add exact static-host instructions and state that the build was verified locally; do not invent a URL.

- [ ] **Step 4: Run the final submission gate.**

Run: `pnpm test:run && pnpm build && git diff --check`
Expected: all tests pass, a production bundle exists, and Git reports no whitespace errors.

- [ ] **Step 5: Commit the submission package.**

```bash
git add README.md public/batch-template.csv src/readme.test.ts package.json pnpm-lock.yaml
git commit -m "docs: add Proofline submission guide"
```

## Plan Self-Review

- Spec coverage: Tasks 2–3 implement conservative compliance validation and local extraction; Tasks 4 and 6 implement 300-file batch intake and queueing; Task 5 implements the agent-led review desk; Task 7 implements error, responsive, and accessibility states; Task 8 implements deliverables and deployment.
- No unsupported automatic approval path exists; all status copy and precedence are defined in Task 2 and enforced in Task 5.
- Every identifier used by later tasks is defined in the task that produces it. The only external integration is local OCR with same-origin assets and the final static host.
