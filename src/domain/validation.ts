import {
  CANONICAL_WARNING_BODY,
  CANONICAL_WARNING_HEADING,
} from './constants';
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
  FieldResult,
  ReviewState,
  ValidationInput,
  VerificationResult,
} from './types';

export { fieldLabel } from './constants';

const HIGH_CONFIDENCE = 0.85;
const REVIEW_CONFIDENCE = 0.6;
const LIKELY_EQUIVALENT_SIMILARITY = 0.85;
const NUMERIC_TOLERANCE = 0.01;

const candidateValue = (candidate?: Candidate): string => candidate?.value ?? '';

const withCandidate = (
  field: FieldKey,
  state: ReviewState,
  expected: string,
  candidate: Candidate | undefined,
  reason: string,
): FieldResult => ({
  field,
  state,
  expected,
  observed: candidateValue(candidate),
  confidence: candidate?.confidence,
  reason,
});

const derivedField = (
  field: FieldKey,
  state: ReviewState,
  expected: string,
  observed: string,
  reason: string,
  confidence?: number,
): FieldResult => ({
  field,
  state,
  expected,
  observed,
  confidence,
  reason,
});

export const candidateState = (candidate?: Candidate): ReviewState => {
  if (
    !candidate ||
    !candidate.value.trim() ||
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < REVIEW_CONFIDENCE
  ) {
    return 'unreadable';
  }

  if (candidate.confidence < HIGH_CONFIDENCE) {
    return 'needs_review';
  }

  return 'match';
};

const textField = (
  field: FieldKey,
  expected: string,
  candidate: Candidate | undefined,
): FieldResult => {
  const state = candidateState(candidate);
  if (state === 'unreadable') {
    return withCandidate(
      field,
      'unreadable',
      expected,
      candidate,
      'No readable extracted value is available.',
    );
  }

  const observed = candidateValue(candidate);
  if (observed === expected) {
    return withCandidate(
      field,
      state === 'match' ? 'match' : 'needs_review',
      expected,
      candidate,
      state === 'match'
        ? 'Exact text match.'
        : 'Exact text match requires confidence review.',
    );
  }

  const normalizedExpected = canonicalizeText(expected);
  const normalizedObserved = canonicalizeText(observed);
  const similarity = stringSimilarity(normalizedExpected, normalizedObserved);
  if (
    normalizedExpected === normalizedObserved ||
    similarity >= LIKELY_EQUIVALENT_SIMILARITY
  ) {
    return withCandidate(
      field,
      'needs_review',
      expected,
      candidate,
      'Normalized or likely-equivalent text requires review.',
    );
  }

  return withCandidate(
    field,
    state === 'match' ? 'mismatch' : 'needs_review',
    expected,
    candidate,
    state === 'match'
      ? 'High-confidence text conflicts with the application.'
      : 'Text conflict requires review because confidence is not high.',
  );
};

const numericField = (
  field: FieldKey,
  expected: string,
  candidate: Candidate | undefined,
  parse: (value: string) => number | undefined,
): FieldResult => {
  const state = candidateState(candidate);
  if (state === 'unreadable') {
    return withCandidate(
      field,
      'unreadable',
      expected,
      candidate,
      'No readable extracted numeric value is available.',
    );
  }

  const expectedNumber = parse(expected);
  const observedNumber = parse(candidateValue(candidate));
  if (expectedNumber === undefined) {
    return withCandidate(
      field,
      'needs_review',
      expected,
      candidate,
      'The application value is not in a supported numeric format, so an agent must compare it manually.',
    );
  }

  if (observedNumber === undefined) {
    return withCandidate(
      field,
      state === 'match' ? 'mismatch' : 'needs_review',
      expected,
      candidate,
      state === 'match'
        ? 'High-confidence label value is not in the required numeric format.'
        : 'Numeric format requires review because confidence is not high.',
    );
  }

  if (Math.abs(expectedNumber - observedNumber) <= NUMERIC_TOLERANCE) {
    return withCandidate(
      field,
      state === 'match' ? 'match' : 'needs_review',
      expected,
      candidate,
      state === 'match'
        ? 'Equivalent numeric value.'
        : 'Equivalent numeric value requires confidence review.',
    );
  }

  return withCandidate(
    field,
    state === 'match' ? 'mismatch' : 'needs_review',
    expected,
    candidate,
    state === 'match'
      ? 'High-confidence numeric value conflicts with the application.'
      : 'Numeric conflict requires review because confidence is not high.',
  );
};

