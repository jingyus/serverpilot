// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary, type FallbackProps } from './ErrorBoundary';

// Suppress console.error noise from React and our ErrorBoundary during tests
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** A component that throws on render */
function ThrowingChild({ message = 'Test error' }: { message?: string }): never {
  throw new Error(message);
}

/** A component that renders normally */
function GoodChild() {
  return <div>All good</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('renders default fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('An unexpected error occurred. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('resets error state when "Try again" is clicked', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;

    function ConditionalThrow() {
      if (shouldThrow) {
        throw new Error('Boom');
      }
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Fix the error and click retry
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  it('calls onError callback when an error is caught', () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowingChild message="callback test" />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'callback test' }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });

  it('calls onReset callback when reset is triggered', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    let shouldThrow = true;

    function ConditionalThrow() {
      if (shouldThrow) throw new Error('Boom');
      return <div>OK</div>;
    }

    render(
      <ErrorBoundary onReset={onReset}>
        <ConditionalThrow />
      </ErrorBoundary>,
    );

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(onReset).toHaveBeenCalledOnce();
  });

  it('renders custom fallback ReactNode', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('renders custom fallback function with error and reset', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;

    function ConditionalThrow() {
      if (shouldThrow) throw new Error('Func error');
      return <div>Back to normal</div>;
    }

    function CustomFallback({ error, resetErrorBoundary }: FallbackProps) {
      return (
        <div>
          <p>Error: {error.message}</p>
          <button onClick={resetErrorBoundary}>Reset</button>
        </div>
      );
    }

    render(
      <ErrorBoundary fallback={CustomFallback}>
        <ConditionalThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Error: Func error')).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByText('Back to normal')).toBeInTheDocument();
  });

  it('shows error details in development mode', () => {
    // import.meta.env.DEV is true in vitest by default
    render(
      <ErrorBoundary>
        <ThrowingChild message="dev error detail" />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/dev error detail/)).toBeInTheDocument();
  });

  it('applies custom className to the default fallback', () => {
    render(
      <ErrorBoundary className="custom-error-class">
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveClass('custom-error-class');
  });

  it('logs error to console', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="console log test" />
      </ErrorBoundary>,
    );

    expect(console.error).toHaveBeenCalled();
  });
});
