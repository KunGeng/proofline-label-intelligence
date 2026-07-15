# Beverage Profiles, Photo Readiness, and Warning Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add bounded beer, wine, and distilled-spirits comparison profiles, local image-readiness guidance, preserved no-evidence recovery, and auditable warning-heading visual review.

**Architecture:** A central domain profile registry becomes the sole source of beverage-specific behavior. Local OCR reports an explicit outcome; the App and batch queue route a no-usable-evidence outcome to manual review. The review desk adds an evidence viewer and split human-only visual attestations that cannot override OCR text mismatches.

**Tech Stack:** React 19, TypeScript 5.7, Vite 6, Vitest 2, Testing Library, browser Canvas/ImageBitmap APIs, Tesseract.js 5.

## Global Constraints

- Support only distilled_spirits, beer, and wine; do not imply complete TTB rule coverage or legal advice.
- Keep label files, OCR, readiness inspection, image viewing, and review state in the browser. Do not add a backend, telemetry, analytics, cloud OCR, account, or persistence dependency.
- Keep OCR_DEADLINE_MS = 5,000, the global two-worker cap, and the 300-file batch cap.
- Retain manual evidence, original image/file references, and application facts on deadline and no-usable-evidence recovery.
- Boldness, uppercase rendering, legibility, contrast, placement, type size, curvature, and attachment remain human checks; OCR must never auto-pass a visual check.
- Use the exact batch-import headers beverage_type and alcohol_content_expectation; retain existing camel-case headers for the pre-existing columns.
- Use test-first development: every production behavior below begins with the listed failing test, then minimal code, then the listed focused test run.
- Run repository commands with Node 20+ and pnpm 11.12.0. The normal commands are pnpm test:run, pnpm typecheck, and pnpm build.

## File Map

| File | Responsibility |
| --- | --- |
| src/domain/beverageProfiles.ts | New profile registry, type guards, labels, proof support, and allowed alcohol-content expectations. |
| src/domain/beverageProfiles.test.ts | New profile registry and guard tests. |
| src/domain/types.ts | Beverage-aware application and review contracts. |
| src/domain/constants.ts | Field labels for alcohol-content review and split warning checks. |
| src/domain/validation.ts | Profile-aware comparisons and human-only derived warning findings. |
| src/components/IntakeForm.tsx | Beverage selector, conditional ABV/proof controls, and single-file readiness display. |
| src/features/intake/csv.ts | Strict profile import validation. |
| src/features/intake/queue.ts | Profile validation and manual recovery outcome mapping. |
| src/features/intake/export.ts | Profile columns in exported results. |
| src/features/extraction/imageReadiness.ts | New local pixel-dimension advisory. |
| src/features/extraction/ocr.ts | Explicit OCR outcomes and no-usable-evidence classification. |
| src/components/EvidenceImageViewer.tsx | New local evidence preview/zoom component. |
| src/components/ReviewDesk.tsx | Viewer integration and split warning controls. |
| src/App.tsx | Single-review outcome mapping and split review-flag state. |
| src/features/demo/cases.ts | Beer, wine, and non-bold warning fixtures. |
| README.md, docs/DESIGN.md | Honest public scope, recovery, and limitations documentation. |

---

### Task 1: Establish beverage profiles and profile-aware validation

**Files:**
- Create: src/domain/beverageProfiles.ts
- Create: src/domain/beverageProfiles.test.ts
- Modify: src/domain/types.ts:1-58
- Modify: src/domain/constants.ts:1-27
- Modify: src/domain/validation.ts:1-490
- Modify: src/domain/validation.test.ts:1-440
- Delete: src/domain/scope.ts
- Delete: src/domain/scope.test.ts

**Interfaces:**
- Produces BeverageType, AlcoholContentExpectation, BeverageProfile, BEVERAGE_PROFILES, getBeverageProfile, isBeverageType, and isAlcoholContentExpectation.
- Changes ApplicationData to require beverageType and alcoholContentExpectation while allowing abv to be absent for beer/wine manual-review rows.
- Changes ReviewFlags to warningUppercaseConfirmed, warningBoldConfirmed, and warningLegibilityConfirmed.
- Adds alcoholContentRequirement, warningUppercase, and warningBold to FieldKey; removes warningTypography.
- Adds hasVisualEvidence: boolean to ValidationInput.
- Updates every direct validateLabel invocation in src/App.test.tsx and
  src/components/BatchQueue.tsx to pass its actual visual-evidence availability.

