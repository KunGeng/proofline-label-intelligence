import {
  CANONICAL_WARNING,
  CANONICAL_WARNING_BODY,
  CANONICAL_WARNING_HEADING,
} from './constants';
import {
  candidateState,
  fieldLabel,
  validateLabel,
} from './validation';
import {
  canonicalizeText,
  parseAbv,
  parseMilliliters,
  parseProof,
  stringSimilarity,
} from './normalize';
import type {
  Candidate,
  FieldKey,
  LabelExtraction,
  ValidationInput,
  VerificationResult,
} from './types';

const candidate = (
  value: string,
  confidence = 0.99,
  source: Candidate['source'] = 'fixture',
): Candidate => ({ value, rawText: value, confidence, source });

const fixture = (
  overrides: Partial<LabelExtraction> = {},
  flags = { warningTypographyConfirmed: false },
  applicationOverrides: Partial<ValidationInput['application']> = {},
): ValidationInput => ({
  application: {
    brandName: "Stone's Throw",
    classType: 'Bourbon Whiskey',
    abv: '45%',
    proof: '90',
    netContents: '750 mL',
    producerAddress: 'Example, KY',
    isImported: false,
    ...applicationOverrides,
  },
  extraction: {
    brandName: candidate("Stone's Throw"),
    classType: candidate('Bourbon Whiskey'),
    abv: candidate('45%'),
    proof: candidate('90 Proof'),
    netContents: candidate('750 mL'),
    producerAddress: candidate('Example, KY'),
    warningText: candidate(CANONICAL_WARNING_BODY),
    warningHeading: candidate(CANONICAL_WARNING_HEADING),
    ...overrides,
  },
  flags,
});

const byField = (result: VerificationResult, field: FieldKey) =>
  result.fields.find((item) => item.field === field)!;

describe('normalization helpers', () => {
  it('normalizes only the supported textual variations', () => {
    expect(fieldLabel('warningHeading')).toBe('Warning heading');
    expect(canonicalizeText(" Stone’s-Throw, LLC. ")).toBe('stones throw llc');
    expect(canonicalizeText('ＦＯＯ')).not.toBe(canonicalizeText('foo'));
    expect(stringSimilarity("Stone's Throw", "Stone's Thro")).toBeGreaterThanOrEqual(
      0.85,
    );
    expect(parseAbv('45 %')).toBe(45);
    expect(parseProof('90 Proof')).toBe(90);
    expect(parseMilliliters('0.75 L')).toBe(750);
  });

  it('classifies confidence thresholds deterministically', () => {
    expect(candidateState(candidate('readable', 0.85))).toBe('match');
    expect(candidateState(candidate('review', 0.6))).toBe('needs_review');
    expect(candidateState(candidate('unreadable', 0.59))).toBe('unreadable');
  });
});

