# Submission Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Cancel and release local OCR correctly, repair final keyboard-review gaps, and publish the verified commit to Amplify.

**Architecture:** Queue clear passes an abort signal to the existing extractor; its proven cancellation path retires active workers. The default engine exposes a separate idle-pool release operation for successful workers. The UI improvements reuse current focus conventions and add semantic reachability to the zoom scrollport.

**Tech Stack:** React 19, TypeScript 5.7, Vitest 2, Testing Library, Tesseract.js 5, Vite 6, pnpm 11.12.0, AWS Amplify static hosting.

## Global Constraints

- Keep all images, OCR, label facts, and review state in the browser; add no backend, cloud OCR, telemetry, analytics, persistence, or dependency.
- Retain a maximum of two OCR workers, a 300-file batch cap, and OCR_DEADLINE_MS = 5_000.
- Do not raw-terminate active workers from UI code; abort through the extractor before releasing idle workers.
- Keep manual-recovery disclosure focus as the priority over ordinary result-heading focus.
- Use test-first development and run each listed focused test red before production code, then green afterward.
- Before publishing, run pnpm test:run, pnpm typecheck, pnpm build, git diff --check, and a public smoke test.

## File Map

| File | Responsibility |
| --- | --- |
| src/features/extraction/ocr.ts | Default-engine idle-worker release API. |
| src/features/extraction/ocr.test.ts | Pool-release regression coverage. |
| src/features/intake/queue.ts | Per-item abort signals and adapter propagation. |
| src/features/intake/queue.test.ts | Queue-clear cancellation regression coverage. |
| src/components/BatchQueue.tsx | Release local OCR workers at batch-generation boundaries. |
| src/components/EvidenceImageViewer.tsx | Focusable named zoomed-image scroll region. |
| src/components/EvidenceImageViewer.test.tsx | Keyboard viewport coverage. |
| src/App.tsx | Live-review result-heading focus and review-exit release. |
| src/App.test.tsx | Normal completion focus coverage. |
| src/styles.css | Visible focus treatment for the viewport. |

---

### Task 1: Cancel active OCR and release idle workers

**Files:**
- Modify: src/features/extraction/ocr.ts, src/features/extraction/ocr.test.ts
- Modify: src/features/intake/queue.ts, src/features/intake/queue.test.ts
- Modify: src/components/BatchQueue.tsx, src/App.tsx

**Interfaces:**
- OcrEngine provides releaseIdleWorkers(): Promise<void>.
- releaseOcrWorkers(): Promise<void> releases the default engine's idle pool.
- QueueWorker accepts optional third argument signal?: AbortSignal.

- [ ] **Step 1: Write the failing pool-release test**

~~~ts
it('releases a completed idle worker and uses a fresh worker afterward', async () => {
  const first = workerWithCompletedText('OLD TOM 45%');
  const second = workerWithCompletedText('OLD TOM 45%');
  const factory = vi
    .fn()
    .mockResolvedValueOnce(first.worker)
    .mockResolvedValueOnce(second.worker);
  const engine = createOcrEngine({
    createWorker: factory as unknown as WorkerFactory,
    prepareImage: preparedImage,
  });

  await engine.extract(labelFile(), noopProgress);
  await engine.releaseIdleWorkers();
  await engine.extract(labelFile(), noopProgress);

  expect(first.terminate).toHaveBeenCalledTimes(1);
  expect(factory).toHaveBeenCalledTimes(2);
});
~~~

- [ ] **Step 2: Verify the test is red**

Run: pnpm test:run -- src/features/extraction/ocr.test.ts

Expected: FAIL because releaseIdleWorkers does not exist.

- [ ] **Step 3: Implement idle-pool release only**

Add releaseIdleWorkers() to OcrEngine and implement it inside createOcrEngine by
taking const workers = idleWorkers.splice(0) and awaiting
Promise.all(workers.map(retireWorker)). Export:

~~~ts
export const releaseOcrWorkers = (): Promise<void> =>
  defaultEngine.releaseIdleWorkers();
~~~

Do not terminate active workers in this operation; their existing abort path
owns that lifecycle.

- [ ] **Step 4: Verify the pool-release test is green**

Run: pnpm test:run -- src/features/extraction/ocr.test.ts

Expected: PASS, including existing active-recognition abort tests.

- [ ] **Step 5: Write the failing queue-clear cancellation test**

~~~ts
it('aborts an active extractor when the queue is cleared', async () => {
  const started = deferred<void>();
  const completion = deferred<ExtractionJobResult>();
  let signal: AbortSignal | undefined;
  const queue = createReviewQueue(
    [job('clear.png')],
    async (_job, _report, workerSignal) => {
      signal = workerSignal;
      started.resolve();
      return completion.promise;
    },
    1,
  );

  void queue.start();
  await started.promise;
  queue.clear();

  expect(signal?.aborted).toBe(true);
  completion.resolve(completedOutput());
});
~~~

