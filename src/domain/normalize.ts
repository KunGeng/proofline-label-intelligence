const NUMBER = '(\\d+(?:\\.\\d+)?)';

const normalizedText = (value: string): string =>
  value
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[‐‑‒–—―]/g, '-')
    .toLocaleLowerCase('en-US')
    .replace(/['"]/g, '')
    .replace(/[-_/\\]/g, ' ')
    .replace(/[.,;:!?()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const canonicalizeText = (value: string): string => normalizedText(value);

export const stringSimilarity = (first: string, second: string): number => {
  const left = canonicalizeText(first);
  const right = canonicalizeText(second);

  if (left === right) {
    return 1;
  }
  if (!left || !right) {
    return 0;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }

    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index];
    }
  }

  const distance = previous[right.length];
  return 1 - distance / Math.max(left.length, right.length);
};

const parseNumber = (value: string, expression: RegExp): number | undefined => {
  const match = value.trim().match(expression);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseAbv = (value: string): number | undefined => {
  const parsed = parseNumber(
    value,
    new RegExp(`^${NUMBER}\\s*%?(?:\\s*abv)?$`, 'i'),
  );

  return parsed !== undefined && parsed >= 0 && parsed <= 100 ? parsed : undefined;
};

export const parseProof = (value: string): number | undefined => {
  const parsed = parseNumber(
    value,
    new RegExp(`^${NUMBER}\\s*(?:proof)?$`, 'i'),
  );

  return parsed !== undefined && parsed >= 0 && parsed <= 200 ? parsed : undefined;
};

export const parseMilliliters = (value: string): number | undefined => {
  const match = value
    .trim()
    .match(new RegExp(`^${NUMBER}\\s*(ml|l|fl\\.?\\s*oz|oz)$`, 'i'));
  if (!match) {
    return undefined;
  }

  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    return undefined;
  }

  switch (match[2].toLocaleLowerCase('en-US').replace('.', '').replace(/\s+/g, ' ')) {
    case 'ml':
      return amount;
    case 'l':
      return amount * 1000;
    case 'fl oz':
    case 'oz':
      return amount * 29.5735295625;
    default:
      return undefined;
  }
};
