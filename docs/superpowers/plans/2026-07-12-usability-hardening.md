# Proofline usability hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the existing Proofline reviewer journeys easier to orient, complete, and recover without changing the conservative evidence-review model.

**Architecture:** Keep all behavior in the existing React client. IntakeForm owns pre-submit requirement state and focus, ReviewDesk derives guidance exclusively from the existing verification result and demo flag, and BatchQueue links the already shipped static CSV template. CSS adds small, responsive guidance primitives rather than changing layout architecture.

**Tech Stack:** React 19, TypeScript, Vitest, React Testing Library, CSS, Vite.

## Global Constraints

- Preserve the U.S. distilled-spirit prototype scope and the rule that no UI outcome is an approval.
- Do not change OCR parsing, deterministic validation, queue concurrency, or file-format limits.
- Preserve browser-local processing and existing accessible table scroll regions.
- Use the existing `pnpm test:run`, `pnpm lint`, and `pnpm build` scripts for verification.

---

### Task 1: Make single-label requirements visible and recoverable

**Files:**

- Modify: `src/components/IntakeForm.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**

- Consumes: `ApplicationData` and the existing `requiredApplicationFields` labels.
- Produces: input-level `aria-invalid` and `aria-describedby` state, plus focus on the first missing field after a submit attempt.

- [x] **Step 1: Write the failing interaction test**

~~~tsx
await user.click(screen.getByRole('button', { name: /review a label/i }));
await user.click(screen.getByRole('button', { name: /start evidence review/i }));

const brand = screen.getByRole('textbox', { name: /brand name/i });
expect(brand).toHaveAttribute('aria-invalid', 'true');
expect(brand).toHaveFocus();
expect(screen.getByText('Required fields are marked Required.')).toBeInTheDocument();
~~~

- [x] **Step 2: Run it to verify it fails**

Run: `pnpm test:run -- src/App.test.tsx`

Expected: FAIL because no input-level invalid state, focus management, or required-fields note exists.

- [x] **Step 3: Implement the minimal state and markup**

~~~tsx
const [invalidFields, setInvalidFields] = useState<RequiredFieldKey[]>([]);
const firstInvalidField = invalidFields[0];

useEffect(() => {
  if (firstInvalidField) fieldRefs.current[firstInvalidField]?.focus();
}, [firstInvalidField]);

<span className="required-indicator">Required</span>
<input aria-invalid={invalidFields.includes('brandName') || undefined}
       aria-describedby={invalidFields.includes('brandName') ? 'application-facts-error' : undefined} />
~~~

Use the same handling for imported `countryOfOrigin`; mark the file input required and add visible required copy. Clear only the edited field’s invalid state when it changes.

- [x] **Step 4: Add responsive styles and rerun the test**

Run: `pnpm test:run -- src/App.test.tsx`

Expected: PASS, including existing unsupported-image and required-field coverage.

- [x] **Step 5: Commit the focused change**

~~~bash
git add src/components/IntakeForm.tsx src/App.test.tsx src/styles.css
git commit -m "fix: improve single-label intake recovery"
~~~

### Task 2: Add review orientation without implying approval

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/components/ReviewDesk.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**

- Consumes: `VerificationResult`, `warningTypographyConfirmed`, and a new boolean `isGuidedDemo` supplied only by `App.openDemo`.
- Produces: a derived review-next panel and demo-oriented checklist; no new data persistence or validation state.

- [x] **Step 1: Write failing review-desk tests**

~~~tsx
await user.click(screen.getByRole('button', { name: /open guided demo/i }));

expect(screen.getByRole('heading', { name: /a quick way through this sample/i })).toBeInTheDocument();
expect(screen.getByRole('link', { name: /inspect the raw ocr/i })).toHaveAttribute('href', '#raw-evidence');

await user.click(screen.getByRole('checkbox', { name: /visually confirmed/i }));
expect(screen.getByRole('heading', { name: /no discrepancies detected/i })).toBeInTheDocument();
~~~

- [x] **Step 2: Run it to verify it fails**

Run: `pnpm test:run -- src/App.test.tsx`

Expected: FAIL because the demo guidance panel and raw-evidence link are absent and the result heading is still `Match`. Add a separate manual-review test for the non-demo `Next reviewer actions` heading.

- [x] **Step 3: Implement derived guidance from existing review data**

~~~tsx
const decisionTitleFor = (state: ReviewState) =>
  state === 'match' ? 'No discrepancies detected' : statusLabel(state);

<section className="review-next" aria-labelledby="review-next-heading">
  <p className="eyebrow">{isGuidedDemo ? 'Guided demo' : 'Next reviewer action'}</p>
  <h2 id="review-next-heading">{isGuidedDemo ? 'A quick way through this sample' : 'Next reviewer actions'}</h2>
  <ol>{/* links and derived outstanding field tasks */}</ol>
</section>
~~~

Give raw OCR, typography confirmation, and field comparison stable IDs. Derive outstanding tasks from `result.fields` where `state !== 'match'`; do not alter field-state precedence or validation results.

- [x] **Step 4: Style the panel and rerun the test**

Run: `pnpm test:run -- src/App.test.tsx`

Expected: PASS. The demo exposes a compact three-step orientation and a clean comparison keeps the agent-approval language.

- [x] **Step 5: Commit the focused change**

~~~bash
git add src/App.tsx src/components/ReviewDesk.tsx src/App.test.tsx src/styles.css
git commit -m "feat: guide reviewers through label evidence"
~~~

### Task 3: Put batch CSV help at the point of selection

**Files:**

- Modify: `src/components/BatchQueue.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**