describe('validateLabel', () => {
  it('returns a match for an exact baseline label except unconfirmed typography', () => {
    const result = validateLabel(fixture());

    expect(byField(result, 'brandName')).toMatchObject({ state: 'match' });
    expect(byField(result, 'warningText')).toMatchObject({
      state: 'match',
      expected: CANONICAL_WARNING_BODY,
    });
    expect(byField(result, 'warningHeading')).toMatchObject({
      state: 'match',
      expected: CANONICAL_WARNING_HEADING,
    });
    expect(byField(result, 'warningTypography')).toMatchObject({
      state: 'needs_review',
    });
    expect(result.overallState).toBe('needs_review');
  });

  it('routes a case-only brand difference to review rather than automatic match', () => {
    const result = validateLabel(
      fixture({ brandName: candidate("STONE'S THROW") }),
    );

    expect(byField(result, 'brandName')).toMatchObject({
      state: 'needs_review',
    });
  });

  it('routes a likely-equivalent brand to review', () => {
    const result = validateLabel(
      fixture({ brandName: candidate("Stone's Thro") }),
    );

    expect(byField(result, 'brandName')).toMatchObject({
      state: 'needs_review',
    });
  });

  it('marks a high-confidence brand conflict as a mismatch', () => {
    const result = validateLabel(
      fixture({ brandName: candidate('Old Tom Distillery') }),
    );

    expect(byField(result, 'brandName')).toMatchObject({ state: 'mismatch' });
  });

  it('keeps a non-high-confidence conflict in review', () => {
    const result = validateLabel(
      fixture({ brandName: candidate('Old Tom Distillery', 0.72, 'ocr') }),
    );

    expect(byField(result, 'brandName')).toMatchObject({
      state: 'needs_review',
    });
  });

  it('marks an unreadable candidate below the review threshold', () => {
    const result = validateLabel(
      fixture({ netContents: candidate('', 0.3, 'ocr') }),
    );

    expect(byField(result, 'netContents')).toMatchObject({
      state: 'unreadable',
    });
  });

  it('flags conflicting ABV and proof values', () => {
    const result = validateLabel(
      fixture({ abv: candidate('40%'), proof: candidate('80 Proof') }),
    );

    expect(byField(result, 'abv')).toMatchObject({ state: 'mismatch' });
    expect(byField(result, 'proof')).toMatchObject({ state: 'mismatch' });
  });

  it('does not require proof when the application has no proof value', () => {
    const result = validateLabel(
      fixture(
        { proof: undefined },
        { warningTypographyConfirmed: true },
        { proof: undefined },
      ),
    );

    expect(byField(result, 'proof')).toMatchObject({ state: 'match' });
    expect(result.overallState).toBe('match');
  });

  it('accepts numerically equivalent net contents expressed in liters', () => {
    const result = validateLabel(fixture({ netContents: candidate('0.75 L') }));

    expect(byField(result, 'netContents')).toMatchObject({ state: 'match' });
  });

  it('requires an origin for imported products and ignores it for domestic products', () => {
    const imported = validateLabel(
      fixture(
        { countryOfOrigin: candidate('Scotland') },
        { warningTypographyConfirmed: true },
        { isImported: true, countryOfOrigin: 'Scotland' },
      ),
    );
    const domestic = validateLabel(
      fixture(
        { countryOfOrigin: candidate('Scotland') },
        { warningTypographyConfirmed: true },
      ),
    );

    expect(byField(imported, 'countryOfOrigin')).toMatchObject({
      state: 'match',
    });
    expect(byField(domestic, 'countryOfOrigin')).toMatchObject({
      state: 'match',
    });
  });

  it('marks an imported country of origin as unreadable when it is absent', () => {
    const result = validateLabel(
      fixture(
        {},
        { warningTypographyConfirmed: true },
        { isImported: true, countryOfOrigin: 'Scotland' },
      ),
    );

    expect(byField(result, 'countryOfOrigin')).toMatchObject({
      state: 'unreadable',
    });
  });

  it('detects a title-cased warning heading as a mismatch', () => {
    const result = validateLabel(
      fixture({ warningHeading: candidate('Government Warning:') }),
    );

    expect(byField(result, 'warningHeading')).toMatchObject({
      state: 'mismatch',
    });
  });

  it('compares the warning body exactly apart from whitespace', () => {
    const whitespaceOnly = validateLabel(
      fixture({
        warningText: candidate(CANONICAL_WARNING_BODY.replace(' (2)', '\n(2)')),
      }),
    );
    const altered = validateLabel(
      fixture({
        warningText: candidate(
          CANONICAL_WARNING_BODY.replace('health problems.', 'health risks.'),
        ),
      }),
    );

    expect(CANONICAL_WARNING).toBe(
      `${CANONICAL_WARNING_HEADING} ${CANONICAL_WARNING_BODY}`,
    );
    expect(byField(whitespaceOnly, 'warningText')).toMatchObject({
      state: 'match',
    });
    expect(byField(altered, 'warningText')).toMatchObject({
      state: 'mismatch',
    });
  });

  it('keeps warning typography in review until an agent confirms it', () => {
    expect(byField(validateLabel(fixture()), 'warningTypography').state).toBe(
      'needs_review',
    );
    expect(
      byField(
        validateLabel(fixture({}, { warningTypographyConfirmed: true })),
        'warningTypography',
      ).state,
    ).toBe('match');
  });

  it('returns mismatch before unreadable and review states', () => {
    const result = validateLabel(
      fixture({ abv: candidate('40%', 0.99), netContents: candidate('', 0.3) }),
    );

    expect(result.overallState).toBe('mismatch');
  });

  it('returns unreadable before needs-review states', () => {
    const result = validateLabel(
      fixture({ netContents: candidate('', 0.3) }),
    );

    expect(result.overallState).toBe('unreadable');
  });
});