- [ ] **Step 1: Write the failing profile and validation tests**

Create src/domain/beverageProfiles.test.ts:

~~~ts
import {
  BEVERAGE_PROFILES,
  getBeverageProfile,
  isAlcoholContentExpectation,
  isBeverageType,
} from './beverageProfiles';

it('defines the three supported beverage profiles and only spirits support proof', () => {
  expect(Object.keys(BEVERAGE_PROFILES)).toEqual([
    'distilled_spirits',
    'beer',
    'wine',
  ]);
  expect(getBeverageProfile('distilled_spirits').supportsProof).toBe(true);
  expect(getBeverageProfile('beer').supportsProof).toBe(false);
  expect(getBeverageProfile('wine').allowedAlcoholContentExpectations)
    .toEqual(['declared', 'manual_review']);
});

it('accepts only supported profile and expectation values', () => {
  expect(isBeverageType('beer')).toBe(true);
  expect(isBeverageType('cider')).toBe(false);
  expect(isAlcoholContentExpectation('manual_review')).toBe(true);
  expect(isAlcoholContentExpectation('exempt')).toBe(false);
});
~~~

Extend the validation fixture with beverageType: 'distilled_spirits',
alcoholContentExpectation: 'declared', and hasVisualEvidence: true. Add:

~~~ts
it('does not emit proof findings for a beer profile', () => {
  const result = validateLabel(fixture({}, confirmedReviewFlags, {
    beverageType: 'beer',
    classType: 'India Pale Ale',
    proof: undefined,
  }));
  expect(result.fields.map((field) => field.field)).not.toContain('proof');
  expect(result.fields.map((field) => field.field))
    .not.toContain('abvProofConsistency');
});

it('keeps beer or wine alcohol-content exceptions in human review', () => {
  const result = validateLabel(fixture({}, confirmedReviewFlags, {
    beverageType: 'wine',
    classType: 'Cabernet Sauvignon',
    alcoholContentExpectation: 'manual_review',
    abv: undefined,
    proof: undefined,
  }));
  expect(byField(result, 'alcoholContentRequirement')).toMatchObject({
    state: 'needs_review',
    observed: 'No declared ABV',
  });
});

it('does not let a confirmed visual flag pass without visual evidence', () => {
  const result = validateLabel({
    ...fixture({}, {
      warningUppercaseConfirmed: true,
      warningBoldConfirmed: true,
      warningLegibilityConfirmed: true,
    }),
    hasVisualEvidence: false,
  });
  expect(byField(result, 'warningUppercase').state).toBe('needs_review');
  expect(byField(result, 'warningBold').state).toBe('needs_review');
});
~~~

Replace generic typography assertions with independent uppercase, bold, and
legibility assertions. Verify a title-case warningHeading stays a mismatch after
all three visual flags are true.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

~~~bash
pnpm test:run -- src/domain/beverageProfiles.test.ts src/domain/validation.test.ts
~~~

Expected: the profile module is unresolved and the new profile/flag fields are
not accepted by existing types.

- [ ] **Step 3: Implement the minimal domain contract and validation branches**

Create src/domain/beverageProfiles.ts:

~~~ts
export const BEVERAGE_TYPES = ['distilled_spirits', 'beer', 'wine'] as const;
export type BeverageType = (typeof BEVERAGE_TYPES)[number];

export const ALCOHOL_CONTENT_EXPECTATIONS = ['declared', 'manual_review'] as const;
export type AlcoholContentExpectation =
  (typeof ALCOHOL_CONTENT_EXPECTATIONS)[number];

export interface BeverageProfile {
  type: BeverageType;
  label: string;
  supportsProof: boolean;
  allowedAlcoholContentExpectations: readonly AlcoholContentExpectation[];
}

export const BEVERAGE_PROFILES: Record<BeverageType, BeverageProfile> = {
  distilled_spirits: {
    type: 'distilled_spirits',
    label: 'Distilled spirits',
    supportsProof: true,
    allowedAlcoholContentExpectations: ['declared'],
  },
  beer: {
    type: 'beer',
    label: 'Beer',
    supportsProof: false,
    allowedAlcoholContentExpectations: ['declared', 'manual_review'],
  },
  wine: {
    type: 'wine',
    label: 'Wine',
    supportsProof: false,
    allowedAlcoholContentExpectations: ['declared', 'manual_review'],
  },
};

