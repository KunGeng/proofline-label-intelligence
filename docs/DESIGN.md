# Proofline — design notes

This document explains the reasoning behind the prototype: what it optimizes for, the
rules it enforces, and the trade-offs it accepts. Setup, usage, and deployment live in
the [README](../README.md).

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

The discovery notes are blunt: results in about five seconds or agents fall back to
reviewing by eye. Design responses:

- OCR workers are **initialized once and reused** (max two). Worker boot, WASM
  compilation, and language-data load are paid on the first label, not on every label.
- Images longer than 2,000 px are downscaled before recognition.
- The UI reports **measured extraction time** per label (single review and batch rows),
  so the prototype's actual speed on the evaluator's hardware is visible rather than
  claimed. The batch progress line shows a running average and a remaining-time
  estimate.
- The guided demo is fixture-backed and labeled as such — it demonstrates the review
  experience instantly without implying a live OCR timing.

Local CPU recognition on an older government machine may still exceed five seconds for
large or noisy labels. That residual risk is documented in the README's trade-offs
section together with the mitigation path (image preprocessing, a faster engine, or
server-side OCR in the Azure evolution).

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

## Batch intake

CSV matching is strict by design: partial application schemas are rejected rather than
silently downgraded, duplicate filenames (in the selection or the CSV) are refused
because a safe one-to-one match cannot be inferred, and filename-only rows run as
extraction triage marked **Application data required** — never falsely verified. The
queue caps at 300 files, runs through two workers, supports retry (including while the
batch is still processing), and exports per-file results with a field-level findings
column. Clearing a batch cancels pending work and releases object URLs; late-settling
worker results for a cleared batch are discarded by generation tokens.

## Testing

The suite (~120 tests) covers the validation rules and precedence, parser extraction,
OCR worker lifecycle (timeout, failure, reuse), CSV schema/matching edge cases, queue
concurrency and cancellation, export escaping and formula neutralization, UI review
states and accessibility behaviors, and a README/template contract test that keeps the
documentation honest. CI runs typecheck, tests, and the production build.
