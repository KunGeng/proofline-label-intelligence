# Proofline usability hardening — design

## Context

This design is based on task-based testing of three reviewer journeys in the running site on 2026-07-12:

1. A first-time reviewer opened the guided demo, expanded raw OCR, and completed warning typography confirmation.
2. A reviewer started a single-label review with incomplete application facts, then retried with facts but no image.
3. A batch reviewer opened the CSV intake on desktop and a 390 px-wide viewport.

The walkthrough verified that the core evidence, validation, and mobile layout work. It also revealed avoidable uncertainty at the moments where a reviewer needs to decide what to do next.

## Goals

- Make the demo self-explanatory inside the product rather than relying on README instructions.
- Make required facts visible before a failed form submission and make recovery focused and accessible after one.
- Keep a clean comparison explicitly distinct from a regulatory approval.
- Put the batch CSV template and schema rule at the decision point.

## Non-goals

- Do not alter validation logic, OCR behavior, batch processing limits, or the human-approval policy.
- Do not add persistence, external APIs, or a legal/compliance decision.
- Do not redesign the visual system or change the established responsive layout.

## Approach considered

1. **Copy-only fixes.** Fastest, but it would leave the demo and non-match review desk without a concrete next action. Rejected.
2. **A full wizard with persisted review progress.** More prescriptive, but it adds state and workflow behavior outside the take-home scope. Rejected.
3. **Focused guidance at existing decision points.** Add a compact review-next panel, a demo-only checklist, visible form requirements with field-level recovery, and an inline CSV starter link. Recommended because it improves discoverability while preserving the current evidence-first desk.

## Interaction design

### Review desk

- Replace the decision heading `Match` with `No discrepancies detected` while retaining the `Match` status badge and the existing statement that agent approval is required.
- Add a compact `Review next` panel directly beneath the decision. It summarizes non-match fields and calls out warning-typography confirmation when still required.
- When viewing the fixture demo, label the panel `Guided demo` and show a three-step sequence: inspect raw OCR, inspect the field comparison, and complete the visual typography check. Each step links to its existing evidence area. The checklist is orientation only; it does not claim approval or persist progress.

### Single-label intake

- Show `Required` next to each required application label and introduce the form with a concise required-fields note.
- Keep the existing summary alert, but mark individual missing inputs with `aria-invalid`, link them to the summary, and focus the first incomplete input after submit.
- Apply the same focused error treatment when an imported product is missing country of origin. Keep proof explicitly optional.
- Mark the evidence file input as required in both visible copy and accessible semantics.

### Batch CSV

- Add a download link to the existing safe starter CSV at `/batch-template.csv` in the optional CSV panel.
- State the exact complete-schema requirement in compact, scannable copy: `filename`, `brandName`, `classType`, `abv`, `netContents`, `producerAddress`, and `isImported`; `proof` and `countryOfOrigin` remain conditional.

## Accessibility and error handling

- All new guidance uses meaningful headings, lists, and existing native links/inputs.
- Error summaries retain `role="alert"`; invalid inputs use `aria-invalid` and an `aria-describedby` link to the relevant message.
- Focus moves only after a failed submission, to the first field the reviewer must correct.
- Mobile behavior stays CSS-first: guidance wraps without adding horizontal page overflow; existing table scroll regions remain unchanged.

## Test strategy

- Extend React Testing Library coverage for demo orientation, decision wording, field-level invalid state/focus, imported-origin recovery, and the batch-template link/schema copy.
- Run the full existing test suite, type check, production build, then repeat the three browser journeys—including the 390 px batch viewport—against the local build before publishing.
