# Beverage Profiles, Photo Readiness, and Warning Evidence Design

## Goal

Expand Proofline's browser-local prototype from distilled spirits to the three
beverage families named in the brief—distilled spirits, beer, and wine—while
making poor-photo recovery and statutory-warning review more useful and more
honest. The application remains an evidence aid: it never approves a label or
claims to determine legal compliance automatically.

## Constraints

- Run entirely in the browser. Label images and application facts must not be
  uploaded to a service or sent to a cloud OCR endpoint.
- Keep the five-second automated-OCR deadline and the existing preserved manual
  review path.
- Support the brief's shared comparison fields: brand, class/type, alcohol
  content, net contents, producer/bottler address, origin for imports, and the
  government warning.
- Do not represent incomplete beverage-specific regulations as a complete TTB
  rules engine. The result remains subject to human and regulatory review.
- Preserve the 300-file browser batch cap and the current two-worker local OCR
  pool.

## Product Scope

### Beverage profiles

The intake record gains a required `beverageType` with three values:
`distilled_spirits`, `beer`, and `wine`. A central profile module owns the
display labels, supported fields, and validation behavior so the form, CSV
parser, batch queue, validation engine, demos, and documentation use the same
definitions.

All profiles compare the shared brief fields. Distilled spirits retain the
optional proof field and the `proof = 2 × ABV` consistency check. Beer and wine
omit proof comparison because it is not a common requirement in the brief.

The record also expresses whether alcohol content is expected to appear on the
label. Distilled spirits always expect a declared ABV in this prototype. Beer
and wine can be marked `declared` or `manual_review`; the latter means the app
does not silently treat a missing ABV as compliant. It produces an explicit
human-review finding explaining that an applicable exemption or requirement
must be confirmed by the reviewer.

This is coverage of the brief's comparison workflow, not a claim to encode
every beer, wine, or spirits exception. Unsupported beverage families remain
clearly out of scope.

### Single and batch intake

Single-label intake uses an accessible beverage selector. Selecting beer or
wine hides the proof input and presents the alcohol-content review choice;
distilled spirits retains the current ABV/proof flow. Existing import-origin
behavior remains unchanged.

The downloadable batch template and parser gain `beverage_type` and
`alcohol_content_expectation` columns. Values are validated strictly and each
row carries the selected profile into its review desk and CSV export. A
filename-only batch row remains extraction triage and is never treated as a
profile-based verification.

Guided demos include one representative case for each beverage family plus the
existing discrepancy, foreign-origin, title-case-warning, and degraded-evidence
scenarios. Demo copy states when evidence is fixture-backed.

## Photo Readiness and Evidence Recovery

### Deterministic local readiness guidance

After a user selects an image, the browser performs a lightweight, local
preflight using image metadata and decoded dimensions. It reports concrete,
truthful guidance such as unsupported format, over-limit size, or too few pixels
for a reliable label reading. It does not claim to diagnose glare, perspective,
or blur from unreliable heuristics, and it never modifies the uploaded image.

The preflight is advisory: a reviewer can continue with an image that needs
review. Its instructions recommend a straight-on, evenly lit, glare-free retake
when the image is small or OCR later produces no useful evidence.

### No-usable-evidence recovery

OCR gains a distinct `no-usable-evidence` outcome when recognition completes
but returns blank text or no parseable label candidates. This differs from a
decode/engine failure. The single-review and batch paths map it to the existing
preserved manual-evidence workflow:

- retain the original file, preview, thumbnail, submitted application facts,
  and any OCR text;
- focus an accessible disclosure explaining that no usable OCR evidence was
  produced;
- provide `Retry OCR` and manual evidence entry immediately; and
- give image-retake guidance without claiming the cause was definitely glare or
  lighting.

The five-second deadline retains its current behavior. No-usable-evidence is a
successful OCR attempt that did not provide enough evidence; it must not report
a completed extraction duration as a successful verification result.

### Evidence viewer