const hasCandidateValue = (candidate?: Candidate): boolean =>
  Boolean(candidate?.value.trim());

const formatProof = (proof: number): string =>
  `${Number.isInteger(proof) ? proof : Number(proof.toFixed(2))} Proof`;

const abvProofConsistencyField = (
  application: ValidationInput['application'],
  extraction: ValidationInput['extraction'],
): FieldResult => {
  const abv = extraction.abv;
  const proof = extraction.proof;
  const hasAbv = hasCandidateValue(abv);
  const hasProof = hasCandidateValue(proof);

  if (!hasProof && !application.proof?.trim()) {
    return derivedField(
      'abvProofConsistency',
      'match',
      'Not assessed',
      'No proof extracted',
      'Proof is optional for this application, so ABV/proof consistency is not assessed.',
    );
  }

  const abvValue = parseAbv(candidateValue(abv));
  const proofValue = parseProof(candidateValue(proof));
  const expected = abvValue === undefined
    ? 'Proof = 2 × ABV'
    : formatProof(abvValue * 2);
  const observed = hasProof ? candidateValue(proof) : 'No readable proof';
  const confidence = hasAbv && hasProof
    ? Math.min(abv?.confidence ?? 0, proof?.confidence ?? 0)
    : undefined;
  const abvState = candidateState(abv);
  const proofState = candidateState(proof);

  if (!hasAbv || !hasProof || abvState === 'unreadable' || proofState === 'unreadable') {
    return derivedField(
      'abvProofConsistency',
      'unreadable',
      expected,
      observed,
      'A readable ABV and proof pair is required to assess consistency.',
      confidence,
    );
  }

  if (abvState === 'needs_review' || proofState === 'needs_review') {
    return derivedField(
      'abvProofConsistency',
      'needs_review',
      expected,
      observed,
      'ABV/proof consistency requires review because one or both extracted values are below high confidence.',
      confidence,
    );
  }

  if (abvValue === undefined || proofValue === undefined) {
    return derivedField(
      'abvProofConsistency',
      'needs_review',
      expected,
      observed,
      'ABV/proof consistency requires parseable numeric label values.',
      confidence,
    );
  }

  const divergence = Math.abs(proofValue - abvValue * 2);
  if (divergence === 0) {
    return derivedField(
      'abvProofConsistency',
      'match',
      expected,
      observed,
      'Extracted proof equals twice the extracted ABV.',
      confidence,
    );
  }

  if (divergence <= 1) {
    return derivedField(
      'abvProofConsistency',
      'needs_review',
      expected,
      observed,
      'Extracted proof differs from twice the extracted ABV by one proof point or less.',
      confidence,
    );
  }

  return derivedField(
    'abvProofConsistency',
    'mismatch',
    expected,
    observed,
    'Extracted proof differs from twice the extracted ABV by more than one proof point.',
    confidence,
  );
};

const normalizeWarningWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const warningBodyField = (candidate?: Candidate): FieldResult => {
  const state = candidateState(candidate);
  if (state === 'unreadable') {
    return withCandidate(
      'warningText',
      'unreadable',
      CANONICAL_WARNING_BODY,
      candidate,
      'No readable government-warning body is available.',
    );
  }

  const matches =
    normalizeWarningWhitespace(candidateValue(candidate)) ===
    normalizeWarningWhitespace(CANONICAL_WARNING_BODY);
  return withCandidate(
    'warningText',
    matches && state === 'match'
      ? 'match'
      : matches
        ? 'needs_review'
        : state === 'match'
          ? 'mismatch'
          : 'needs_review',
    CANONICAL_WARNING_BODY,
    candidate,
    matches
      ? state === 'match'
        ? 'Exact canonical warning body after whitespace normalization.'
        : 'Canonical warning body requires confidence review.'
      : state === 'match'
        ? 'High-confidence warning body differs from the federal canonical statement.'
        : 'Warning-body difference requires review because confidence is not high.',
  );
};

