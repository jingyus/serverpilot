// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotFound } from './NotFound';

function renderNotFound() {
  return render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  );
}

describe('NotFound', () => {
  it('should render 404 page with heading and description', () => {
    renderNotFound();
    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('Page Not Found')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The page you are looking for does not exist or has been moved.',
      ),
    ).toBeInTheDocument();
  });

  it('should render a link back to dashboard', () => {
    renderNotFound();
    const link = screen.getByTestId('back-home-link');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/dashboard');
    expect(link).toHaveTextContent('Back to Dashboard');
  });
});
