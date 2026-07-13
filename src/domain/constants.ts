import type { FieldKey } from './types';

export const CANONICAL_WARNING_HEADING = 'GOVERNMENT WARNING:';

export const CANONICAL_WARNING_BODY =
  '(1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.';

export const CANONICAL_WARNING = `${CANONICAL_WARNING_HEADING} ${CANONICAL_WARNING_BODY}`;

const fieldLabels: Record<FieldKey, string> = {
  brandName: 'Brand name',
  classType: 'Class/type',
  abv: 'Alcohol by volume',
  proof: 'Proof',
  abvProofConsistency: 'ABV/proof consistency',
  netContents: 'Net contents',
  producerAddress: 'Producer address',
  countryOfOrigin: 'Country of origin',
  warningText: 'Warning text',
  warningHeading: 'Warning heading',
  warningTypography: 'Warning typography',
  warningLegibility: 'Warning legibility',
};

export const fieldLabel = (field: FieldKey): string => fieldLabels[field];
