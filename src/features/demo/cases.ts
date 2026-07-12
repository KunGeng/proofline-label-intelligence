import { extractFromText } from '../extraction/parser';
import type { DemoCase } from '../extraction/types';

export const OLD_TOM_RAW_TEXT = `OLD TOM DISTILLERY
Kentucky Straight Bourbon Whiskey
45% Alc./Vol. (90 Proof)
750 mL
Bottled by Old Tom Distillery, Louisville, KY
GOVERNMENT WARNING:
(1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because
of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive
a car or operate machinery, and may cause health problems.`;

export const oldTomDemo: DemoCase = {
  id: 'old-tom-clear',
  title: 'Old Tom Distillery / clear label',
  imageUrl: '/demo/old-tom-bourbon.svg',
  disclosure: 'Precomputed sample — not a live OCR timing result.',
  application: {
    brandName: 'OLD TOM DISTILLERY',
    classType: 'Kentucky Straight Bourbon Whiskey',
    abv: '45%',
    proof: '90',
    netContents: '750 mL',
    producerAddress: 'Old Tom Distillery, Louisville, KY',
    isImported: false,
  },
  extraction: extractFromText(OLD_TOM_RAW_TEXT, 0.99),
};