- [ ] **Step 6: Verify the queue test is red**

Run: pnpm test:run -- src/features/intake/queue.test.ts

Expected: FAIL because QueueWorker does not receive an abort signal.

- [ ] **Step 7: Propagate cancellation and release at view boundaries**

Create an AbortController for each run in createReviewQueue, store it by item,
pass its signal to the worker, abort every stored controller at the start of
clear(), and remove it in finally. Update the extractor adapter:

~~~ts
extract(job.file, ({ phase, value }) => report(value, phase), { signal });
~~~

In BatchQueue, import releaseOcrWorkers() and call it after
generation.queue.clear() in retireActiveGeneration. In App, call it when
leaving a review before prewarming a new workspace and during unmount cleanup.

- [ ] **Step 8: Verify privacy behavior and commit**

Run: pnpm test:run -- src/features/extraction/ocr.test.ts src/features/intake/queue.test.ts src/App.test.tsx

Expected: PASS. Commit:

~~~bash
git add src/features/extraction/ocr.ts src/features/extraction/ocr.test.ts src/features/intake/queue.ts src/features/intake/queue.test.ts src/components/BatchQueue.tsx src/App.tsx
git commit -m "fix: release local OCR workers on clear"
~~~

### Task 2: Repair keyboard review flow

**Files:**
- Modify: src/components/EvidenceImageViewer.tsx, src/components/EvidenceImageViewer.test.tsx, src/styles.css
- Modify: src/App.tsx, src/App.test.tsx

**Interfaces:**
- The expanded viewer exposes role="region", tabIndex={0}, and the accessible name Zoomed label evidence.
- Ordinary completed live review state has shouldFocusReviewHeading: true.

- [ ] **Step 1: Write the failing zoomed-viewport test**

~~~tsx
it('exposes the zoomed evidence viewport as a focusable named region', async () => {
  const user = userEvent.setup();
  render(<EvidenceImageViewer src="blob:label" alt="Label evidence" />);
  fireEvent.load(screen.getByRole('img', { name: 'Label evidence' }));
  await user.click(screen.getByRole('button', { name: /open full-size label evidence/i }));

  const viewport = screen.getByRole('region', { name: /zoomed label evidence/i });
  expect(viewport).toHaveAttribute('tabindex', '0');
  viewport.focus();
  expect(viewport).toHaveFocus();
});
~~~

- [ ] **Step 2: Verify the viewer test is red**

Run: pnpm test:run -- src/components/EvidenceImageViewer.test.tsx

Expected: FAIL because the overflow scrollport has no tab stop or accessible name.

- [ ] **Step 3: Implement the focusable scrollport**

Keep evidence-image-viewer__full-size, add role="region",
aria-label="Zoomed label evidence. Use arrow keys to pan the image.", and
tabIndex={0}. Add a visible :focus-visible outline in src/styles.css.

- [ ] **Step 4: Write and verify the failing result-focus test**

Add a normal mocked single-label completion test to src/App.test.tsx that
focuses the Review label submit control, waits for the review heading, and
expects it to have focus. Run pnpm test:run -- src/App.test.tsx; it must fail
because normal completion leaves the heading-focus flag unset.

- [ ] **Step 5: Implement normal completion focus**

Reset shouldFocusReviewHeading when a new extraction/retry begins. Set it to
true only on an ordinary completed live result. Keep it false for errors and
manual recovery so the existing manual-disclosure focus effect remains intact.

- [ ] **Step 6: Verify accessibility behavior and commit**

Run: pnpm test:run -- src/components/EvidenceImageViewer.test.tsx src/App.test.tsx

Expected: PASS. Commit:

~~~bash
git add src/components/EvidenceImageViewer.tsx src/components/EvidenceImageViewer.test.tsx src/styles.css src/App.tsx src/App.test.tsx
git commit -m "fix: improve keyboard review navigation"
~~~

### Task 3: Verify and deploy the release

**Files:** none unless verification identifies a defect.

- [ ] **Step 1: Run full verification**

~~~bash
pnpm test:run
pnpm typecheck
pnpm build
git diff --check
~~~

Expected: every command exits 0.

- [ ] **Step 2: Run a local browser smoke test**

Verify batch clear while OCR is active, the zoomed evidence tab stop, normal
single-result focus, beer and wine demos, and no console errors.

- [ ] **Step 3: Fast-forward main and push**

~~~bash
git switch main
git merge --ff-only codex/privacy-release-hardening
git push origin main
~~~

- [ ] **Step 4: Smoke-test Amplify**

Wait for Amplify to build the pushed commit. At
https://main.d4qb8x5x7ay8t.amplifyapp.com/, verify current landing copy,
beer/wine demos, batch clear, and the keyboard evidence viewer. Record the
deployed commit in the final handoff.
