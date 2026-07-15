# Submission Release Hardening Design

**Status:** Approved for implementation by the user on 2026-07-15.

## Goal

Resolve the final submission audit's browser-memory retention finding and its
keyboard-accessibility findings, then publish the exact verified commit through
the existing Amplify main deployment.

## Constraints

- Keep OCR, label files, and review state browser-local. Do not add a backend,
  cloud OCR, telemetry, analytics, persistence, or a dependency.
- Retain the two-worker global OCR cap, five-second deadline, and 300-file batch cap.
- A clear or workspace exit must abort active batch OCR through the existing
  extractor cancellation path before releasing pooled workers.
- The zoomed evidence scrollport must be keyboard reachable, and completed
  single-label reviews must move focus to a meaningful result target.

## Root Cause

The batch queue's clear action discarded UI state without aborting an active
extractor. A successful worker could later return to the module-global default
engine idle pool. Tesseract v5 writes each input image to the worker's virtual
filesystem, so that pooled worker can retain resized label data until it is
terminated.

## Design

### OCR release boundary

OcrEngine gains releaseIdleWorkers(): Promise<void>. It synchronously removes
every idle worker from the pool and retires it through the existing idempotent
worker lifecycle. releaseOcrWorkers() exposes that operation for the default
engine used by both single and batch review.

Each queue item receives an AbortController; clear() aborts every active signal
before invalidating queue state. queueWorkerFromExtractor() forwards that signal
to the extractor, which already cancels recognition safely and retires an
in-flight worker. BatchQueue releases the default pool whenever a generation is
cleared, replaced, or unmounted. App releases it when a review is exited, so no
prior single-review worker remains pooled across a workspace boundary.

### Keyboard review completion

The expanded image viewport becomes a labeled, focusable region so a keyboard
user can tab to the native scrollport and pan a zoomed label. A visible focus
indicator makes the focus location clear. Normal live OCR completion requests
the existing review-heading focus behavior; manual recovery still focuses its
disclosure.

## Acceptance Evidence

- A pooled worker is terminated and cannot be reused after release.
- Clearing a queue aborts the extractor signal before late OCR can re-pool.
- The expanded evidence viewport has a keyboard tab stop and accessible name.
- A normal live review result focuses its heading.
- Full suite, typecheck, production build, local browser smoke test, deployed
  Amplify smoke test, and public URL/commit verification all pass.

## Non-goals

- Persisting audit logs or changing OCR/validation logic.
- Replacing Tesseract or modifying its bundled worker.
- Adding external services or altering deployment infrastructure.
