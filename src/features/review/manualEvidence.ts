import type { Candidate, LabelExtraction } from '../../domain/types';

export type EvidenceField = keyof LabelExtraction;
export type ManualEvidenceLocks = Partial<Record<EvidenceField, true>>;

export const evidenceFields: EvidenceField[] = [
  'brandName',
  'classType',
  'abv',
  'proof',
  'netContents',
  'producerAddress',
  'countryOfOrigin',
  'warningText',
  'warningHeading',
];

export const setManualCandidate = (
  extraction: LabelExtraction,
  field: EvidenceField,
  value: string,
): LabelExtraction => {
  const previous = extraction[field];
  return {
    ...extraction,
    [field]: {
      value,
      rawText: previous?.rawText ?? '',
      confidence: 1,
      source: 'agent',
    } satisfies Candidate,
  };
};

export const clearManualCandidate = (
  extraction: LabelExtraction,
  field: EvidenceField,
): LabelExtraction => {
  const { [field]: _removed, ...remaining } = extraction;
  return remaining;
};

export const mergeUntouchedOcrEvidence = (
  current: LabelExtraction,
  fresh: LabelExtraction,
  locks: ManualEvidenceLocks,
): LabelExtraction => evidenceFields.reduce<LabelExtraction>((merged, field) => {
  if (locks[field] || merged[field] || !fresh[field]) {
    return merged;
  }
  return { ...merged, [field]: fresh[field] };
}, { ...current });
