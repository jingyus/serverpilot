import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './switch';

describe('Switch', () => {
  it('should render switch component', () => {
    render(<Switch aria-label="Toggle switch" />);
    const switchElement = screen.getByRole('switch');
    expect(switchElement).toBeInTheDocument();
  });

  it('should be unchecked by default', () => {
    render(<Switch aria-label="Toggle switch" />);
    const switchElement = screen.getByRole('switch');
    expect(switchElement).not.toBeChecked();
  });

  it('should render checked when checked prop is true', () => {
    render(<Switch checked aria-label="Toggle switch" />);
    const switchElement = screen.getByRole('switch');
    expect(switchElement).toBeChecked();
  });

  it('should call onCheckedChange when toggled', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    render(<Switch onCheckedChange={handleChange} aria-label="Toggle switch" />);

    const switchElement = screen.getByRole('switch');
    await user.click(switchElement);

    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it('should be disabled when disabled prop is true', () => {
    render(<Switch disabled aria-label="Toggle switch" />);
    const switchElement = screen.getByRole('switch');
    expect(switchElement).toBeDisabled();
  });

  it('should not call onCheckedChange when disabled', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    render(<Switch disabled onCheckedChange={handleChange} aria-label="Toggle switch" />);

    const switchElement = screen.getByRole('switch');
    await user.click(switchElement);

    expect(handleChange).not.toHaveBeenCalled();
  });

  it('should apply custom className', () => {
    render(<Switch className="custom-class" aria-label="Toggle switch" />);
    const switchElement = screen.getByRole('switch');
    expect(switchElement).toHaveClass('custom-class');
  });

  it('should toggle between checked and unchecked states', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    const { rerender } = render(
      <Switch checked={false} onCheckedChange={handleChange} aria-label="Toggle switch" />
    );

    const switchElement = screen.getByRole('switch');
    expect(switchElement).not.toBeChecked();

    await user.click(switchElement);
    expect(handleChange).toHaveBeenCalledWith(true);

    rerender(<Switch checked={true} onCheckedChange={handleChange} aria-label="Toggle switch" />);
    expect(switchElement).toBeChecked();

    await user.click(switchElement);
    expect(handleChange).toHaveBeenCalledWith(false);
  });
});