The review desk adds a browser-local full-resolution image viewer with explicit
zoom controls and a reset control. It uses the existing object URL or fixture
visual only; it does not create a network request or alter the source evidence.
It supports the warning review and manual evidence entry. If no visual evidence
is available, visual confirmations remain pending and cannot be checked.

## Government Warning Review

The current combined typography checkbox is replaced by separate derived review
fields and visible controls:

1. **Heading transcription** remains the OCR/agent evidence comparison against
   literal `GOVERNMENT WARNING:`.
2. **Uppercase rendering** requires a reviewer to inspect the image and confirm
   that the printed heading appears in capital letters.
3. **Bold presentation** requires a reviewer to inspect the image and confirm
   that `GOVERNMENT WARNING` is bold and the remaining warning text is not
   bold.
4. **Legibility and placement** remains a separate human review task.

OCR is evidence for transcription only. It must never auto-pass capitalization
rendering or boldness from text case, OCR layout metadata, pixel analysis, or a
demo fixture's CSS styling. A reviewer may not check the visual attestations
without visual evidence. Completing an attestation cannot clear an OCR heading
mismatch, an unreadable warning, or another outstanding finding.

The profile-independent warning requirements apply to all three beverage types.
The app continues to state that final type-size and regulatory determinations
belong to the agent.

## Architecture

The change retains the existing dependency direction:

| Module | Responsibility after this change |
| --- | --- |
| `src/domain/beverageProfiles.ts` | Beverage types, profile definitions, profile labels, and shared input rules. |
| `src/domain/types.ts` | Beverage-aware application data, alcohol-content expectation, and split visual-review flags. |
| `src/domain/validation.ts` | Profile-aware field validation and derived warning-attestation findings. |
| `src/features/extraction/imageReadiness.ts` | Pure local image-readiness classification for file metadata and dimensions. |
| `src/features/extraction/ocr.ts` | Distinct no-usable-evidence result after recognition and parsing. |
| `src/features/intake` | Beverage-aware CSV schema, template, queue state, and export. |
| `src/components` | Beverage selector, readiness guidance, zoomable evidence viewer, and split warning controls. |
| `src/features/demo` | Representative beer and wine fixtures alongside existing scenarios. |

The profile module is data-driven so a future approved rule set can be added
without embedding beverage conditionals throughout the UI. No server, account,
persistence, analytics, or external OCR dependency is introduced.

## Error Handling and Accessibility

- Invalid profile or alcohol-expectation values are rejected at single intake
  and line-numbered in CSV intake.
- Unsupported beverage types are disclosed before processing rather than being
  coerced into a different rule set.
- A readiness warning is advisory and never blocks a user from inspecting or
  manually reviewing evidence.
- Manual-review disclosures receive focus when OCR has no usable evidence.
- The image viewer, zoom controls, and all warning confirmations have explicit
  accessible names and keyboard support.
- Visual attestations are disabled with explanatory text when an original or
  fixture image is unavailable.

## Testing and Acceptance Criteria

Unit tests prove that profiles expose the correct common fields, only distilled
spirits run proof consistency, and beer/wine alcohol-content exceptions remain
manual review rather than a pass. CSV and queue tests cover profile propagation,
strict template validation, retry, manual review, and export.

OCR tests prove blank text and no parseable candidates produce
`no-usable-evidence`, while actual decode/worker failures remain errors. UI
tests prove advisory readiness guidance, retained manual review after
no-usable-evidence, visual-evidence guards, image zoom controls, independent
uppercase/bold/legibility checks, and the fact that a visual confirmation cannot
override a heading mismatch.

The complete suite, typecheck, and production build must pass. A deployed smoke
test will cover one live label review, the beer and wine guided demos, a
no-usable-evidence/manual-review case, batch template download/upload, and the
absence of label-data network egress.

## Non-goals

- Full TTB rule coverage or legal advice for every beverage subtype.
- Automatic glare removal, deskew, contrast enhancement, or machine proof of
  visual boldness, contrast, type size, curvature, or label attachment.
- Automatic compliance approval, COLA integration, user accounts, persistence,
  audit records, cloud batch processing, or data storage.
