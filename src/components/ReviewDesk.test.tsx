import { render, screen } from '@testing-library/react';
import { ReviewDesk } from './ReviewDesk';

it('keeps manual actions reachable and blocks visual confirmations without a visual source', () => {
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
      warningUppercaseConfirmed={false}
      onWarningUppercaseConfirmed={() => undefined}
      warningBoldConfirmed={false}
      onWarningBoldConfirmed={() => undefined}
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
  expect(screen.getByRole('checkbox', {
    name: /printed heading is uppercase/i,
  })).toBeDisabled();
  expect(screen.getByRole('checkbox', {
    name: /government warning is bold/i,
  })).toBeDisabled();
  expect(screen.getByRole('checkbox', {
    name: /reviewed warning legibility, contrast, and placement/i,
  })).toBeDisabled();
  expect(screen.getByText(/visual evidence is unavailable/i)).toBeInTheDocument();
});
