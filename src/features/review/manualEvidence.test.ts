import {
  clearManualCandidate,
  mergeUntouchedOcrEvidence,
  setManualCandidate,
  type ManualEvidenceLocks,
} from './manualEvidence';

it('preserves a human value and fills only an untouched empty field', () => {
  const manuallyEntered = setManualCandidate({}, 'brandName', 'OLD TOM RESERVE');
  const locks: ManualEvidenceLocks = { brandName: true };

  expect(mergeUntouchedOcrEvidence(manuallyEntered, {
    brandName: { value: 'OLD TOM', rawText: 'OLD TOM', confidence: 0.99, source: 'ocr' },
    abv: { value: '45%', rawText: '45% Alc./Vol.', confidence: 0.99, source: 'ocr' },
  }, locks)).toMatchObject({
    brandName: { value: 'OLD TOM RESERVE', source: 'agent', confidence: 1 },
    abv: { value: '45%', source: 'ocr' },
  });
});

it('keeps a deliberate blank absent after OCR retries', () => {
  const initial = setManualCandidate({}, 'proof', '90 Proof');
  const cleared = clearManualCandidate(initial, 'proof');

  expect(mergeUntouchedOcrEvidence(cleared, {
    proof: { value: '90 Proof', rawText: '90 Proof', confidence: 0.99, source: 'ocr' },
  }, { proof: true })).not.toHaveProperty('proof');
});
