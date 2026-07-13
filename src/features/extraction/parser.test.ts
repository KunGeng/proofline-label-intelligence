import { CANONICAL_WARNING_BODY } from '../../domain/constants';
import { validateLabel } from '../../domain/validation';
import { demoCases, OLD_TOM_RAW_TEXT } from '../demo/cases';
import { createCandidateConfidenceResolver } from './confidence';
import { extractFromText } from './parser';

describe('extractFromText', () => {
  it('derives every guided scenario from its disclosed raw evidence', () => {
    const confidenceByCase = {
      clear: 0.99,
      mismatch: 0.99,
      'foreign-origin': 0.96,
      'warning-heading': 0.96,
      degraded: 0.55,
    } as const;

    expect(demoCases.map((demoCase) => demoCase.id)).toEqual([
      'clear',
      'mismatch',
      'foreign-origin',
      'warning-heading',
      'degraded',
    ]);
    expect(demoCases.map((demoCase) => demoCase.disclosure)).toEqual([
      'Precomputed fixture — not a live OCR timing result.',
      'Precomputed fixture using the shown Old Tom sample. The application brand intentionally conflicts with visible label evidence.',
      'Precomputed illustrative fixture — not a live OCR timing result.',
      'Precomputed illustrative fixture — not a live OCR timing result.',
      'Precomputed low-confidence fixture shown with a visual degradation treatment — not a live OCR timing result.',
    ]);

    for (const demoCase of demoCases) {
      expect(demoCase.extraction).toEqual(
        extractFromText(demoCase.rawText, confidenceByCase[demoCase.id]),
      );
    }

    expect(
      demoCases.map((demoCase) =>
        validateLabel({
          application: demoCase.application,
          extraction: demoCase.extraction,
          flags: {
            warningTypographyConfirmed: false,
            warningLegibilityConfirmed: false,
          },
        }).overallState,
      ),
    ).toEqual([
      'needs_review',
      'mismatch',
      'needs_review',
      'mismatch',
      'unreadable',
    ]);
  });

  it('parses the foreign-origin and title-case fixture text exactly as shown', () => {
    const foreignOrigin = demoCases.find((demoCase) => demoCase.id === 'foreign-origin');
    const warningHeading = demoCases.find((demoCase) => demoCase.id === 'warning-heading');

    expect(foreignOrigin?.rawText).toContain('Imported by Harbor Imports, Boston, MA');
    expect(foreignOrigin?.rawText).toContain('Product of Scotland');
    expect(foreignOrigin?.extraction.producerAddress).toMatchObject({
      value: 'Harbor Imports, Boston, MA',
      rawText: 'Imported by Harbor Imports, Boston, MA',
    });
    expect(foreignOrigin?.extraction.countryOfOrigin).toMatchObject({
      value: 'Scotland',
      rawText: 'Product of Scotland',
      confidence: 0.96,
    });
    expect(warningHeading?.rawText).toContain(
      'Produced by North Coast Spirits, Portland, OR',
    );
    expect(warningHeading?.rawText).toContain(`Government Warning: ${CANONICAL_WARNING_BODY}`);
    expect(warningHeading?.extraction.warningHeading).toMatchObject({
      value: 'Government Warning:',
      rawText: 'Government Warning:',
      confidence: 0.96,
    });
  });

  it('extracts the supplied bourbon facts from readable OCR text', () => {
    const extraction = extractFromText(OLD_TOM_RAW_TEXT, 0.96);

    expect(extraction.brandName?.value).toBe('OLD TOM DISTILLERY');
    expect(extraction.classType?.value).toBe('Kentucky Straight Bourbon Whiskey');
    expect(extraction.abv?.value).toBe('45%');
    expect(extraction.proof?.value).toBe('90 Proof');
    expect(extraction.netContents?.value).toBe('750 mL');
    expect(extraction.producerAddress?.value).toBe(
      'Old Tom Distillery, Louisville, KY',
    );
  });

  it('extracts a display-line brand without distillery vocabulary', () => {
    const extraction = extractFromText(
      `MAKER'S MARK
Kentucky Straight Bourbon Whiskey
45% Alc./Vol. (90 Proof)
750 mL
Bottled by Maker's Mark Distillery, Loretto, KY
GOVERNMENT WARNING: ${CANONICAL_WARNING_BODY}`,
      0.96,
    );

    expect(extraction.brandName?.value).toBe("MAKER'S MARK");
  });

  it('captures a wrapped importer address without swallowing warning text', () => {
    const extraction = extractFromText(`IMPORTED BY Harbor Imports
12 Wharf Street
Boston, MA 02110
GOVERNMENT WARNING: ${CANONICAL_WARNING_BODY}`, 0.96);

    expect(extraction.producerAddress).toMatchObject({
      value: 'Harbor Imports 12 Wharf Street Boston, MA 02110',
      rawText: 'IMPORTED BY Harbor Imports\n12 Wharf Street\nBoston, MA 02110',
    });
  });

  it('stops an address block before an immediately following mandatory line', () => {
    const extraction = extractFromText(
      `IMPORTED BY Harbor Imports
GOVERNMENT WARNING: ${CANONICAL_WARNING_BODY}`,
      0.96,
    );

    expect(extraction.producerAddress).toMatchObject({
      value: 'Harbor Imports',
      rawText: 'IMPORTED BY Harbor Imports',
    });
  });

  it('stops an address block before a malformed warning heading', () => {
    const extraction = extractFromText(
      'IMPORTED BY Harbor Imports\nGOVERNMENT WARNING. Keep out of reach of children.',
      0.96,
    );

    expect(extraction.producerAddress).toMatchObject({
      value: 'Harbor Imports',
      rawText: 'IMPORTED BY Harbor Imports',
    });
  });

  it('stops an address block before a warning body fragment', () => {
    const extraction = extractFromText(
      'IMPORTED BY Harbor Imports\n(1) According to the Surgeon General, women should not drink alcoholic beverages.',
      0.96,
    );

    expect(extraction.producerAddress).toMatchObject({
      value: 'Harbor Imports',
      rawText: 'IMPORTED BY Harbor Imports',
    });
  });

  it('preserves captured address evidence while normalizing only its value', () => {
    const rawText = [
      '  IMPORTER: Harbor Imports  ',
      '  12 Wharf St.  ',
      `GOVERNMENT WARNING: ${CANONICAL_WARNING_BODY}`,
    ].join('\n');
    const extraction = extractFromText(rawText, 0.96);

    expect(extraction.producerAddress).toMatchObject({
      value: 'Harbor Imports 12 Wharf St.',
      rawText: '  IMPORTER: Harbor Imports  \n  12 Wharf St.  ',
    });
  });

  it('uses terminal ABV punctuation as resolver evidence', () => {
    const extraction = extractFromText(
      '45% Alc./Vol.',
      createCandidateConfidenceResolver(
        [
          { text: '45%', confidence: 96 },
          { text: 'Alc.', confidence: 96 },
          { text: '/', confidence: 96 },
          { text: 'Vol', confidence: 96 },
          { text: '.', confidence: 14 },
        ],
        [],
      ),
    );

    expect(extraction.abv).toMatchObject({
      value: '45%',
      rawText: '45% Alc./Vol.',
      confidence: 0.14,
    });
  });

  it('retains a malformed warning heading as an observed candidate for validation', () => {
    const extraction = extractFromText(
      `Government Warning: ${CANONICAL_WARNING_BODY}`,
      0.72,
    );

    expect(extraction.warningHeading?.value).toBe('Government Warning:');
    expect(extraction.warningText?.value).toBe(CANONICAL_WARNING_BODY);
  });

  it.each([
    ['Product of Scotland', 'Scotland'],
    ['Country of Origin: Scotland', 'Scotland'],
    ['Made in Scotland', 'Scotland'],
    ['Imported from Scotland', 'Scotland'],
  ])(
    'extracts %s as explicit country-of-origin evidence',
    (rawText, country) => {
      const extraction = extractFromText(rawText, 0.96);

      expect(extraction.countryOfOrigin).toMatchObject({
        value: country,
        rawText,
        confidence: 0.96,
        source: 'ocr',
      });
    },
  );

  it('bounds canonical warning evidence before unrelated later label copy', () => {
    const extraction = extractFromText(
      `GOVERNMENT WARNING: ${CANONICAL_WARNING_BODY}\nDISTILLED IN KENTUCKY`,
      0.96,
    );

    expect(extraction.warningText).toMatchObject({
      value: CANONICAL_WARNING_BODY,
      rawText: CANONICAL_WARNING_BODY,
    });
  });

  it('does not invent a complete warning body when its canonical ending is absent', () => {
    const extraction = extractFromText(
      'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages.',
      0.96,
    );

    expect(extraction.warningHeading?.value).toBe('GOVERNMENT WARNING:');
    expect(extraction.warningText).toBeUndefined();
  });

  it('does not infer a brand from decorative text only', () => {
    expect(extractFromText('decorative text only', 0.72).brandName).toBeUndefined();
  });
});
