import type { Candidate, LabelExtraction } from '../../domain/types';

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const candidate = (
  value: string,
  rawText: string,
  confidence: number,
): Candidate => ({
  value: normalizeWhitespace(value),
  rawText,
  confidence,
  source: 'ocr',
});

const firstLine = (rawText: string, pattern: RegExp): string | undefined =>
  rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => pattern.test(line));

export const extractFromText = (
  rawText: string,
  confidence: number,
): LabelExtraction => {
  const extraction: LabelExtraction = {};
  const brandName = firstLine(
    rawText,
    /^[A-Z][A-Z0-9 &'.,-]*\b(?:DISTILLERY|DISTILLING|SPIRITS)\b[ A-Z0-9 &'.,-]*$/,
  );
  const classType = firstLine(
    rawText,
    /\b(?:bourbon|whiskey|whisky|vodka|gin|rum|tequila|brandy)\b/i,
  );
  const abvMatch = rawText.match(
    /\b(\d{1,2}(?:\.\d+)?\s*%)\s*(?:alc\.?\s*\/\s*vol\.?|abv|alcohol\s+by\s+volume)\b/i,
  );
  const proofMatch = rawText.match(/\(?\s*(\d{1,3}(?:\.\d+)?)\s*proof\s*\)?/i);
  const netContentsMatch = rawText.match(
    /\b(\d{1,4}(?:\.\d+)?\s*(?:mL|L|fl\.?\s*oz\.?))\b/i,
  );
  const producerMatch = rawText.match(
    /(?:bottled|distilled|produced)\s+by\s+([^\r\n]+)/i,
  );
  const warningHeadingMatch = rawText.match(/\b(government\s+warning:)/i);

  if (brandName) {
    extraction.brandName = candidate(brandName, brandName, confidence);
  }

  if (classType) {
    extraction.classType = candidate(classType, classType, confidence);
  }

  if (abvMatch) {
    extraction.abv = candidate(abvMatch[1].replace(/\s+/g, ''), abvMatch[0], confidence);
  }

  if (proofMatch) {
    extraction.proof = candidate(
      `${proofMatch[1]} Proof`,
      proofMatch[0],
      confidence,
    );
  }

  if (netContentsMatch) {
    const value = normalizeWhitespace(netContentsMatch[1]).replace(/\bml\b/i, 'mL');
    extraction.netContents = candidate(value, netContentsMatch[0], confidence);
  }

  if (producerMatch) {
    extraction.producerAddress = candidate(
      producerMatch[1].replace(/[.\s]+$/, ''),
      producerMatch[0],
      confidence,
    );
  }

  if (warningHeadingMatch && warningHeadingMatch.index !== undefined) {
    const warningText = rawText
      .slice(warningHeadingMatch.index + warningHeadingMatch[0].length)
      .trim();

    extraction.warningHeading = candidate(
      warningHeadingMatch[1],
      warningHeadingMatch[0],
      confidence,
    );

    if (warningText) {
      extraction.warningText = candidate(warningText, warningText, confidence);
    }
  }

  return extraction;
};
