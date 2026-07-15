export const BEVERAGE_TYPES = ['distilled_spirits', 'beer', 'wine'] as const;
export type BeverageType = (typeof BEVERAGE_TYPES)[number];

export const ALCOHOL_CONTENT_EXPECTATIONS = ['declared', 'manual_review'] as const;
export type AlcoholContentExpectation =
  (typeof ALCOHOL_CONTENT_EXPECTATIONS)[number];

export interface BeverageProfile {
  type: BeverageType;
  label: string;
  supportsProof: boolean;
  allowedAlcoholContentExpectations: readonly AlcoholContentExpectation[];
}

export const BEVERAGE_PROFILES: Record<BeverageType, BeverageProfile> = {
  distilled_spirits: {
    type: 'distilled_spirits',
    label: 'Distilled spirits',
    supportsProof: true,
    allowedAlcoholContentExpectations: ['declared'],
  },
  beer: {
    type: 'beer',
    label: 'Beer',
    supportsProof: false,
    allowedAlcoholContentExpectations: ['declared', 'manual_review'],
  },
  wine: {
    type: 'wine',
    label: 'Wine',
    supportsProof: false,
    allowedAlcoholContentExpectations: ['declared', 'manual_review'],
  },
};

export const isBeverageType = (value: string): value is BeverageType =>
  (BEVERAGE_TYPES as readonly string[]).includes(value);

export const isAlcoholContentExpectation = (
  value: string,
): value is AlcoholContentExpectation =>
  (ALCOHOL_CONTENT_EXPECTATIONS as readonly string[]).includes(value);

export const getBeverageProfile = (type: BeverageType): BeverageProfile =>
  BEVERAGE_PROFILES[type];