export const isBeverageType = (value: string): value is BeverageType =>
  (BEVERAGE_TYPES as readonly string[]).includes(value);

export const isAlcoholContentExpectation = (
  value: string,
): value is AlcoholContentExpectation =>
  (ALCOHOL_CONTENT_EXPECTATIONS as readonly string[]).includes(value);

export const getBeverageProfile = (type: BeverageType): BeverageProfile =>
  BEVERAGE_PROFILES[type];
~~~

Update ApplicationData:

~~~ts
export interface ApplicationData {
  beverageType: BeverageType;
  alcoholContentExpectation: AlcoholContentExpectation;
  brandName: string;
  classType: string;
  abv?: string;
  proof?: string;
  netContents: string;
  producerAddress: string;
  isImported: boolean;
  countryOfOrigin?: string;
}
~~~

Use getBeverageProfile(application.beverageType) in validateLabel. Add shared
fields for every profile. Append proof and abvProofConsistency only when
supportsProof is true. For declared alcohol content, retain numeric ABV
comparison. For manual_review, use:

~~~ts
const alcoholContentRequirementField = (candidate?: Candidate): FieldResult =>
  derivedField(
    'alcoholContentRequirement',
    'needs_review',
    'Manual alcohol-content requirement review',
    candidate?.value.trim() || 'No declared ABV',
    'This beer or wine record requires an agent to confirm whether alcohol content must appear on this label.',
    candidate?.confidence,
  );
~~~

Replace generic typography with separate uppercase and bold derived fields. Each
is a match only when its flag and hasVisualEvidence are both true. Keep
warningHeading exact and unchanged, so a visual checkbox cannot erase an OCR
heading mismatch. Remove obsolete class-type scope imports.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

~~~bash
pnpm test:run -- src/domain/beverageProfiles.test.ts src/domain/validation.test.ts
~~~

Expected: profile definitions, profile-specific proof behavior, manual ABV
review, independent visual flags, and mismatch precedence pass.

- [ ] **Step 5: Commit the domain foundation**

~~~bash
git add src/domain/beverageProfiles.ts src/domain/beverageProfiles.test.ts src/domain/types.ts src/domain/constants.ts src/domain/validation.ts src/domain/validation.test.ts src/domain/scope.ts src/domain/scope.test.ts
git commit -m "feat: add beverage-aware validation profiles"
~~~

### Task 2: Make single intake, CSV intake, queue, and export profile-aware

**Files:**
- Modify: src/components/IntakeForm.tsx:1-430
- Modify: src/components/BatchQueue.tsx:1-1020
- Modify: src/features/intake/csv.ts:1-390
- Modify: src/features/intake/csv.test.ts:1-520
- Modify: src/features/intake/queue.ts:1-560
- Modify: src/features/intake/queue.test.ts:1-620
- Modify: src/features/intake/export.ts:1-100
- Modify: src/features/intake/export.test.ts:1-220
- Modify: public/batch-template.csv:1-2
- Modify: src/components/ui.tsx:31-42
- Modify: src/App.test.tsx:1738-1958

**Interfaces:**
- Consumes BeverageType, BeverageProfile, and AlcoholContentExpectation from Task 1.
- Produces single and batch ApplicationData records with validated profile fields; filename-only batch jobs remain application: undefined.
- Adds beverageType and alcoholContentExpectation to exported result CSV rows, blank for filename-only triage.

- [ ] **Step 1: Write failing intake, CSV, queue, and export tests**

In src/App.test.tsx, add a focused helper and test:

~~~ts
const fillBeerManualReviewForm = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> => {
  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.selectOptions(screen.getByLabelText(/beverage type/i), 'beer');
  await user.selectOptions(
    screen.getByLabelText(/alcohol content expectation/i),
    'manual_review',
  );
  await user.type(screen.getByRole('textbox', { name: /^brand name$/i }), 'HOP FIELD');
  await user.type(screen.getByRole('textbox', { name: /class\/type/i }), 'India Pale Ale');
  await user.type(screen.getByRole('textbox', { name: /net contents/i }), '355 mL');
  await user.type(screen.getByRole('textbox', { name: /producer address/i }), 'Hop Field, OR');
  await user.upload(
    screen.getByLabelText(/^choose label image$/i),
    new File(['label'], 'hop-field.png', { type: 'image/png' }),
  );
  return screen.getByRole('button', { name: /start evidence review/i });
};

