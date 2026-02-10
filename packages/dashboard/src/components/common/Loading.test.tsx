import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Loading } from './Loading';

describe('Loading', () => {
  describe('spinner variant (default)', () => {
    it('renders with role="status"', () => {
      render(<Loading />);
      const status = screen.getByRole('status');
      expect(status).toBeInTheDocument();
    });

    it('has default aria-label "Loading"', () => {
      render(<Loading />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading');
    });

    it('renders spinner icon with animate-spin', () => {
      const { container } = render(<Loading />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('animate-spin');
    });

    it('renders text when provided', () => {
      render(<Loading text="Loading data..." />);
      expect(screen.getByText('Loading data...')).toBeInTheDocument();
    });

    it('uses text as aria-label when provided', () => {
      render(<Loading text="Fetching servers" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Fetching servers');
    });

    it('does not render text span when text is not provided', () => {
      const { container } = render(<Loading />);
      const spans = container.querySelectorAll('span');
      expect(spans).toHaveLength(0);
    });
  });

  describe('skeleton variant', () => {
    it('renders with pulse animation', () => {
      render(<Loading variant="skeleton" />);
      const status = screen.getByRole('status');
      expect(status).toHaveClass('animate-pulse');
    });

    it('renders with bg-muted', () => {
      render(<Loading variant="skeleton" />);
      expect(screen.getByRole('status')).toHaveClass('bg-muted');
    });

    it('renders screen-reader-only text', () => {
      render(<Loading variant="skeleton" text="Loading content" />);
      const srText = screen.getByText('Loading content');
      expect(srText).toHaveClass('sr-only');
    });

    it('uses default sr-only text when no text provided', () => {
      render(<Loading variant="skeleton" />);
      expect(screen.getByText('Loading')).toHaveClass('sr-only');
    });
  });

  describe('dots variant', () => {
    it('renders three bouncing dots', () => {
      const { container } = render(<Loading variant="dots" />);
      const dots = container.querySelectorAll('.animate-bounce');
      expect(dots).toHaveLength(3);
    });

    it('has staggered animation delays', () => {
      const { container } = render(<Loading variant="dots" />);
      const dots = container.querySelectorAll('.animate-bounce');
      expect(dots[0]).toHaveStyle({ animationDelay: '0ms' });
      expect(dots[1]).toHaveStyle({ animationDelay: '150ms' });
      expect(dots[2]).toHaveStyle({ animationDelay: '300ms' });
    });
  });

  describe('sizes', () => {
    it('renders small spinner', () => {
      const { container } = render(<Loading size="sm" />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('h-4', 'w-4');
    });

    it('renders medium spinner (default)', () => {
      const { container } = render(<Loading />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('h-6', 'w-6');
    });

    it('renders large spinner', () => {
      const { container } = render(<Loading size="lg" />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('h-8', 'w-8');
    });

    it('renders small text', () => {
      render(<Loading size="sm" text="Loading" />);
      expect(screen.getByText('Loading')).toHaveClass('text-xs');
    });

    it('renders medium text', () => {
      render(<Loading size="md" text="Loading" />);
      expect(screen.getByText('Loading')).toHaveClass('text-sm');
    });

    it('renders large text', () => {
      render(<Loading size="lg" text="Loading" />);
      expect(screen.getByText('Loading')).toHaveClass('text-base');
    });

    it('renders small skeleton', () => {
      render(<Loading variant="skeleton" size="sm" />);
      expect(screen.getByRole('status')).toHaveClass('h-4');
    });

    it('renders large skeleton', () => {
      render(<Loading variant="skeleton" size="lg" />);
      expect(screen.getByRole('status')).toHaveClass('h-12');
    });

    it('renders small dots', () => {
      const { container } = render(<Loading variant="dots" size="sm" />);
      const dots = container.querySelectorAll('.animate-bounce');
      dots.forEach((dot) => {
        expect(dot).toHaveClass('h-1.5', 'w-1.5');
      });
    });

    it('renders large dots', () => {
      const { container } = render(<Loading variant="dots" size="lg" />);
      const dots = container.querySelectorAll('.animate-bounce');
      dots.forEach((dot) => {
        expect(dot).toHaveClass('h-3', 'w-3');
      });
    });
  });

  describe('fullscreen', () => {
    it('applies fullscreen overlay classes', () => {
      render(<Loading fullscreen />);
      const status = screen.getByRole('status');
      expect(status).toHaveClass('fixed', 'inset-0', 'z-50');
    });

    it('does not apply fullscreen classes by default', () => {
      render(<Loading />);
      const status = screen.getByRole('status');
      expect(status).not.toHaveClass('fixed');
    });
  });

  describe('customization', () => {
    it('applies custom className', () => {
      render(<Loading className="my-custom-class" />);
      expect(screen.getByRole('status')).toHaveClass('my-custom-class');
    });

    it('forwards ref', () => {
      const ref = { current: null } as React.RefObject<HTMLDivElement>;
      render(<Loading ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });

    it('passes additional HTML attributes', () => {
      render(<Loading data-testid="custom-loading" />);
      expect(screen.getByTestId('custom-loading')).toBeInTheDocument();
    });
  });
});
