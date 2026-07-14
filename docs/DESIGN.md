# Proofline — design notes

This document explains the reasoning behind the prototype: what it optimizes for, the
rules it enforces, and the trade-offs it accepts. Setup, usage, and deployment live in
the [README](../README.md).

## Runtime and CI contract

Local development requires Node.js 20+ with Corepack and pnpm 11.12.0. The repository
pins the same pnpm release in `packageManager` and `engines`; GitHub Actions uses Node
22, configures `pnpm/action-setup@v4` with `version: 11.12.0`, and installs with
`pnpm install --frozen-lockfile`.

## Product stance

TTB-style label review contains a large volume of repeatable comparison work: an agent
compares an application's declared facts with what the label shows. Proofline speeds up
that comparison without overstating what image analysis can prove. Two commitments
follow from that:

1. **The agent owns the decision.** The application never says "approved." A clean
   comparison reads *"No discrepancies detected — agent approval required."* Checks that
   OCR cannot make reliably (warning-heading boldness, capitalization rendering, type
   size) are explicit human confirmation tasks, not silent passes.
2. **Evidence stays inspectable.** Every extracted candidate carries its raw OCR text,
   confidence, and source (`ocr`, `fixture`, or `agent`). Corrections replace the
   candidate value and mark it **Agent-entered** — the original raw OCR remains visible
   beside it. A corrected value is treated as human-verified: the stale OCR confidence
   no longer gates the field.

## Scope

U.S. distilled-spirit labels, matching the provided bourbon example. Compared fields:
brand name, class/type, ABV and optional proof (including the proof = 2 × ABV
consistency check), net contents, producer/bottler address, import status plus country
of origin when applicable, and the federal government warning (body text, literal
uppercase `GOVERNMENT WARNING:` heading, and a manual typography confirmation).

Non-goals, stated in the UI and README rather than hidden: COLA integration, accounts,
persistence, audit records, beer/wine rule coverage, automatic approval or rejection,
and any claim that OCR proves physical-label characteristics.

## Architecture

Static React + TypeScript + Vite application; no server. Layers, by dependency
direction:

| Module | Responsibility |
| --- | --- |
| `src/domain` | Pure validation engine: normalization, parsing, field rules, status precedence. Imports nothing from UI or OCR code. |
| `src/features/extraction` | Local Tesseract OCR adapter, candidate parser, image preparation. |
| `src/features/intake` | Strict CSV parsing, filename matching, cancellation-aware batch queue, results export. |
| `src/features/demo` | Fixture-backed guided demo case. |
| `src/components` | Review desk, intake form, batch workspace — consumers of the layers above. |

The extraction boundary (`ExtractFromImage`) is deliberately small so a different OCR
backend — including a vision model behind an approved private endpoint — can replace the
local adapter without touching validation or UI code.

After a reviewer intentionally enters a single or batch intake, at most one local OCR worker may prewarm; no OCR work runs on page load. Prewarming uses idle-time and timer fallback scheduling. The pool remains capped at two workers, and the second is demand-created for batch work.

For live OCR, field confidence is derived from matched OCR words or lines: a parsed
candidate uses the minimum confidence of its matched contiguous word span, then the
matching line when no exact span is available. If neither mapping is safe, it
conservatively falls below the readable threshold rather than inheriting a page-wide
score.

The guided low-confidence scenario uses CSS-only visual degradation as a disclosed
presentation treatment. It does not alter the live OCR input or fixture evidence, so it
does not represent contrast, deskew, thresholding, or another OCR-preprocessing step.

### Why local OCR instead of a cloud vision model

The stakeholder interviews were explicit that the agency network blocks outbound calls
to ML endpoints, and that a prior vendor pilot failed partly for that reason. Local OCR
(tesseract.js with same-origin worker/WASM/language assets) makes the prototype
deployable and testable with no credentials, no data egress, and no firewall
exceptions. The accepted cost is accuracy on stylized or degraded labels — which the
confidence thresholds route to human review rather than silently guessing. A vision
LLM would handle Dave-style nuance ("STONE'S THROW" vs "Stone's Throw") and Jenny's
imperfect photos better; the adapter seam is where that would plug in once an approved,
network-permitted endpoint exists.

### Performance and the five-second expectation

Five seconds is an automated-wait target, not a universal performance promise.

