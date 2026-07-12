import { CANONICAL_WARNING_BODY } from '../../domain/constants';
import { OLD_TOM_RAW_TEXT } from '../demo/cases';
import { extractFromText } from './parser';

describe('extractFromText', () => {
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

  it('retains a malformed warning heading as an observed candidate for validation', () => {
    const extraction = extractFromText(
      `Government Warning: ${CANONICAL_WARNING_BODY}`,
      0.72,
    );

    expect(extraction.warningHeading?.value).toBe('Government Warning:');
    expect(extraction.warningText?.value).toBe(CANONICAL_WARNING_BODY);
  });

  it('does not infer a brand from decorative text only', () => {
    expect(extractFromText('decorative text only', 0.72).brandName).toBeUndefined();
  });
});
