import type { Candidate, LabelExtraction } from '../../domain/types';

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const classTypePattern =
  /\b(?:bourbon|whiskey|whisky|vodka|gin|rum|tequila|brandy)\b/i;
const abvPattern =
  /\b(\d{1,2}(?:\.\d+)?\s*%)\s*(?:alc\.?\s*\/\s*vol\.?|abv|alcohol\s+by\s+volume)\b/i;
const proofPattern = /\(?\s*(\d{1,3}(?:\.\d+)?)\s*proof\s*\)?/i;
const netContentsPattern =
  /\b(\d{1,4}(?:\.\d+)?\s*(?:mL|L|fl\.?\s*oz\.?))\b/i;
const producerPattern = /(?:bottled|distilled|produced)\s+by\s+([^\r\n]+)/i;
const producerOrImporterPattern =
  /\b(?:bottled|distilled|produced|imported|manufactured)\s+by\b|\bimporter\b/i;
const countryOfOriginPattern =
  /\b(?:product\s+of|country\s+of\s+origin\s*:?|made\s+in|imported\s+from)\s+([A-Za-z][A-Za-z .’'\-]*?)(?=\r?\n|$)/i;
const warningHeadingPattern = /\b(government\s+warning:)/i;
const warningBodyPattern = /\(\s*1\s*\)[\s\S]*?health\s+problems\s*\./i;
const displayLinePattern = /^[A-Z][A-Z0-9 &'.,-]*$/;

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

const isMandatoryLine = (line: string): boolean =>
  classTypePattern.test(line) ||
  abvPattern.test(line) ||
  proofPattern.test(line) ||
  netContentsPattern.test(line) ||
  producerOrImporterPattern.test(line) ||
  countryOfOriginPattern.test(line) ||
  warningHeadingPattern.test(line);

const findBrandName = (rawText: string): string | undefined => {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstMandatoryLine = lines.findIndex(isMandatoryLine);
  const displayLines = lines.slice(
    0,
    firstMandatoryLine === -1 ? lines.length : firstMandatoryLine,
  );

  return displayLines.find(
    (line) => displayLinePattern.test(line) && !isMandatoryLine(line),
  );
};

export const extractFromText = (
  rawText: string,
  confidence: number,
): LabelExtraction => {
  const extraction: LabelExtraction = {};
  const brandName = findBrandName(rawText);
  const classType = firstLine(rawText, classTypePattern);
  const abvMatch = rawText.match(abvPattern);
  const proofMatch = rawText.match(proofPattern);
  const netContentsMatch = rawText.match(netContentsPattern);
  const producerMatch = rawText.match(producerPattern);
  const countryOfOriginMatch = rawText.match(countryOfOriginPattern);
  const warningHeadingMatch = rawText.match(warningHeadingPattern);

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

  if (countryOfOriginMatch) {
    extraction.countryOfOrigin = candidate(
      countryOfOriginMatch[1].replace(/[.,;:]+\s*$/, ''),
      countryOfOriginMatch[0].trim(),
      confidence,
    );
  }

  if (warningHeadingMatch && warningHeadingMatch.index !== undefined) {
    const warningRegion = rawText
      .slice(warningHeadingMatch.index + warningHeadingMatch[0].length)
      .match(warningBodyPattern)?.[0];

    extraction.warningHeading = candidate(
      warningHeadingMatch[1],
      warningHeadingMatch[0],
      confidence,
    );

    if (warningRegion) {
      extraction.warningText = candidate(warningRegion, warningRegion, confidence);
    }
  }

  return extraction;
};
