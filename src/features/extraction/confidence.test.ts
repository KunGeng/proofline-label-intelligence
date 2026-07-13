import { createCandidateConfidenceResolver } from './confidence';

describe('createCandidateConfidenceResolver', () => {
  it('uses the weakest matched word confidence for a candidate', () => {
    const confidenceFor = createCandidateConfidenceResolver(
      [{ text: '45%', confidence: 96 }, { text: 'Alc./Vol.', confidence: 62 }],
      [],
    );

    expect(confidenceFor('45% Alc./Vol.')).toBe(0.62);
  });

  it('returns below-readable confidence when evidence cannot be aligned', () => {
    expect(createCandidateConfidenceResolver([], [])('Unknown evidence')).toBeLessThan(0.6);
  });

  it('includes intervening punctuation-only words in the conservative confidence', () => {
    const confidenceFor = createCandidateConfidenceResolver(
      [
        { text: '45%', confidence: 96 },
        { text: 'Alc.', confidence: 96 },
        { text: '/', confidence: 14 },
        { text: 'Vol.', confidence: 96 },
      ],
      [],
    );

    expect(confidenceFor('45% Alc./Vol.')).toBe(0.14);
  });

  it('includes punctuation-only words at evidence boundaries in the confidence', () => {
    const confidenceFor = createCandidateConfidenceResolver(
      [
        { text: '45%', confidence: 96 },
        { text: 'Alc.', confidence: 96 },
        { text: '/', confidence: 96 },
        { text: 'Vol', confidence: 96 },
        { text: '.', confidence: 14 },
      ],
      [],
    );

    expect(confidenceFor('45% Alc./Vol.')).toBe(0.14);
  });

  it('uses a bounded matching line confidence when words cannot be aligned', () => {
    const confidenceFor = createCandidateConfidenceResolver([], [
      { text: '45% Alc./Vol.', confidence: 78 },
    ]);

    expect(confidenceFor('45% Alc./Vol.')).toBe(0.78);
  });
});
