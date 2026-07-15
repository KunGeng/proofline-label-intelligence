import { CANONICAL_WARNING_BODY } from '../../domain/constants';
import type { ApplicationData } from '../../domain/types';
import { extractFromText } from '../extraction/parser';
import type { DemoCase, DemoFixtureVariant } from '../extraction/types';

export const OLD_TOM_RAW_TEXT = `OLD TOM DISTILLERY
Kentucky Straight Bourbon Whiskey
45% Alc./Vol. (90 Proof)
750 mL
Bottled by Old Tom Distillery, Louisville, KY
GOVERNMENT WARNING:
(1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because
of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive
a car or operate machinery, and may cause health problems.`;

interface DemoLabelFixtureContent {
  brandName: string;
  classType: string;
  abv?: string;
  netContents: string;
  producerAddress: string;
  countryOfOrigin?: string;
  warningHeading: string;
  warningHeadingBold: boolean;
  warningBody: string;
}

// The raw evidence and the illustrative preview consume this same content so
// a scenario can never display a different label string than it validates.
export const demoLabelFixtureContent: Record<
  DemoFixtureVariant,
  DemoLabelFixtureContent
> = {
  'foreign-origin': {
    brandName: 'NORTH COAST SPIRITS',
    classType: 'Single Malt Whisky',
    abv: '46% Alc./Vol.',
    netContents: '750 mL',
    producerAddress: 'Imported by Harbor Imports, Boston, MA',
    countryOfOrigin: 'Product of Scotland',
    warningHeading: 'GOVERNMENT WARNING:',
    warningHeadingBold: true,
    warningBody: CANONICAL_WARNING_BODY,
  },
  'warning-heading': {
    brandName: 'NORTH COAST SPIRITS',
    classType: 'Single Malt Whisky',
    abv: '46% Alc./Vol.',
    netContents: '750 mL',
    producerAddress: 'Produced by North Coast Spirits, Portland, OR',
    warningHeading: 'Government Warning:',
    warningHeadingBold: true,
    warningBody: CANONICAL_WARNING_BODY,
  },
  'non-bold-warning': {
    brandName: 'NORTH COAST SPIRITS',
    classType: 'Single Malt Whisky',
    abv: '46% Alc./Vol.',
    netContents: '750 mL',
    producerAddress: 'Produced by North Coast Spirits, Portland, OR',
    warningHeading: 'GOVERNMENT WARNING:',
    warningHeadingBold: false,
    warningBody: CANONICAL_WARNING_BODY,
  },
  beer: {
    brandName: 'HOP FIELD',
    classType: 'India Pale Ale',
    abv: '6.2% Alc./Vol.',
    netContents: '355 mL',
    producerAddress: 'Produced by Hop Field, OR',
    warningHeading: 'GOVERNMENT WARNING:',
    warningHeadingBold: true,
    warningBody: CANONICAL_WARNING_BODY,
  },
  wine: {
    brandName: 'ESTATE RED',
    classType: 'Cabernet Sauvignon',
    netContents: '750 mL',
    producerAddress: 'Produced by Estate Winery, CA',
    warningHeading: 'GOVERNMENT WARNING:',
    warningHeadingBold: true,
    warningBody: CANONICAL_WARNING_BODY,
  },
};

const rawTextForFixture = (variant: DemoFixtureVariant): string => {
  const fixture = demoLabelFixtureContent[variant];

  return [
    fixture.brandName,
    fixture.classType,
    fixture.abv,
    fixture.netContents,
    fixture.producerAddress,
    fixture.countryOfOrigin,
    `${fixture.warningHeading} ${fixture.warningBody}`,
  ].filter((line): line is string => Boolean(line)).join('\n');
};

const oldTomApplication: ApplicationData = {
  beverageType: 'distilled_spirits',
  alcoholContentExpectation: 'declared',
  brandName: 'OLD TOM DISTILLERY',
  classType: 'Kentucky Straight Bourbon Whiskey',
  abv: '45%',
  proof: '90',
  netContents: '750 mL',
  producerAddress: 'Old Tom Distillery, Louisville, KY',
  isImported: false,
};

const withExtraction = (
  caseDefinition: Omit<DemoCase, 'extraction'>,
  confidence: number,
): DemoCase => ({
  ...caseDefinition,
  extraction: extractFromText(caseDefinition.rawText, confidence),
});