- Consumes: the existing static `/batch-template.csv` asset and batch CSV parser contract.
- Produces: a non-mutating starter-template download link and exact schema aid in the CSV panel.

- [x] **Step 1: Write the failing batch setup test**

~~~tsx
await user.click(screen.getByRole('button', { name: /review a batch/i }));

expect(screen.getByRole('link', { name: /download starter csv/i }))
  .toHaveAttribute('href', '/batch-template.csv');
expect(screen.getByText(/brandName, classType, abv, netContents/i)).toBeInTheDocument();
~~~

- [x] **Step 2: Run it to verify it fails**

Run: `pnpm test:run -- src/App.test.tsx`

Expected: FAIL because the template link and exact schema aid are absent from the batch intake panel.

- [x] **Step 3: Add the CSV panel guidance**

~~~tsx
<a className="batch-template-link" href="/batch-template.csv" download>
  Download starter CSV
</a>
<p className="batch-csv-panel__schema">
  For validation, include <code>filename</code>, <code>brandName</code>, <code>classType</code>, <code>abv</code>, <code>netContents</code>, <code>producerAddress</code>, and <code>isImported</code>.
</p>
~~~

Keep the existing parser behavior and describe `proof` and `countryOfOrigin` as conditional rather than required.

- [x] **Step 4: Rerun the test**

Run: `pnpm test:run -- src/App.test.tsx`

Expected: PASS with existing CSV rejection tests still green.

- [x] **Step 5: Commit the focused change**

~~~bash
git add src/components/BatchQueue.tsx src/App.test.tsx src/styles.css
git commit -m "feat: clarify batch csv setup"
~~~

### Task 4: Verify and publish the user-tested build

**Files:**

- Modify: `docs/superpowers/specs/2026-07-12-usability-hardening-design.md`
- Modify: `docs/superpowers/plans/2026-07-12-usability-hardening.md`

**Interfaces:**

- Consumes: completed Tasks 1–3 and the existing Sites deployment configuration.
- Produces: an evidence-backed published build of the exact verified source.

- [ ] **Step 1: Run complete automated verification**

Run:

~~~bash
pnpm test:run
pnpm lint
pnpm build
git diff --check
~~~

Expected: all tests pass, TypeScript exits successfully, the static worker bundle is produced, and no whitespace errors are reported.

- [ ] **Step 2: Repeat task walkthroughs**

Check that the guided demo exposes its checklist, blank intake focuses the first missing field with a visible marker, batch CSV setup exposes the template link, and batch intake remains readable at 390 px wide.

- [ ] **Step 3: Commit and publish the exact verified source**

~~~bash
git add docs/superpowers/specs/2026-07-12-usability-hardening-design.md docs/superpowers/plans/2026-07-12-usability-hardening.md
git commit -m "docs: record usability hardening plan"
git push origin main
~~~

Package the production `dist/` output with the existing Sites helper, save a version for the pushed commit, deploy it to the established public site, and poll until deployment succeeds.
