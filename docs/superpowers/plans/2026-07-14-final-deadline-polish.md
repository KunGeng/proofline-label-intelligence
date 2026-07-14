# Final deadline polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` task-by-task. Each task must be implemented test-first and independently reviewed before the next task begins.

**Goal:** Resolve the final review's remaining correctness and documentation gaps without weakening the five-second manual-review contract.

**Architecture:** A late worker that fails to terminate remains quarantined; its slot cannot be reused until termination succeeds. A manual OCR retry is a single active operation: it becomes unavailable while processing and the state handler independently rejects duplicate invocations. Product documentation distinguishes successfully completed OCR timing from incomplete attempts, while historical design records explicitly identify superseded deadline behavior.

**Tech Stack:** React 19, TypeScript 5.7, Vitest 2, Testing Library, browser-local `tesseract.js`.

## Global constraints

- Preserve prompt caller-visible deadline/cancellation results even when cleanup continues in the background.
- Preserve the strict two-worker cap; do not release a late worker lease after a failed termination.
- Do not change benchmark opt-out behavior (`deadlineMs: null`) or add remote processing.
- Preserve manual evidence, deliberate blanks, provenance, review flags, source image, file, and application data through retry behavior.
- Keep retry controls accessible: unavailable while processing and available again only after a terminal recovery state.
- Keep the old evidence-hardening proposal as historical context, but clearly identify it as non-current rather than silently treating its 5/15-second recovery proposal as live behavior.

---

### Task 1: Preserve the worker cap after late termination failure

**Files:**

- Modify: `src/features/extraction/ocr.ts`
- Modify: `src/features/extraction/ocr.test.ts`

**Interfaces:**

- Consumes: `WorkerInitialization.settled`, worker-slot acquisition/release, and the existing late-initialization cleanup path.
- Produces: a settled initialization lease only after a late worker terminates successfully; a failed late termination stays quarantined.

- [ ] **Step 1: Add an isolated RED regression**

Use a fresh dynamically imported OCR module so a deliberately quarantined lease cannot pollute suite-wide worker state. Start two factory-backed extractions, let one hit its five-second deadline, then resolve that late worker with `terminate()` rejecting. Start an uncapped third extraction and assert its factory never starts while the deadline caller has already received `deadline-exceeded`.

- [ ] **Step 2: Make late cleanup report termination success**

Retain normal fire-and-forget retirement semantics, but let the late-initialization path distinguish successful termination from a rejection. Resolve its `settled` promise only after success; failed late termination leaves the slot quarantined.

- [ ] **Step 3: Verify and commit**

```sh
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" exec vitest run src/features/extraction/ocr.test.ts
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" typecheck
git add src/features/extraction/ocr.ts src/features/extraction/ocr.test.ts
git commit -m "fix: retain OCR lease after late termination failure"
```

### Task 2: Make manual OCR retry idempotent

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/components/ReviewDesk.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**

- Consumes: manual `ReviewState`, `extractionAbort`, `ReviewDesk.phase`, and the retry callback.
- Produces: a native disabled retry control during processing and a handler-level duplicate-run guard.

- [ ] **Step 1: Add a RED deferred-retry UI regression**

Drive a deadline result into manual review, make its retry deferred, click once, and assert the retry control is disabled, the second click cannot start a third extraction, and the retry signal was not aborted. Resolve the retry to another deadline and confirm retry becomes available again with the manual disclosure focused.

- [ ] **Step 2: Gate both presentation and handler**

Disable the native button unless the manual workspace is ready. Independently reject a retry when no manual ready workspace exists or an extraction controller is already active, so rapid event delivery cannot cancel/restart work before React commits state.

- [ ] **Step 3: Verify and commit**

```sh
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" exec vitest run src/App.test.tsx src/components/ReviewDesk.test.tsx
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" typecheck
git add src/App.tsx src/components/ReviewDesk.tsx src/App.test.tsx
git commit -m "fix: prevent duplicate manual OCR retries"
```

### Task 3: Make timing and history documentation truthful

**Files:**

- Modify: `README.md`
- Modify: `docs/DESIGN.md`
- Modify: `docs/superpowers/specs/2026-07-13-evidence-hardening-design.md`
- Modify: `src/readme.test.ts`

**Interfaces:**

- Consumes: existing documentation contract test and current deadline design.
- Produces: success-only timing language in live product documents and an explicit historical/superseded status for the old recovery proposal.

- [ ] **Step 1: Add a RED documentation contract**

Require both live documents to say that completed-OCR duration appears only after successful OCR, and require the historical evidence-hardening design to identify the five-second deadline design as its current replacement. Continue rejecting obsolete 5/15-second recovery language in live documents.

- [ ] **Step 2: Align the prose**

Replace broad "every review"/"per label" timing claims with precise success-only wording. Mark the old evidence-hardening design historical at its start and link to the successor, preserving it as an auditable original proposal.

- [ ] **Step 3: Verify and commit**

```sh
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" exec vitest run src/readme.test.ts
git add README.md docs/DESIGN.md docs/superpowers/specs/2026-07-13-evidence-hardening-design.md src/readme.test.ts
git commit -m "docs: clarify OCR timing and historical recovery design"
```

### Task 4: Re-review and verify the feature branch

- [ ] **Step 1: Request a fresh independent whole-branch review**

Review worker-cap safety, prompt deadline behavior, retry idempotence, accessibility, recovery state preservation, and documentation truthfulness. Repair every Critical or Important finding and re-review after each repair.

- [ ] **Step 2: Run final verification**

```sh
git status --short
git diff --check a78f7c4..HEAD
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" test:run
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" typecheck
PATH="$RUNTIME_NODE:$PATH" "$RUNTIME_NODE/node" "$PNPM_MJS" build
test -s dist/client/ocr/eng.traineddata.gz
```

- [ ] **Step 3: Re-run concise browser smoke checks**

Confirm the local production preview loads without browser-console errors, the guided fixture remains labeled as precomputed, and the benchmark remains explicitly user-triggered.
