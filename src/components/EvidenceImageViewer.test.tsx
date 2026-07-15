import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvidenceImageViewer } from './EvidenceImageViewer';

it('moves focus into supplied local evidence, zooms locally, and restores focus', async () => {
  const user = userEvent.setup();

  render(<EvidenceImageViewer src="blob:label" alt="Label evidence: sample" />);

  const opener = screen.getByRole('button', {
    name: /open full-size label evidence/i,
  });
  opener.focus();
  await user.click(opener);
  const close = screen.getByRole('button', { name: /close full-size label evidence/i });

  expect(close).toHaveFocus();

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

  await user.click(close);
  expect(
    screen.getByRole('button', { name: /open full-size label evidence/i }),
  ).toHaveFocus();
});

it('exposes the zoomed evidence viewport as a focusable named region', async () => {
  const user = userEvent.setup();

  render(<EvidenceImageViewer src="blob:label" alt="Label evidence" />);
  fireEvent.load(screen.getByRole('img', { name: 'Label evidence' }));
  await user.click(screen.getByRole('button', { name: /open full-size label evidence/i }));

  const viewport = screen.getByRole('region', { name: /zoomed label evidence/i });
  expect(viewport).toHaveAttribute('tabindex', '0');
  viewport.focus();
  expect(viewport).toHaveFocus();
});

it('keeps zoom within the local 1 to 3 times range and can display supplied fixture evidence', async () => {
  const user = userEvent.setup();
  const onEvidenceAvailabilityChange = vi.fn();

  render(
    <EvidenceImageViewer
      alt="Label evidence: fixture"
      fixture={<p>Existing fixture label evidence</p>}
      onEvidenceAvailabilityChange={onEvidenceAvailabilityChange}
    />,
  );

  expect(onEvidenceAvailabilityChange).toHaveBeenLastCalledWith(true);

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

it('reports local image evidence only after it loads and withdraws it after an error', () => {
  const onEvidenceAvailabilityChange = vi.fn();

  render(
    <EvidenceImageViewer
      src="blob:label"
      alt="Label evidence: sample"
      onEvidenceAvailabilityChange={onEvidenceAvailabilityChange}
    />,
  );

  const image = screen.getByRole('img', { name: /label evidence: sample/i });
  expect(onEvidenceAvailabilityChange).toHaveBeenLastCalledWith(false);

  fireEvent.load(image);
  expect(onEvidenceAvailabilityChange).toHaveBeenLastCalledWith(true);

  fireEvent.error(image);
  expect(onEvidenceAvailabilityChange).toHaveBeenLastCalledWith(false);
});