After five seconds of automated OCR, Proofline opens manual evidence review. The deadline
starts when active extraction begins and includes image preparation, worker acquisition,
initialization, and recognition. The original label and submitted facts remain available;
reviewers may enter evidence immediately or explicitly retry OCR.

Batch items that reach the deadline are marked Manual review required while the queue
continues. They retain their original file and any available evidence, including when no
application row was supplied.

The local benchmark explicitly disables the five-second OCR deadline. It does so to
ensure its first and warm-worker timings remain an honest measurement of the current
device. The deadline is an automated-wait target under normal responsive browser
scheduling, not an absolute real-time guarantee while a browser event loop is blocked.

Design responses:

- Images longer than 2,000 px are downscaled before recognition. One prewarmed worker
  may shorten initialization after deliberate intake; it does not make every first
  extraction equivalent.
- For a real review, Proofline shows measured extraction time only when OCR completes successfully; a deadline result or retry that ends in an OCR error does not display a completed-OCR duration. Batch progress includes a running average with a remaining-time estimate.
- The local sample benchmark fetches the shipped same-origin label and runs it twice on
  the current device. It reports **First sample run** and **Second warm-worker run**
  with phase timings, field coverage, and per-field confidence. It is not a universal speed guarantee or a network-cold measurement: a normal browser session may already have an initialized worker.
- The guided demo is fixture-backed and labeled as such — it demonstrates the review
  experience without implying a live OCR timing.

Local CPU recognition on an older government machine may still take longer for large or
noisy labels. The interface exposes timing and a manual recovery path instead of
claiming a universal sub-five-second result.

## Validation rules

Every field resolves to one of four states — **Match**, **Mismatch**, **Needs review**,
**Unreadable** — and the overall status takes the worst state in the precedence order
mismatch → unreadable → needs review → match.

Confidence gates the strength of any claim: at or above 0.85 a candidate can support a
hard match or mismatch; 0.60–0.84 always routes to review, even when the text looks
equivalent; below 0.60 (or absent) is unreadable.

Field-specific behavior:

- **Brand / class / address / country**: raw equality is a match. Differences only in
  case, whitespace, apostrophes, or simple punctuation are *needs review — likely
  equivalent* (preserving agent judgment on cases like `STONE'S THROW` vs
  `Stone's Throw`); a normalized similarity below 0.85 with high OCR confidence is a
  mismatch.
- **ABV / proof / net contents**: numeric comparison after unit-aware parsing
  (mL/L/fl oz). Proof, when present, must satisfy proof = 2 × ABV within one proof
  point. An application-side value that fails to parse routes to review with a message
  that blames the application, not the label; both the single-label form and the CSV
  intake validate these formats up front so that case is rare.
- **Government warning**: the body is compared to the canonical 27 CFR Part 16
  statement after whitespace normalization only; the heading must be the literal
  uppercase `GOVERNMENT WARNING:`. Typography (bold, capitalization rendering) is an
  explicit reviewer confirmation that participates in overall status until checked.
  Warning legibility is a manual reviewer confirmation. It records the reviewer's
  inspection of legibility, contrast, and placement; it is separate from the
  typography check and neither is an OCR-derived pass. Exact printed type size remains a final regulatory review responsibility.

## Batch intake

CSV matching is strict by design: partial application schemas are rejected rather than
silently downgraded, duplicate filenames (in the selection or the CSV) are refused
because a safe one-to-one match cannot be inferred, and filename-only rows run as
extraction triage marked **Application data required** — never falsely verified.
Filename-only rows remain OCR triage. CSV application facts can open a full review without rerunning OCR. The action requires an available extraction; the embedded desk preserves the batch queue and updates the same row on return. The queue caps at 300 files, runs
through two workers, supports retry (including while the batch is still processing),
and exports per-file results with a field-level findings column. Clearing a batch
cancels pending work and releases object URLs; late-settling worker results for a
cleared batch are discarded by generation tokens.

## Testing

The suite covers the validation rules and precedence, parser extraction, OCR worker
lifecycle (timeout, failure, reuse), CSV schema/matching edge cases, queue concurrency
and cancellation, export escaping and formula neutralization, UI review states and
accessibility behaviors, and a README/template contract test that keeps the
documentation honest. CI runs typecheck, tests, and the production build on Node 22
with pnpm 11.12.0 and a frozen lockfile.