export const demoCases: DemoCase[] = [
  withExtraction({
    id: 'clear',
    title: 'Old Tom Distillery / clear label',
    outcome: 'Clear candidates, visual checks remain',
    disclosure: 'Precomputed fixture — not a live OCR timing result.',
    application: oldTomApplication,
    rawText: OLD_TOM_RAW_TEXT,
    visual: { kind: 'image', src: '/demo/old-tom-bourbon.svg' },
  }, 0.99),
  withExtraction({
    id: 'mismatch',
    title: 'Old Tom Distillery / declared-brand conflict',
    outcome: 'Declared-brand conflict',
    disclosure: 'Precomputed fixture using the shown Old Tom sample. The application brand intentionally conflicts with visible label evidence.',
    application: { ...oldTomApplication, brandName: 'OLD TOM RESERVE' },
    rawText: OLD_TOM_RAW_TEXT,
    visual: { kind: 'image', src: '/demo/old-tom-bourbon.svg' },
  }, 0.99),
  withExtraction({
    id: 'foreign-origin',
    title: 'Domestic declaration / foreign-origin evidence',
    outcome: 'Domestic declaration, foreign origin',
    disclosure: 'Precomputed illustrative fixture — not a live OCR timing result.',
    application: {
      beverageType: 'distilled_spirits',
      alcoholContentExpectation: 'declared',
      brandName: 'NORTH COAST SPIRITS',
      classType: 'Single Malt Whisky',
      abv: '46%',
      netContents: '750 mL',
      producerAddress: 'Harbor Imports, Boston, MA',
      isImported: false,
    },
    rawText: rawTextForFixture('foreign-origin'),
    visual: { kind: 'fixture', variant: 'foreign-origin' },
  }, 0.96),
  withExtraction({
    id: 'warning-heading',
    title: 'Warning heading / title-case exception',
    outcome: 'Title-case warning heading',
    disclosure: 'Precomputed illustrative fixture — not a live OCR timing result.',
    application: {
      beverageType: 'distilled_spirits',
      alcoholContentExpectation: 'declared',
      brandName: 'NORTH COAST SPIRITS',
      classType: 'Single Malt Whisky',
      abv: '46%',
      netContents: '750 mL',
      producerAddress: 'North Coast Spirits, Portland, OR',
      isImported: false,
    },
    rawText: rawTextForFixture('warning-heading'),
    visual: { kind: 'fixture', variant: 'warning-heading' },
  }, 0.96),
  withExtraction({
    id: 'non-bold-warning',
    title: 'Warning heading / uppercase non-bold evidence',
    outcome: 'Uppercase heading, bold pending',
    disclosure: 'Precomputed illustrative fixture — not a live OCR timing result.',
    application: {
      beverageType: 'distilled_spirits',
      alcoholContentExpectation: 'declared',
      brandName: 'NORTH COAST SPIRITS',
      classType: 'Single Malt Whisky',
      abv: '46%',
      netContents: '750 mL',
      producerAddress: 'North Coast Spirits, Portland, OR',
      isImported: false,
    },
    rawText: rawTextForFixture('non-bold-warning'),
    visual: { kind: 'fixture', variant: 'non-bold-warning' },
  }, 0.96),
  withExtraction({
    id: 'beer',
    title: 'Hop Field / declared beer ABV',
    outcome: 'Declared beer ABV',
    disclosure: 'Precomputed illustrative beer fixture — not a live OCR timing result.',
    application: {
      beverageType: 'beer',
      alcoholContentExpectation: 'declared',
      brandName: 'HOP FIELD',
      classType: 'India Pale Ale',
      abv: '6.2%',
      netContents: '355 mL',
      producerAddress: 'Hop Field, OR',
      isImported: false,
    },
    rawText: rawTextForFixture('beer'),
    visual: { kind: 'fixture', variant: 'beer' },
  }, 0.99),
  withExtraction({
    id: 'wine',
    title: 'Estate Red / manual alcohol-content review',
    outcome: 'Manual alcohol-content review',
    disclosure: 'Precomputed illustrative wine fixture — not a live OCR timing result.',
    application: {
      beverageType: 'wine',
      alcoholContentExpectation: 'manual_review',
      brandName: 'ESTATE RED',
      classType: 'Cabernet Sauvignon',
      netContents: '750 mL',
      producerAddress: 'Estate Winery, CA',
      isImported: false,
    },
    rawText: rawTextForFixture('wine'),
    visual: { kind: 'fixture', variant: 'wine' },
  }, 0.99),
  withExtraction({
    id: 'degraded',
    title: 'Old Tom Distillery / degraded evidence',
    outcome: 'Low-confidence evidence is unreadable',
    disclosure: 'Precomputed low-confidence fixture shown with a visual degradation treatment — not a live OCR timing result.',
    application: oldTomApplication,
    rawText: OLD_TOM_RAW_TEXT,
    visual: {
      kind: 'image',
      src: '/demo/old-tom-bourbon.svg',
      className: 'label-preview__image--degraded',
    },
  }, 0.55),
];