it('submits a beer manual-review record without proof or declared ABV', async () => {
  const user = userEvent.setup();
  const submit = await fillBeerManualReviewForm(user);
  expect(screen.queryByLabelText(/^proof/i)).not.toBeInTheDocument();
  await user.click(submit);
  expect(extractFromImage).toHaveBeenCalledWith(
    expect.any(File),
    expect.any(Function),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
~~~

In src/features/intake/csv.test.ts:

~~~ts
const header =
  'filename,brandName,classType,beverage_type,alcohol_content_expectation,abv,proof,netContents,producerAddress,isImported,countryOfOrigin';

it('accepts a wine manual-review row without declared ABV', () => {
  const result = parseBatchCsv(
    header + '\n' +
      'wine.png,ESTATE RED,Cabernet Sauvignon,wine,manual_review,,,750 mL,Example Winery CA,false,',
    [file('wine.png')],
  );
  expect(result.errors).toEqual([]);
  expect(result.matched[0]?.application).toMatchObject({
    beverageType: 'wine',
    alcoholContentExpectation: 'manual_review',
    abv: undefined,
  });
});

it('rejects beer proof', () => {
  const result = parseBatchCsv(
    header + '\n' +
      'beer.png,HOP FIELD,India Pale Ale,beer,declared,6.2%,12 Proof,355 mL,Example Brewing OR,false,',
    [file('beer.png')],
  );
  expect(result.errors).toContain(
    'Row 2: proof is supported only for distilled_spirits.',
  );
});
~~~

Add tests for missing/invalid beverage_type, missing/invalid
alcohol_content_expectation, spirits with manual_review, declared beer/wine with
blank ABV, and profile data surviving queue deadline/retry. Add export assertions
for profile values and blanks on filename-only rows.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

~~~bash
pnpm test:run -- src/App.test.tsx src/features/intake/csv.test.ts src/features/intake/queue.test.ts src/features/intake/export.test.ts
~~~

Expected: form has no beverage selector, CSV rejects new headers, and export
omits profile values.

- [ ] **Step 3: Implement profile-aware intake and batch propagation**

In IntakeForm:

- Initialize beverageType as distilled_spirits and alcoholContentExpectation as declared.
- Add an accessible beverage select using BEVERAGE_TYPES and getBeverageProfile.
- When switching to beer or wine, clear proof, hide its input, and show alcohol-content-expectation. When switching back to distilled spirits, force declared.
- Require and format-check ABV only when expectation is declared.
- Preserve import-origin and source-image checks.

Use:

~~~ts
const updateBeverageType = (beverageType: BeverageType): void => {
  const profile = getBeverageProfile(beverageType);
  setApplication((current) => ({
    ...current,
    beverageType,
    proof: profile.supportsProof ? current.proof : undefined,
    alcoholContentExpectation: profile.supportsProof
      ? 'declared'
      : current.alcoholContentExpectation,
  }));
  setFormatErrors([]);
};
~~~

In csv.ts, replace the header array:

~~~ts
const CSV_HEADERS = [
  'filename',
  'brandName',
  'classType',
  'beverage_type',
  'alcohol_content_expectation',
  'abv',
  'proof',
  'netContents',
  'producerAddress',
  'isImported',
  'countryOfOrigin',
] as const;
~~~

Require both new headers with application data. In applicationForRow, validate
profile and expectation with Task 1 guards; require parseable abv only for
declared; reject manual_review for distilled spirits; reject nonblank proof when
the profile does not support proof. Do not infer profile from class/type.

QueueJob and QueueItem already retain application. Update default review flags
to Task 1 fields, pass hasVisualEvidence: Boolean(item.thumbnailUrl) into queue
validation, and leave filename-only jobs without application. Add beverageType
and alcoholContentExpectation immediately after filename in result CSV output;
use empty cells for triage-only rows. Replace scope notice with three-profile
scope and human-rule-exception boundary.

- [ ] **Step 4: Run focused tests and verify they pass**

Run:

~~~bash
pnpm test:run -- src/App.test.tsx src/features/intake/csv.test.ts src/features/intake/queue.test.ts src/features/intake/export.test.ts
~~~

Expected: beer/wine paths succeed, invalid profile rows show line-numbered
errors, queue rows retain profiles, and export preserves them.

- [ ] **Step 5: Commit profile-aware intake**

~~~bash
git add src/components/IntakeForm.tsx src/components/BatchQueue.tsx src/components/ui.tsx src/features/intake/csv.ts src/features/intake/csv.test.ts src/features/intake/queue.ts src/features/intake/queue.test.ts src/features/intake/export.ts src/features/intake/export.test.ts public/batch-template.csv src/App.test.tsx
git commit -m "feat: support beer wine and spirits intake profiles"
~~~

### Task 3: Add local photo-readiness guidance for single and batch selection

**Files:**
- Create: src/features/extraction/imageReadiness.ts
- Create: src/features/extraction/imageReadiness.test.ts
- Modify: src/features/extraction/ocr.ts:11-14
- Modify: src/components/IntakeForm.tsx:17-131,380-420
- Modify: src/components/BatchQueue.tsx:42-155,531-561,840-930
- Modify: src/App.test.tsx
- Modify: src/styles.css:597-860

**Interfaces:**
- Produces ImageDimensions, ImageReadinessIssue, ImageReadiness, classifyImageReadiness, and inspectImageReadiness.
- Centralizes JPEG/PNG/WebP, 10 MB, and minimum-longest-edge policy. Type/size remain blocking upload errors; a small decoded image is advisory only.

- [ ] **Step 1: Write failing readiness tests**

Create src/features/extraction/imageReadiness.test.ts:

~~~ts
import {
  MIN_RECOMMENDED_LONGEST_EDGE,
  classifyImageReadiness,
} from './imageReadiness';

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
~~~

Add UI tests proving advisory copy says a straight-on, evenly lit, glare-free
retake may improve OCR and leaves review enabled. Add a batch test that reports
the count needing a retake without rejecting valid files. Put both UI tests in
src/App.test.tsx because BatchQueue is rendered through App.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

~~~bash
pnpm test:run -- src/features/extraction/imageReadiness.test.ts src/App.test.tsx
~~~

Expected: readiness module and advisory UI do not exist.

- [ ] **Step 3: Implement deterministic local readiness inspection**

Create imageReadiness.ts:

~~~ts
export const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MIN_RECOMMENDED_LONGEST_EDGE = 1_000;

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
~~~

classifyImageReadiness returns existing type/size errors first. If a valid
selection cannot be decoded for dimensions, return advisory decode-failed. If
longest edge is below MIN_RECOMMENDED_LONGEST_EDGE, return advisory
insufficient-pixels. inspectImageReadiness uses createImageBitmap with
imageOrientation: 'from-image', falls back to object-URL Image, and closes or
revokes resources.

Import accepted-type and size constants into ocr.ts as well, so the OCR preparer
and both intake paths use one source of truth. Replace duplicated constants in
IntakeForm and BatchQueue. In chooseFile, use a
monotonically increasing request token so late decode cannot overwrite newer
file readiness. Display advisory under file name; it is not a form error. In
batch selection, inspect accepted files asynchronously and show the same cautious
count/copy. Do not add blur/glare detection, contrast modification, deskew, or
image rewriting.

- [ ] **Step 4: Run focused tests and verify they pass**

Run:

~~~bash
pnpm test:run -- src/features/extraction/imageReadiness.test.ts src/App.test.tsx
~~~

Expected: type/size errors remain blocking, small images produce advisory, and
both intake modes permit continued review.

- [ ] **Step 5: Commit local readiness guidance**

~~~bash
git add src/features/extraction/imageReadiness.ts src/features/extraction/imageReadiness.test.ts src/components/IntakeForm.tsx src/components/BatchQueue.tsx src/App.test.tsx src/styles.css
git commit -m "feat: add local label image readiness guidance"
~~~

### Task 4: Classify OCR no-evidence results and preserve them for manual review

**Files:**
- Modify: src/features/extraction/types.ts:1-61
- Modify: src/features/extraction/ocr.ts:194-227,532-729
- Modify: src/features/extraction/ocr.test.ts
- Modify: src/App.tsx:45-305
- Modify: src/App.test.tsx:1139-1468,1962-2025
- Modify: src/features/intake/queue.ts:31-360
- Modify: src/features/intake/queue.test.ts:235-390
- Modify: src/components/BatchQueue.tsx:280-410

**Interfaces:**
- Produces required ExtractionOutcome on every ExtractionJobResult: completed, no-usable-evidence, deadline-exceeded, cancelled, or error.
- Produces hasUsableExtraction(extraction) inside OCR logic.
- Consumes Task 1 profile-aware application records without changing worker limits.

- [ ] **Step 1: Write failing OCR and recovery tests**

In ocr.test.ts, add blank and nonblank-unparseable recognition fixtures. Assert:

~~~ts
expect(result).toMatchObject({
  outcome: 'no-usable-evidence',
  rawText: 'decorative strokes only',
  thumbnailUrl: expect.any(String),
  durationMs: undefined,
});
~~~

In App.test.tsx, mock no-usable-evidence and assert focused disclosure, original
preview, Manual evidence entry, Retry OCR, cautious retake wording, and no timing
text. Add matching queue test, asserting manual_review_required, retained
file/application/raw text/thumbnail, no result, and no duration. Keep decode and
worker error test asserting outcome error remains on error path.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

~~~bash
pnpm test:run -- src/features/extraction/ocr.test.ts src/App.test.tsx src/features/intake/queue.test.ts
~~~

Expected: result objects lack outcome, empty recognition appears as ordinary
success, and only deadline maps to manual review.

- [ ] **Step 3: Implement explicit outcome handling**

Replace result contract:

~~~ts
export type ExtractionOutcome =
  | 'completed'
  | 'no-usable-evidence'
  | 'deadline-exceeded'
  | 'cancelled'
  | 'error';

export interface ExtractionJobResult {
  outcome: ExtractionOutcome;
  extraction: LabelExtraction;
  rawText: string;
  thumbnailUrl?: string;
  error?: string;
  source: 'ocr' | 'fixture';
  durationMs?: number;
  timings?: ExtractionTimings;
}
~~~

Update every production result constructor and test mock. After recognition:

~~~ts
const extraction = extractFromText(rawText, confidenceFor);
const hasUsableExtraction = Object.values(extraction).some(
  (candidate) => Boolean(candidate?.value.trim()),
);
if (!rawText.trim() || !hasUsableExtraction) {
  completed = true;
  return {
    outcome: 'no-usable-evidence',
    extraction,
    rawText,
    thumbnailUrl,
    source: 'ocr',
  };
}
~~~

Completed results retain timing. Deadline/cancellation use their named outcomes.
Decode, worker, and input failures use outcome error with current human-readable
error.

In App:

~~~ts
const isManualRecoveryOutcome = (outcome: ExtractionOutcome): boolean =>
  outcome === 'deadline-exceeded' || outcome === 'no-usable-evidence';
~~~

Use existing disclosure for deadline. For no evidence use: "No usable OCR evidence
was produced. Inspect the original label, enter manual evidence, retry OCR, or
retake a straight-on, evenly lit, glare-free photo." Retain raw text, preview,
file, application, manual locks, and extraction; clear duration. In queue, use
same predicate before generic error mapping and store duration only for completed.

- [ ] **Step 4: Run focused tests and verify they pass**

Run:

~~~bash
pnpm test:run -- src/features/extraction/ocr.test.ts src/App.test.tsx src/features/intake/queue.test.ts
~~~

Expected: blank/unparseable OCR is recoverable manual work, true failures remain
errors, and recovery preserves evidence without timing.

- [ ] **Step 5: Commit recovery behavior**

~~~bash
git add src/features/extraction/types.ts src/features/extraction/ocr.ts src/features/extraction/ocr.test.ts src/App.tsx src/App.test.tsx src/features/intake/queue.ts src/features/intake/queue.test.ts src/components/BatchQueue.tsx
git commit -m "feat: preserve labels with no usable OCR evidence"
~~~

### Task 5: Add local evidence viewer and split warning visual review

**Files:**
- Create: src/components/EvidenceImageViewer.tsx
- Create: src/components/EvidenceImageViewer.test.tsx
- Modify: src/components/ReviewDesk.tsx:1-650
- Modify: src/components/ReviewDesk.test.tsx:1-80
- Modify: src/App.tsx:70-110,373-414
- Modify: src/components/BatchQueue.tsx:280-410
- Modify: src/styles.css:1191-1356
- Modify: src/App.test.tsx:70-100,1060-1450

**Interfaces:**
- Produces EvidenceImageViewer with src, alt, imageClassName, and fixture props.
- Consumes Task 1 three ReviewFlags and ValidationInput.hasVisualEvidence.
- Ensures warningUppercase, warningBold, and warningLegibility are independent human-controlled findings.

- [ ] **Step 1: Write failing viewer and review-desk tests**

Create EvidenceImageViewer.test.tsx:

~~~tsx
render(<EvidenceImageViewer src="blob:label" alt="Label evidence: sample" />);
await user.click(screen.getByRole('button', {
  name: /open full-size label evidence/i,
}));
await user.click(screen.getByRole('button', { name: /zoom in/i }));
expect(screen.getByRole('img', { name: /label evidence: sample/i }))
  .toHaveStyle({ transform: 'scale(1.25)' });
await user.click(screen.getByRole('button', { name: /reset zoom/i }));
expect(screen.getByRole('img', { name: /label evidence: sample/i }))
  .toHaveStyle({ transform: 'scale(1)' });
~~~

Extend ReviewDesk.test.tsx:

~~~ts
expect(screen.getByRole('checkbox', {
  name: /printed heading is uppercase/i,
})).toBeDisabled();
expect(screen.getByRole('checkbox', {
  name: /government warning is bold/i,
})).toBeDisabled();
expect(screen.getByText(/visual evidence is unavailable/i)).toBeInTheDocument();
~~~

In App.test.tsx, verify three controls can be checked independently with image
preview and a title-case heading remains Mismatch after all are checked. Add a
batch full-review test: check boldness, exit, reopen, and find it still checked.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

~~~bash
pnpm test:run -- src/components/EvidenceImageViewer.test.tsx src/components/ReviewDesk.test.tsx src/App.test.tsx
~~~

Expected: viewer module is missing, combined typography remains, and no-preview
controls are interactive.

- [ ] **Step 3: Implement viewer and independent human attestations**

EvidenceImageViewer renders existing image URL or fixture; it never calls fetch,
creates a new file, or changes source pixels. Expose Open full-size label
evidence, Zoom in, Zoom out, and Reset zoom. Store zoom from 1 to 3 in 0.25
increments and apply:

~~~tsx
style={{ transform: 'scale(' + zoom + ')' }}
~~~

Return focus to opener when expanded view closes.

In ReviewDesk:

- replace inline preview with EvidenceImageViewer;
- compute hasVisualEvidence from imageUrl or evidencePreview;
- map targets to uppercase-confirmation, bold-confirmation, and legibility-confirmation;
- replace combined props with warningUppercaseConfirmed,
  onWarningUppercaseConfirmed, warningBoldConfirmed, and onWarningBoldConfirmed;
- render exact labels:
  - "I visually confirmed the printed heading is uppercase."
  - "I visually confirmed GOVERNMENT WARNING is bold and the remaining warning text is not bold."
  - existing legibility/contrast/placement wording;
- disable all three and show "Visual evidence is unavailable, so this
  confirmation cannot be completed." when no preview exists.

Update App and BatchQueue flag state/defaults/callbacks and call validateLabel
with same visual-evidence predicate. Add CSS for expanded evidence pane,
scrollable full-size image, focus-visible controls, and disabled confirmations.

- [ ] **Step 4: Run focused tests and verify they pass**

Run:

~~~bash
pnpm test:run -- src/components/EvidenceImageViewer.test.tsx src/components/ReviewDesk.test.tsx src/App.test.tsx
~~~

Expected: zoom is local/resettable, no-preview controls cannot pass, split flags
persist in batch review, and visual checks never override heading mismatch.

- [ ] **Step 5: Commit evidence review UX**

~~~bash
git add src/components/EvidenceImageViewer.tsx src/components/EvidenceImageViewer.test.tsx src/components/ReviewDesk.tsx src/components/ReviewDesk.test.tsx src/App.tsx src/components/BatchQueue.tsx src/styles.css src/App.test.tsx
git commit -m "feat: strengthen warning visual evidence review"
~~~

### Task 6: Make demos, parser, docs, and release verification prove the experience

**Files:**
- Modify: src/features/extraction/types.ts:39-60
- Modify: src/features/extraction/parser.ts:1-190
- Modify: src/features/extraction/parser.test.ts:1-300
- Modify: src/features/demo/cases.ts:1-180
- Modify: src/components/DemoLabelFixture.tsx:1-24
- Modify: src/components/Landing.tsx:101-121
- Modify: README.md
- Modify: docs/DESIGN.md
- Modify: src/readme.test.ts

**Interfaces:**
- Extends DemoCaseId and DemoFixtureVariant with beer, wine, and non-bold-warning scenarios.
- Makes fixture content ABV optional and heading presentation explicit.

- [ ] **Step 1: Write failing demo, parser, and documentation tests**

Add parser tests:

~~~ts
expect(extractFromText(
  'HOP FIELD\nIndia Pale Ale\n6.2% Alc./Vol.\n355 mL\nBrewed by Hop Field, OR',
  0.99,
).classType?.value).toBe('India Pale Ale');

expect(extractFromText(
  'ESTATE RED\nCabernet Sauvignon\n750 mL\nProduced by Estate Winery, CA',
  0.99,
).classType?.value).toBe('Cabernet Sauvignon');
~~~

Assert scenario library contains Hop Field / beer profile and Estate Red / wine
profile, each labels itself as fixture evidence, and a non-bold fixture leaves
bold pending. Update readme.test.ts:

~~~ts
expect(readme).toMatch(/distilled spirits, beer, and wine/i);
expect(readme).toMatch(/beverage_type/i);
expect(readme).toMatch(/alcohol_content_expectation/i);
expect(readme).toMatch(/no usable OCR evidence/i);
expect(readme).toMatch(/never auto-pass.*bold/i);
~~~

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

~~~bash
pnpm test:run -- src/features/extraction/parser.test.ts src/App.test.tsx src/readme.test.ts
~~~

Expected: parser patterns, demo unions, and docs do not cover the new profile
experience.

- [ ] **Step 3: Implement fixture-backed demonstrations and honest docs**

Extend class/type parser patterns with India Pale Ale, Pale Ale, Lager, Stout,
Porter, Cabernet Sauvignon, Chardonnay, Merlot, Pinot Noir, and Sauvignon Blanc.
Preserve spirits patterns and confidence behavior.

Add beer fixture with beverageType beer, declared alcohol content, India Pale Ale,
and 6.2% ABV. Add wine fixture with beverageType wine, manual_review alcohol
content, Cabernet Sauvignon, and no declared ABV. Add non-bold warning fixture
with literal uppercase heading but no strong element. All fixtures retain explicit
precomputed-evidence disclosures. Make DemoLabelFixture use
warningHeadingBold: boolean, not case alone, to choose strong element. Update
Landing wording to say "ABV and, for distilled spirits, proof".

Update README and DESIGN to state three profiles, exact CSV fields, advisory
readiness, no-usable-evidence recovery, local evidence zoom, and independent
uppercase/bold/legibility checks. State the app does not prove glare, deskew,
contrast, type size, boldness, or full legal compliance.

- [ ] **Step 4: Run complete verification**

Run:

~~~bash
pnpm test:run
pnpm typecheck
pnpm build
git diff --check
~~~

Expected: tests pass, TypeScript has no errors, production bundle builds, and no
whitespace errors are reported.

After deployment, smoke-test:

1. Open production URL and select beer and wine guided scenarios.
2. Start one live local review and confirm no image/application request leaves the origin.
3. Exercise no-usable-evidence and confirm manual evidence, retry, and no success timing.
4. Download batch template, upload one profile-backed row, and export result CSV.
5. Open viewer, zoom/reset, and confirm split warning controls remain human-only.

- [ ] **Step 5: Commit documentation and release-ready changes**

~~~bash
git add src/features/extraction/types.ts src/features/extraction/parser.ts src/features/extraction/parser.test.ts src/features/demo/cases.ts src/components/DemoLabelFixture.tsx src/components/Landing.tsx README.md docs/DESIGN.md src/readme.test.ts src/App.test.tsx
git commit -m "docs: document beverage profiles and evidence recovery"
~~~
