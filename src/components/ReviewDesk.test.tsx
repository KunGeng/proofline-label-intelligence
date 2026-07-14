import { render, screen } from '@testing-library/react';
import { ReviewDesk } from './ReviewDesk';

it('makes no-application manual evidence actions reachable in an accessible scroll region', () => {
  render(
    <ReviewDesk
      title="triage.png"
      extraction={{}}
      phase="ready"
      rawText=""
      isGuidedDemo={false}
      shouldFocusManualDisclosure={false}
      manualEvidence
      onRetryOcr={() => undefined}
      warningTypographyConfirmed={false}
      onWarningTypographyConfirmed={() => undefined}
      warningLegibilityConfirmed={false}
      onWarningLegibilityConfirmed={() => undefined}
      onCorrectCandidate={() => undefined}
      onClearCandidate={() => undefined}
      onExit={() => undefined}
    />,
  );

  const tableRegion = screen.getByRole('region', {
    name: /manual evidence entry table\. scroll horizontally to review all columns\./i,
  });

  expect(tableRegion).toContainElement(screen.getByRole('table'));
  expect(screen.getByRole('button', { name: /add brand name candidate/i })).toBeInTheDocument();
});
