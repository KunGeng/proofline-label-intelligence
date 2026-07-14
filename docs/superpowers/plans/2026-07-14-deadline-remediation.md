# Deadline recovery remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final-review lifecycle and recovery-state gaps without weakening the five-second manual-review contract.

**Architecture:** An OCR worker-slot lease belongs to the underlying `createWorker()` attempt, not just the caller-visible extraction promise. If a deadline, abort, or initialization timeout occurs first, the extraction returns promptly but the lease stays quarantined until the factory settles and a late worker is terminated. Manual retry failures remain nonterminal recovery states: the editable workspace stays visible with an inline alert, and batch full review receives its deadline/retry context.

**Tech Stack:** React 19, TypeScript 5.7, Vitest 2, Testing Library, browser-local `tesseract.js`.

## Global Constraints

- Normal `extractFromImage` calls retain a 5,000 ms deadline; `{ deadlineMs: null }` remains the benchmark opt-out.
- The two-worker cap is strict even while a public Tesseract initialization promise is unresolved; do not add a backend, dependency, or global `Worker` interception.
- A deadline result still returns promptly and opens manual review; quarantining a resource lease must never block the caller-visible terminal result.
- Preserve manual values, deliberate blanks, provenance, visual flags, source image/file, and application data across a failed retry.
- Fresh reviews remain terminal errors when OCR fails; only a retry of an existing manual workspace remains editable with an inline alert.
- Batch deadline and retry-error messages must be visible inside the opened manual workspace, not only in the queue row.

---

### Task 1: Quarantine unresolved OCR initialization leases

**Files:**

- Modify: `src/features/extraction/ocr.ts:276-370,417-451,466-658`
- Modify: `src/features/extraction/ocr.test.ts:210-248,402-427,496-550`

**Interfaces:**

- Consumes: `WorkerFactory`, `PooledWorker`, `acquireWorker()`, `releaseWorker()`, and the existing `AbortSignal` deadline bridge.
- Produces: an internal initialization handle with `result: Promise<PooledWorker>` and a nonrejecting `settled: Promise<void>` that resolves only when the factory has settled and any late resolved worker has been terminated.

- [ ] **Step 1: Write the failing cap regression**

Replace the unsafe capacity-reuse expectation. Start two cold default-deadline extractions backed by deferred factory promises, advance exactly 5,000 ms, then start a third uncapped extraction:

```ts
const third = engine.extract(file(), vi.fn(), { deadlineMs: null });
await Promise.resolve();
expect(workerFactoryMock).toHaveBeenCalledTimes(2);
```

Resolve one late worker, assert it is terminated, wait for the third factory call, and then complete the third extraction. Add the cancellation equivalent before resolving its pending factory promise.

- [ ] **Step 2: Run the focused test and observe RED**

```sh
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" exec vitest run src/features/extraction/ocr.test.ts
```

Expected: current code calls a third factory before either late initialization settles.

- [ ] **Step 3: Expose factory-settlement cleanup**

Refactor the initializer to return:

```ts
interface WorkerInitialization {
  result: Promise<PooledWorker>;
  settled: Promise<void>;
}
```

`result` rejects immediately on caller abort or initialization timeout. `settled` remains pending until `createWorker()` settles; a late resolved worker is terminated before it resolves. A factory rejection resolves `settled` only after the public promise is known settled. Abort before factory invocation resolves `settled` immediately.

- [ ] **Step 4: Release leases from settlement in both paths**

In `extract` and `warmOneWorker`, defer only capacity reuse:

```ts
const releaseAfterInitialization = (initialization?: WorkerInitialization): void => {
  if (initialization) {
    void initialization.settled.then(releaseWorker);
    return;
  }
  releaseWorker();
};
```

Use this from each `finally`; do not delay the deadline/cancellation result, and retain successful idle-worker reuse.

- [ ] **Step 5: Verify GREEN and commit**

```sh
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" exec vitest run src/features/extraction/ocr.test.ts
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" typecheck
git add src/features/extraction/ocr.ts src/features/extraction/ocr.test.ts
git commit -m "fix: quarantine unresolved OCR initialization leases"
```

