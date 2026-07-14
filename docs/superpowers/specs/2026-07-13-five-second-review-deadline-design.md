# Five-second review-ready deadline design

## Goal

Meet the take-home performance expectation without making a false universal OCR-speed claim. Every single-label submission must become review-ready within a five-second OCR budget: either extracted evidence is available or the reviewer is placed directly into a preserved-image manual-evidence workspace. Batch items use the same per-label budget without interrupting the rest of the queue.

## Product behavior

### Single-label review

1. Submission starts one five-second deadline that includes image preparation, worker acquisition, initialization, and recognition.
2. If OCR finishes first, the existing evidence-review result is shown unchanged.
3. If the deadline fires first, the active OCR work is aborted and the review automatically changes from processing to a manual-evidence workspace. It retains the submitted facts and original image, has no fabricated OCR candidates, and prominently explains that the five-second deadline was reached.
4. The reviewer can enter human-verified evidence immediately or choose an explicit **Retry OCR** action. A retry starts one fresh five-second budget and cannot overwrite any manual correction made after the prior deadline.

### Batch review

1. Each queued image receives the same five-second OCR deadline when the batch scheduler begins its call to the OCR extraction contract, not when the batch is submitted or while it is waiting behind another batch item. That deadline includes all work for that item's extraction: preparation, worker-acquisition wait, worker initialization when needed, and recognition.
2. A deadline-expired item is labeled **Manual review required** with a clear deadline reason; it does not become unreadable or silently disappear.
3. The queue continues processing other items. A deadline-expired row retains its original `File`, optional application facts, and any thumbnail already produced. Opening it starts a dedicated manual-evidence review path even when preparation ended before a thumbnail or application facts were available; it does not automatically navigate away from the batch queue.
4. Retrying an item is explicit and gets a fresh five-second budget.

### Benchmark and demos

The local benchmark remains intentionally unconstrained so it can report the device's true first and warm-worker timings. Guided fixtures remain precomputed. Neither is used to claim that all real-label OCR finishes within five seconds.

## Architecture

Add a deadline option to the OCR extraction contract, with a production default of 5,000 milliseconds and an explicit opt-out for benchmarking. The timer starts when an extraction job begins, before preparation and worker acquisition, so it governs the complete active extraction rather than recognition alone. Deadline expiry uses the existing abort-safe extraction path: cancel preparation or recognition, retire the active worker, release its slot, and return a distinct `deadline-exceeded` outcome with any available thumbnail. An external user or navigation cancellation takes precedence whenever its signal is already aborted at the decision point; only an un-cancelled job can become `deadline-exceeded`.

The app maps that outcome to the existing manual-evidence model rather than the generic extraction-error state. Batch queue state maps it to a distinct reviewer-required row outcome and continues scheduling the remaining labels. Late worker completions remain ignored through the existing run-token and abort handling; a deadline outcome must never restore OCR evidence after manual work begins.

An explicit retry preserves the current manual-review draft. Human-entered values, deliberately cleared fields, their human provenance, and visual-confirmation flags remain authoritative. OCR from the retry may fill only fields that remain untouched and empty; it must not replace a human value or a deliberate human blank. The same merge rule applies to retries launched from batch manual review.

No backend, external OCR, persistence, analytics, authentication, or upload path is added. The local worker limit remains two and the 300-file batch cap remains unchanged.

## Error handling and accessibility

- Deadline language explains the next action plainly: OCR stopped after five seconds and the original label is ready for manual evidence review.
- The automatic single-label transition moves focus to the manual-evidence disclosure or review heading so keyboard and screen-reader users are not left in a vanished processing state.
- Deadline expiry is distinct from a decode failure, unreadable evidence, cancellation, or out-of-scope input.
- A retry is always user initiated. It must not discard manual evidence or start automatically in the background.
- The five-second deadline is an automated-wait target under normal responsive browser scheduling. Browsers cannot dispatch a timer while the main thread is synchronously blocked, so the product and README must not describe it as an absolute real-time guarantee.

## Testing and verification

Test-first coverage will prove that:

1. An extraction deadline aborts a preparation, worker-wait, or recognition phase and releases worker capacity. In batch, its timer begins only when the scheduler starts that item's extraction call.
2. A single-label review reaches the manual-evidence state at five seconds, preserves its image and application facts, announces the reason, and ignores a late OCR resolution.
3. Retrying OCR creates a new deadline and preserves a human-entered value, a deliberately cleared field, provenance, and visual-confirmation state while allowing OCR to fill an untouched empty field.
4. A batch deadline produces a manual-review-required item, keeps the queue moving, and preserves the row for later full review with both application-present and application-absent inputs.
5. A caller cancellation wins over a simultaneous deadline, while an otherwise active expiry becomes `deadline-exceeded`.
6. Benchmark timing remains uncapped and its current device-specific disclosure remains accurate.

Run the focused OCR, queue, and UI suites, then the full test suite, typecheck, production build, and the same-origin OCR artifact check. Repeat the deployed single, batch, and benchmark smoke tests after release.

## Documentation change

Replace the current five-second "recovery point" language with a precise statement: under normal responsive browser scheduling, five seconds is the maximum automated-OCR wait before Proofline opens human review. Keep the existing warning that the product does not promise complete OCR results for every image within five seconds or an absolute real-time deadline during a blocked browser event loop.

## Scope boundaries

This change makes the reviewer workflow available within the performance budget; it does not guarantee a successful OCR result, add image-enhancement algorithms, or broaden the distilled-spirit prototype scope.
