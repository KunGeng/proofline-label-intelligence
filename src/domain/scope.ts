const unsupportedPattern = /\b(?:beer|wine|cider|seltzer|malt|ready[- ]to[- ]drink|rtd)\b/i;

export const isExplicitlyOutOfScopeBeverage = (classType: string): boolean =>
  unsupportedPattern.test(classType);

export const unsupportedBeverageMessage =
  'Proofline is limited to U.S. distilled-spirit labels. Beer, wine, cider, seltzer, malt, and ready-to-drink products are outside this prototype.';
