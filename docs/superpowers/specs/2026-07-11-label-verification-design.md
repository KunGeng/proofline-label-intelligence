# Proofline — AI-Assisted Alcohol Label Verification

**Status:** Approved design, pending implementation-plan review
**Audience:** Compliance reviewers evaluating U.S. distilled-spirit labels
**Product promise:** Help an agent find discrepancies quickly; never replace the agent's decision.

## 1. Problem and outcome

TTB-style label review contains a large volume of repeatable comparison work: an agent must compare an application's declared facts with the information shown on a submitted label. The prototype will make that work faster without overstating what image analysis can prove.

The evaluator should be able to open the app, load a polished sample case, understand the result immediately, then try a single label or a small batch without configuration. The expected outcome is a reviewer-ready queue in which every field is visibly classified as **Match**, **Mismatch**, **Needs review**, or **Unreadable**. A record may be clear of detected discrepancies, but the application will never label it as approved.

## 2. Scope

The prototype is deliberately scoped to **U.S. distilled-spirit labels**, matching the provided bourbon example. Each review compares these application facts against a label image:

- Brand name
- Class/type designation
- Alcohol by volume and optional proof
- Net contents
- Producer/bottler/importer name and address
- Import status and country of origin when applicable
- Government health warning statement

The product includes a single-record form and an optional batch CSV keyed by image filename. It accepts JPEG, PNG, and WebP files up to 10 MB each, with a maximum of 300 images per batch, and keeps all work in browser memory for the current session. The queue retains only a file handle until processing and then a thumbnail/result record, releasing full-size preview resources after a job completes.

### Explicit non-goals

- COLA integration, accounts, persistent storage, or a production audit record
- Full beer, wine, or every conditional spirits disclosure rule
- A claim that OCR can prove label font size, contrast, field of vision, container circumference, or physical attachment
- Automatic approval or rejection

Those boundaries are visible in the interface and README, not hidden in fine print.

## 3. Selected technical approach

The application will be a static, browser-first React + TypeScript application built with Vite. It will use a local OCR adapter for uploaded images, an instant fixture-backed extraction path for the included demo cases, and a pure deterministic validation engine. No API key, backend, database, or document retention is required. OCR worker, WASM, and English-language assets will be bundled or served from the application's own origin; the product will not silently depend on a third-party CDN at run time.

This approach is selected over a cloud-vision service because it is deployable and testable without credentials, demonstrates privacy-aware engineering, and directly addresses the stakeholder concern that outbound network calls may be blocked. The extraction boundary remains deliberately small so a future Azure/private-endpoint vision provider can replace the local adapter without changing validation or user-interface code.

### Module boundaries

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `features/intake` | File drop, single application form, CSV parsing, client-side image preparation | Browser APIs |
| `features/extraction` | OCR adapter, text cleanup, image-derived evidence regions, confidence | OCR library / demo fixtures |
| `features/validation` | Normalization, parsing, rule evaluation, human-review routing | Domain types only |
| `features/review` | Review desk, field evidence, queue, filtering, export | Domain types and feature services |
| `features/demo` | Built-in compelling label cases and expected application records | Static fixtures |

The validation engine must not import UI or OCR code. It receives application facts and extracted candidate facts and returns explainable field results, making it fast to unit test and safe to reuse with a later backend.

The OCR adapter limits the image's longest edge to 2,000 pixels and runs no more than two workers at once. A candidate at or above 0.85 confidence can support a hard match or mismatch; a candidate from 0.60 to 0.84 routes to review; one below 0.60 is unreadable. The UI presents these as product guardrails, not as a claim of universal OCR accuracy.

## 4. Reviewer experience

### Home and demo

The landing state leads with one clear call to action: **Review a label**. A secondary **Open guided demo** starts a realistic Old Tom Distillery bourbon case instantly. The demo includes a short explanation of the result and makes the product evaluable even when the user has no label image at hand. It is explicitly labeled **Precomputed sample — not a live OCR timing result**.

### Single-label review desk

The review page uses a side-by-side layout at desktop widths:

1. **Application facts** — a plain-language form with a completion indicator and import toggle.
2. **Label evidence** — image preview with zoom, OCR progress, extracted text, and a warning-region focus view when detected.
3. **Verification report** — a prominent decision summary, field cards, and a reviewer note.

Each field card shows the application value, detected label value, reasoning, confidence, and an intentional state. Mismatches use high-contrast red only for actual conflicts; review states use amber and explain why an agent must inspect the label. A reviewer may correct an extracted candidate, never the submitted application fact: the original OCR text and image evidence remain visible, and the corrected value is marked **Agent-entered** before the rule is re-run. Keyboard navigation, visible focus, semantic form labels, sufficient contrast, and responsive layouts are first-class requirements.

### Batch queue

The batch flow accepts multiple images and an optional CSV. A downloaded template documents the required `filename` and these recommended columns: `brandName`, `classType`, `abv`, `proof`, `netContents`, `producerAddress`, `isImported`, and `countryOfOrigin`. Filename matching trims whitespace and compares base filenames case-insensitively. Duplicate CSV rows are invalid; rows without an image are surfaced as import warnings; image files without a matching row stay in the queue as **Extracted — application data required**, not falsely verified.

Images without a CSV are intentionally supported as an extraction-and-triage batch, not a verified batch. Their rows display extracted candidates and a clear application-data-required state. Jobs process with the two-worker concurrency limit, render their first completed result as soon as it is available, and retain completed rows while later files continue. The queue exposes filename, status, match/mismatch/review counts, retry, filters, and a CSV export of review results.

The batch promise is **the first useful result within about five seconds for a normal image**, not an unrealistic claim that hundreds of labels complete simultaneously.

