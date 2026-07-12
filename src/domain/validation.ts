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
  if (expectedNumber === undefined || observedNumber === undefined) {
    return withCandidate(
      field,
      state === 'match' ? 'mismatch' : 'needs_review',
      expected,
      candidate,
      state === 'match'
        ? 'High-confidence value is not in the required numeric format.'
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

const countryOfOriginField = (
  input: ValidationInput,
): FieldResult => {
  if (!input.application.isImported) {
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
  ];

  return { fields, overallState: overallState(fields) };
};