const warningHeadingField = (candidate?: Candidate): FieldResult => {
  const state = candidateState(candidate);
  if (state === 'unreadable') {
    return withCandidate(
      'warningHeading',
      'unreadable',
      CANONICAL_WARNING_HEADING,
      candidate,
      'No readable government-warning heading is available.',
    );
  }

  const matches = candidateValue(candidate) === CANONICAL_WARNING_HEADING;
  return withCandidate(
    'warningHeading',
    matches && state === 'match'
      ? 'match'
      : matches
        ? 'needs_review'
        : state === 'match'
          ? 'mismatch'
          : 'needs_review',
    CANONICAL_WARNING_HEADING,
    candidate,
    matches
      ? state === 'match'
        ? 'Literal uppercase warning heading matches.'
        : 'Literal warning heading requires confidence review.'
      : state === 'match'
        ? 'Warning heading must be the literal uppercase statutory heading.'
        : 'Warning-heading difference requires review because confidence is not high.',
  );
};

const warningTypographyField = (confirmed: boolean): FieldResult => ({
  field: 'warningTypography',
  state: confirmed ? 'match' : 'needs_review',
  expected: 'Agent confirmation required',
  observed: confirmed ? 'Agent-confirmed' : 'Awaiting agent confirmation',
  reason: confirmed
    ? 'An agent confirmed the warning typography.'
    : 'Warning typography requires explicit agent confirmation.',
});

const warningLegibilityField = (confirmed: boolean): FieldResult => ({
  field: 'warningLegibility',
  state: confirmed ? 'match' : 'needs_review',
  expected: 'Agent confirmation required',
  observed: confirmed ? 'Agent-confirmed' : 'Awaiting agent confirmation',
  reason: confirmed
    ? 'An agent reviewed warning legibility, contrast, and placement.'
    : 'Warning legibility, contrast, and placement require explicit agent confirmation.',
});

const countryOfOriginField = (
  input: ValidationInput,
): FieldResult => {
  if (!input.application.isImported) {
    const originState = candidateState(input.extraction.countryOfOrigin);
    if (originState !== 'unreadable') {
      return withCandidate(
        'countryOfOrigin',
        'needs_review',
        'Domestic product declared',
        input.extraction.countryOfOrigin,
        'Readable origin evidence may conflict with the domestic declaration; verify import status.',
      );
    }

    return withCandidate(
      'countryOfOrigin',
      'match',
      'Not required for domestic product',
      input.extraction.countryOfOrigin,
      'Country of origin is not required for a domestic product.',
    );
  }

  if (candidateState(input.extraction.countryOfOrigin) === 'unreadable') {
    return withCandidate(
      'countryOfOrigin',
      'unreadable',
      input.application.countryOfOrigin?.trim() || 'Country of origin required',
      input.extraction.countryOfOrigin,
      'No readable country of origin is available for an imported product.',
    );
  }

  if (!input.application.countryOfOrigin?.trim()) {
    return withCandidate(
      'countryOfOrigin',
      'needs_review',
      'Country of origin required',
      input.extraction.countryOfOrigin,
      'The application needs a country of origin for an imported product.',
    );
  }

  return textField(
    'countryOfOrigin',
    input.application.countryOfOrigin,
    input.extraction.countryOfOrigin,
  );
};

const overallState = (fields: FieldResult[]): ReviewState => {
  const precedence: ReviewState[] = [
    'mismatch',
    'unreadable',
    'needs_review',
    'match',
  ];

  return precedence.find((state) => fields.some((field) => field.state === state)) ?? 'match';
};

export const validateLabel = (input: ValidationInput): VerificationResult => {
  const { application, extraction, flags } = input;
  const fields: FieldResult[] = [
    textField('brandName', application.brandName, extraction.brandName),
    textField('classType', application.classType, extraction.classType),
    numericField('abv', application.abv, extraction.abv, parseAbv),
    application.proof?.trim()
      ? numericField('proof', application.proof, extraction.proof, parseProof)
      : withCandidate(
          'proof',
          'match',
          'Not provided in application',
          extraction.proof,
          'Proof is not provided in the application.',
        ),
    abvProofConsistencyField(application, extraction),
    numericField(
      'netContents',
      application.netContents,
      extraction.netContents,
      parseMilliliters,
    ),
    textField(
      'producerAddress',
      application.producerAddress,
      extraction.producerAddress,
    ),
    countryOfOriginField(input),
    warningBodyField(extraction.warningText),
    warningHeadingField(extraction.warningHeading),
    warningTypographyField(flags.warningTypographyConfirmed),
    warningLegibilityField(flags.warningLegibilityConfirmed),
  ];

  return { fields, overallState: overallState(fields) };
};
