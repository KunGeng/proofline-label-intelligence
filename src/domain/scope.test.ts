import {
  isExplicitlyOutOfScopeBeverage,
  unsupportedBeverageMessage,
} from './scope';

describe('isExplicitlyOutOfScopeBeverage', () => {
  it.each(['wine', 'Malt beverage', 'hard cider', 'ready-to-drink seltzer'])(
    'rejects explicitly unsupported %s',
    (classType) => expect(isExplicitlyOutOfScopeBeverage(classType)).toBe(true),
  );

  it.each(['Kentucky Straight Bourbon Whiskey', 'Cognac', 'Rum'])(
    'does not reject a potentially distilled %s',
    (classType) => {
      expect(isExplicitlyOutOfScopeBeverage(classType)).toBe(false);
    },
  );

  it('describes the restricted prototype scope', () => {
    expect(unsupportedBeverageMessage).toMatch(/u\.s\. distilled-spirit labels/i);
  });
});
