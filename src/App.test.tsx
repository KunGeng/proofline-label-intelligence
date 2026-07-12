import { render, screen } from '@testing-library/react';
import { App } from './App';

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
