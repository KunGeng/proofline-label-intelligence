import {
  BEVERAGE_PROFILES,
  getBeverageProfile,
  isAlcoholContentExpectation,
  isBeverageType,
} from './beverageProfiles';

it('defines the three supported beverage profiles and only spirits support proof', () => {
  expect(Object.keys(BEVERAGE_PROFILES)).toEqual([
    'distilled_spirits',
    'beer',
    'wine',
  ]);
  expect(getBeverageProfile('distilled_spirits').supportsProof).toBe(true);
  expect(getBeverageProfile('beer').supportsProof).toBe(false);
  expect(getBeverageProfile('wine').allowedAlcoholContentExpectations)
    .toEqual(['declared', 'manual_review']);
});

it('accepts only supported profile and expectation values', () => {
  expect(isBeverageType('beer')).toBe(true);
  expect(isBeverageType('cider')).toBe(false);
  expect(isAlcoholContentExpectation('manual_review')).toBe(true);
  expect(isAlcoholContentExpectation('exempt')).toBe(false);
});