## 5. Validation and compliance behavior

### Result vocabulary

Every field and label uses one of four states:

- **Match** — application and extracted label values agree under the documented rule.
- **Mismatch** — reliable evidence conflicts with the application value.
- **Needs review** — evidence is ambiguous, a normalization was non-exact, or the rule requires visual judgment.
- **Unreadable** — a required candidate could not be extracted with adequate confidence.

Overall status is deterministic: **Mismatch** takes precedence over **Unreadable**, which takes precedence over **Needs review**, which takes precedence over **Match**. Missing application data is **Needs review**; a required label value that cannot be read is **Unreadable**. The summary phrase for a clean result is **“No discrepancies detected — agent approval required.”**

### Field rules

| Field | Evaluation |
| --- | --- |
| Brand and class/type | Raw equality is a match. A difference only in case, whitespace, apostrophe, or simple punctuation is **Needs review — likely equivalent**, preserving the agent's judgment. Otherwise, a normalized string-similarity score of at least 0.85 is review; a score below 0.85 with at least 0.85 OCR confidence is a mismatch. |
| ABV and proof | Parse numeric ABV and proof independently. A numeric ABV conflict at or above 0.85 confidence is a mismatch. When proof appears, compare it with the expected U.S. relationship of proof = 2 × ABV; a difference greater than 1 proof point is a mismatch and lesser variance is review. |
| Net contents | Normalize `mL`, `ml`, and whitespace. A numerical/unit conflict at or above 0.85 confidence is a mismatch. |
| Name/address and country | A normalized exact name/address match is a match; every other detected name/address difference is review rather than an automatic mismatch. Country is required when the application marks a record as imported and is not assessed for domestic records; a normalized country-name mismatch at or above 0.85 confidence is a mismatch. Import status itself is application metadata, not an inferred fact. |
| Health-warning wording | Compare the required statement with whitespace normalization only. A substantive word or punctuation difference is a mismatch only with at least 0.85 confidence; otherwise it is review or unreadable according to the threshold. |
| `GOVERNMENT WARNING:` heading | Require literal uppercase heading text. Title case or missing heading is a mismatch only with at least 0.85 confidence. Boldness, contrast, surrounding separation, and physical type size require explicit reviewer confirmation; until confirmed, the typography check is **Needs review** and participates in overall-status precedence. |

The canonical warning used by the fixture and validator is:

> GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.

This is intentionally scoped against the current federal health-warning rule, including its uppercase/bold heading requirement. The README will link to [27 CFR Part 16](https://www.ecfr.gov/current/title-27/part-16) and the [TTB health-warning guidance](https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/ds-labeling-home/ds-health-warning).

## 6. Extraction, performance, and failure handling

Before OCR, the browser will correct image orientation when available and resize only images over the 2,000-pixel longest-edge limit. The extraction adapter emits progressive states (`Preparing`, `Reading label`, `Validating`, `Ready`) so the interface never appears stalled. It reports confidence per candidate and preserves the raw extracted text for agent inspection.

The built-in demo is fixture-backed so it is fast and repeatable. Uploaded images use OCR and degrade safely: unsupported files, unreadable text, incomplete application data, and parse failures become actionable human-readable states. They never become a fabricated match. A retry action permits a clearer image, and a manual text edit lets an agent continue a review without leaving the tool.

No uploaded image or OCR text is sent to a service or stored after the tab closes. This is a prototype privacy choice, not a claim of complete federal compliance.

## 7. Visual system

The visual direction is a confident, modern compliance workspace: ink/navy foundations, warm amber review cues, a restrained red for discrepancies, and a soft mint confirmation color. It uses a large readable display face only for headings and a highly legible system sans-serif for dense review content. Cards favor evidence and hierarchy over dashboard decoration. Deliberate empty, loading, success, and error states make the product feel complete rather than a happy-path demo.

The brand should feel like a serious internal tool, not a consumer alcohol site: a compact wordmark, an understated document/checkmark motif, and copy that treats the reviewer as the authority.

## 8. Test and quality plan

The application will include automated unit tests for the validation module covering:

- Exact and case/punctuation-normalized brand comparisons
- Material brand mismatch
- ABV/proof agreement and conflict
- Net-content normalization and conflict
- Exact, title-cased, altered, and missing government-warning variants
- Import-country conditional behavior
- Low-confidence and missing-extraction review routing
- Overall-status precedence and reviewer typography confirmation
- Agent-entered extraction corrections with raw-evidence preservation
- CSV record association, duplicate/missing/unmatched filenames, and no-CSV triage behavior

The build must type-check and produce a production bundle. A browser smoke test will cover the guided demo, a mismatch case, batch-row progression, filter behavior, and export. Manual responsive and keyboard-accessibility review will be documented in the README.

## 9. Delivery

The repository will contain source code, tests, sample assets, setup instructions, architecture rationale, data/privacy behavior, limitations, and a concise discussion of the future Azure deployment path. It will be deployed as a static site so a recruiter can open the demo without setup. The README will explain that the browser queue accepts up to 300 files but is a prototype implementation; production would add durable Azure-backed queueing, storage, audit records, and retry policies. If the hosting environment cannot provide a public URL in this workspace, the repository will still include a production build and exact deployment instructions.

## 10. Acceptance criteria

The implementation is ready to hand off when an evaluator can:

1. Launch or open the app and complete the guided Old Tom demo in one obvious action.
2. See field-level evidence and conservative status language, including visual confirmation for warning typography.
3. Upload an image plus application data and receive an explainable result without a secret or server configuration.
4. Load multiple images with a CSV, observe progress, filter results, and export the queue.
5. Read a concise README that makes the reasoning, trade-offs, tests, and deployment path easy to assess.
