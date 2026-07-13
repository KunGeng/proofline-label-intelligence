export interface OcrConfidenceToken {
  text: string;
  confidence: number;
}

export type CandidateConfidenceResolver = (rawEvidence: string) => number;

const unreadableConfidence = 0.59;

const normalizeToken = (value: string): string =>
  value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim();

const normalizedTokens = (value: string): string[] =>
  normalizeToken(value).split(' ').filter(Boolean);

const boundedConfidence = (value: number): number =>
  Number.isFinite(value)
    ? Math.max(0, Math.min(1, value / 100))
    : unreadableConfidence;

interface NormalizedWordToken {
  text: string;
  wordIndex: number;
}

const isPunctuationOnly = (word: OcrConfidenceToken): boolean =>
  Boolean(word.text.trim()) && !normalizeToken(word.text);

export const createCandidateConfidenceResolver = (
  words: OcrConfidenceToken[],
  lines: OcrConfidenceToken[],
): CandidateConfidenceResolver => (rawEvidence: string): number => {
  const evidence = normalizedTokens(rawEvidence);
  const normalizedWords: NormalizedWordToken[] = words.flatMap((word, wordIndex) =>
    normalizedTokens(word.text).map((text) => ({ text, wordIndex })),
  );
  const start = normalizedWords.findIndex((_, index) =>
    evidence.every(
      (token, offset) => normalizedWords[index + offset]?.text === token,
    ),
  );

  if (evidence.length > 0 && start >= 0) {
    let firstWordIndex = normalizedWords[start]?.wordIndex;
    let lastWordIndex = normalizedWords[start + evidence.length - 1]?.wordIndex;
    const trimmedEvidence = rawEvidence.trim();

    if (/^[^a-z0-9]/i.test(trimmedEvidence)) {
      while (
        firstWordIndex !== undefined &&
        firstWordIndex > 0 &&
        isPunctuationOnly(words[firstWordIndex - 1]!)
      ) {
        firstWordIndex -= 1;
      }
    }

    if (/[^a-z0-9]$/i.test(trimmedEvidence)) {
      while (
        lastWordIndex !== undefined &&
        lastWordIndex < words.length - 1 &&
        isPunctuationOnly(words[lastWordIndex + 1]!)
      ) {
        lastWordIndex += 1;
      }
    }

    if (firstWordIndex !== undefined && lastWordIndex !== undefined) {
      // Use the original word span so punctuation-only OCR tokens still affect
      // the result instead of disappearing during normalization.
      return Math.min(
        ...words
          .slice(firstWordIndex, lastWordIndex + 1)
          .map((word) => boundedConfidence(word.confidence)),
      );
    }
  }

  const normalizedEvidence = normalizeToken(rawEvidence);
  if (!normalizedEvidence) {
    return unreadableConfidence;
  }

  const line = lines.find((candidate) =>
    normalizeToken(candidate.text).includes(normalizedEvidence),
  );
  return line ? boundedConfidence(line.confidence) : unreadableConfidence;
};
