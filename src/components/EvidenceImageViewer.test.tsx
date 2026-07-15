import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvidenceImageViewer } from './EvidenceImageViewer';

it('opens the supplied local evidence, zooms locally, resets, and restores focus', async () => {
  const user = userEvent.setup();

  render(<EvidenceImageViewer src="blob:label" alt="Label evidence: sample" />);

  const opener = screen.getByRole('button', {
    name: /open full-size label evidence/i,
  });
  opener.focus();
  await user.click(opener);
  await user.click(screen.getByRole('button', { name: /zoom in/i }));

  expect(screen.getByRole('img', { name: /label evidence: sample/i })).toHaveAttribute(
    'src',
    'blob:label',
  );
  expect(screen.getByRole('img', { name: /label evidence: sample/i })).toHaveStyle({
    transform: 'scale(1.25)',
  });

  await user.click(screen.getByRole('button', { name: /reset zoom/i }));
  expect(screen.getByRole('img', { name: /label evidence: sample/i })).toHaveStyle({
    transform: 'scale(1)',
  });

  await user.click(screen.getByRole('button', { name: /close full-size label evidence/i }));
  expect(
    screen.getByRole('button', { name: /open full-size label evidence/i }),
  ).toHaveFocus();
});

it('keeps zoom within the local 1 to 3 times range and can display supplied fixture evidence', async () => {
  const user = userEvent.setup();

  render(
    <EvidenceImageViewer
      alt="Label evidence: fixture"
      fixture={<p>Existing fixture label evidence</p>}
    />,
  );

  await user.click(
    screen.getByRole('button', { name: /open full-size label evidence/i }),
  );
  expect(screen.getByText('Existing fixture label evidence')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /zoom out/i })).toBeDisabled();

  for (let zoomStep = 0; zoomStep < 8; zoomStep += 1) {
    await user.click(screen.getByRole('button', { name: /zoom in/i }));
  }

  expect(screen.getByRole('button', { name: /zoom in/i })).toBeDisabled();
  expect(screen.getByText('Existing fixture label evidence').parentElement).toHaveStyle({
    transform: 'scale(3)',
  });
});
