import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { extractFromImage } from './features/extraction/ocr';

vi.mock('./features/extraction/ocr', () => ({
  extractFromImage: vi.fn(),
}));

it('offers a guided demo and a label-review entry point', () => {
  render(<App />);

  expect(
    screen.getByRole('heading', { name: /review labels with evidence/i }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /open guided demo/i }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /review a label/i }),
  ).toBeInTheDocument();
});

it('opens the fixture-backed demo and requires warning typography confirmation', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /open guided demo/i }));

  expect(
    screen.getByText(/precomputed sample — not a live OCR timing result/i),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', {
      name: /i visually confirmed the warning heading is uppercase and bold/i,
    }),
  ).not.toBeChecked();

  await user.click(
    screen.getByRole('checkbox', {
      name: /i visually confirmed the warning heading is uppercase and bold/i,
    }),
  );

  expect(
    screen.getByText('No discrepancies detected — agent approval required.'),
  ).toBeInTheDocument();
});

it('preserves raw OCR evidence when an agent corrects an extracted candidate', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /open guided demo/i }));
  await user.click(
    screen.getByRole('button', { name: /correct brand name candidate/i }),
  );

  const correction = screen.getByRole('textbox', {
    name: /brand name corrected candidate/i,
  });
  await user.clear(correction);
  await user.type(correction, 'Old Tom Reserve');
  await user.click(screen.getByRole('button', { name: /save brand name correction/i }));

  expect(screen.getByText('Agent-entered')).toBeInTheDocument();
  expect(screen.getByText(/raw OCR: OLD TOM DISTILLERY/i)).toBeInTheDocument();
});

it('never renders an approval claim', async () => {
  render(<App />);

  expect(screen.queryByText(/^approved$/i)).not.toBeInTheDocument();
});

it('shows origin only for imported products and explains unsupported uploads inline', async () => {
  const user = userEvent.setup({ applyAccept: false });
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));

  expect(
    screen.queryByRole('textbox', { name: /country of origin/i }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole('checkbox', { name: /imported product/i }));

  expect(
    screen.getByRole('textbox', { name: /country of origin/i }),
  ).toBeInTheDocument();

  const unsupportedImage = new File(['label'], 'label.gif', { type: 'image/gif' });
  await user.upload(screen.getByLabelText(/^choose label image$/i), unsupportedImage);

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Upload a JPEG, PNG, or WebP image.',
  );
});

it('blocks extraction until the required application facts are supplied', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Complete the required application facts: Brand name, Class/type, Alcohol by volume, Net contents, Producer address.',
  );
});

it('keeps the reviewer informed when OCR rejects unexpectedly', async () => {
  const user = userEvent.setup();
  vi.mocked(extractFromImage).mockRejectedValueOnce(new Error('worker failed'));

  render(<App />);
  await user.click(screen.getByRole('button', { name: /review a label/i }));
  await user.type(screen.getByRole('textbox', { name: /^brand name$/i }), 'Old Tom');
  await user.type(screen.getByRole('textbox', { name: /class\/type/i }), 'Bourbon Whiskey');
  await user.type(screen.getByRole('textbox', { name: /alcohol by volume/i }), '45%');
  await user.type(screen.getByRole('textbox', { name: /net contents/i }), '750 mL');
  await user.type(screen.getByRole('textbox', { name: /producer address/i }), 'Old Tom, KY');
  await user.upload(
    screen.getByLabelText(/^choose label image$/i),
    new File(['label'], 'old-tom.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: /start evidence review/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'OCR could not complete. Try a clearer image or begin a new evidence review.',
  );
});
