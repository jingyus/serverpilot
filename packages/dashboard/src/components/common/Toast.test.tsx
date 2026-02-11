// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastContainer } from './Toast';
import { useNotificationsStore, type NotificationType } from '@/stores/notifications';

function addNotification(opts: { type: NotificationType; title: string; message?: string; duration?: number; dismissible?: boolean }) {
  return useNotificationsStore.getState().add(opts);
}

describe('ToastContainer', () => {
  beforeEach(() => {
    useNotificationsStore.setState({ notifications: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when no notifications', () => {
    const { container } = render(<ToastContainer />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a success toast', () => {
    addNotification({ type: 'success', title: 'Saved', duration: 0 });
    render(<ToastContainer />);
    expect(screen.getByTestId('toast-success')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('renders an error toast', () => {
    addNotification({ type: 'error', title: 'Failed', duration: 0 });
    render(<ToastContainer />);
    expect(screen.getByTestId('toast-error')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('renders a warning toast', () => {
    addNotification({ type: 'warning', title: 'Caution', duration: 0 });
    render(<ToastContainer />);
    expect(screen.getByTestId('toast-warning')).toBeInTheDocument();
    expect(screen.getByText('Caution')).toBeInTheDocument();
  });

  it('renders an info toast', () => {
    addNotification({ type: 'info', title: 'Note', duration: 0 });
    render(<ToastContainer />);
    expect(screen.getByTestId('toast-info')).toBeInTheDocument();
    expect(screen.getByText('Note')).toBeInTheDocument();
  });

  it('renders toast message when provided', () => {
    addNotification({ type: 'success', title: 'Done', message: 'Operation complete', duration: 0 });
    render(<ToastContainer />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Operation complete')).toBeInTheDocument();
  });

  it('does not render message when not provided', () => {
    addNotification({ type: 'success', title: 'Done', duration: 0 });
    render(<ToastContainer />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    const container = screen.getByTestId('toast-container');
    expect(container.querySelectorAll('.text-xs')).toHaveLength(0);
  });

  it('renders multiple toasts', () => {
    addNotification({ type: 'success', title: 'First', duration: 0 });
    addNotification({ type: 'error', title: 'Second', duration: 0 });
    render(<ToastContainer />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('has role="alert" on each toast', () => {
    addNotification({ type: 'info', title: 'Test', duration: 0 });
    render(<ToastContainer />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('has aria-live="polite" on container', () => {
    addNotification({ type: 'info', title: 'Test', duration: 0 });
    render(<ToastContainer />);
    const container = screen.getByTestId('toast-container');
    expect(container).toHaveAttribute('aria-live', 'polite');
  });

  it('dismiss button removes toast', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    addNotification({ type: 'success', title: 'Removable', duration: 0 });
    render(<ToastContainer />);
    expect(screen.getByText('Removable')).toBeInTheDocument();

    const dismissBtn = screen.getByTestId('toast-dismiss');
    await user.click(dismissBtn);

    expect(screen.queryByText('Removable')).not.toBeInTheDocument();
  });

  it('hides dismiss button when dismissible is false', () => {
    addNotification({ type: 'error', title: 'Permanent', dismissible: false, duration: 0 });
    render(<ToastContainer />);
    expect(screen.queryByTestId('toast-dismiss')).not.toBeInTheDocument();
  });

  it('auto-dismisses after duration', () => {
    addNotification({ type: 'success', title: 'Temporary', duration: 3000 });
    render(<ToastContainer />);
    expect(screen.getByText('Temporary')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText('Temporary')).not.toBeInTheDocument();
  });

  it('container is positioned fixed top-right', () => {
    addNotification({ type: 'info', title: 'Position test', duration: 0 });
    render(<ToastContainer />);
    const container = screen.getByTestId('toast-container');
    expect(container).toHaveClass('fixed', 'top-4', 'right-4', 'z-50');
  });
});