Expected: no third worker starts before late cleanup, focused tests and typecheck pass.

### Task 2: Keep manual recovery workspaces editable and contextual

**Files:**

- Modify: `src/App.tsx:181-305`
- Modify: `src/components/ReviewDesk.tsx:27-59,396-631`
- Modify: `src/components/BatchQueue.tsx:303-383`
- Modify: `src/App.test.tsx`
- Modify: `src/components/ReviewDesk.test.tsx` only if an isolated alert test is clearer.

**Interfaces:**

- Consumes: ReviewDesk `phase`, `disclosure`, `error`, `manualEvidence`, retry, and correction callbacks; queue statuses `manual_review_required`, `error`, and `extracted_pending_application`.
- Produces: a ready manual workspace with a nonterminal retry error alert; BatchFullReview derives deadline disclosure and retry error context from its queue item.

- [ ] **Step 1: Write failing single and batch UI regressions**

Add these cases:

```ts
// Single: deadline → manual edit/flag → retry resolves { error: "unreadable" }.
// Single: deadline → manual edit → retry rejects.
// Both retain the image, candidate, flags, and editor while announcing a role="alert".

// Batch: an application-backed deadline row opens with its five-second disclosure.
// After manual retry → generic error, reopening shows the preserved candidate and
// retry alert; it does not present an unqualified completed-OCR duration.
```

Keep the existing fresh-review ordinary-error test to prove only manual retries are nonterminal.

- [ ] **Step 2: Run the focused tests and observe RED**

```sh
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" exec vitest run src/App.test.tsx src/components/ReviewDesk.test.tsx
```

Expected: current code hides the single draft and omits batch deadline/retry context.

- [ ] **Step 3: Model failed manual retries as recovery notices**

In `App.tsx`, preserve `phase: 'ready'` when `preserveDraft` is true and a retry resolves with an error or rejects. Continue storing the friendly error, clearing transient progress, and use `phase: 'error'` for fresh failed reviews.

In `ReviewDesk`, render a `role="alert"` notice when `phase === 'ready' && manualEvidence && error`, explaining that the OCR retry failed while manual evidence remains editable. Keep comparison/editing controls rendered. Remove unused legacy slow-recovery props.

- [ ] **Step 4: Carry batch attempt context into full review**

In `BatchFullReview`, derive context without changing queue persistence:

```ts
const deadlineDisclosure = item.isManualEvidence && item.status === 'manual_review_required'
  ? item.error
  : undefined;
const retryError = item.isManualEvidence && item.status === 'error'
  ? item.error
  : undefined;
```

Pass `disclosure={deadlineDisclosure}` and `error={retryError}` to `ReviewDesk`; pass `durationMs` only for successful `ready` or `extracted_pending_application` attempts. Preserve the comparison result, but visibly qualify it with the recovery notice after a retry failure.

- [ ] **Step 5: Verify GREEN and commit**

```sh
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" exec vitest run src/App.test.tsx src/components/ReviewDesk.test.tsx
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" typecheck
git add src/App.tsx src/components/ReviewDesk.tsx src/components/BatchQueue.tsx src/App.test.tsx src/components/ReviewDesk.test.tsx
git commit -m "fix: retain manual evidence after OCR retry failures"
```

Expected: retry failures retain editable evidence and announce context; fresh errors remain terminal.

### Task 3: Re-review and deploy-safe verification

**Files:**

- Verify only: all remediation files and the full feature branch.

- [ ] **Step 1: Request read-only review**

Verify the strict worker cap, prompt five-second caller result, late-worker termination, single/batch editable recovery state, visible deadline/retry context, and fresh-error terminal behavior.

- [ ] **Step 2: Run complete verification**

```sh
git status --short
git diff --check a78f7c4..HEAD
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" typecheck
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" build
test -s dist/client/ocr/eng.traineddata.gz
```

Expected: clean worktree, no whitespace errors, all automated checks exit 0, and the OCR artifact exists.
