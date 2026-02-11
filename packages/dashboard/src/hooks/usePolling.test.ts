// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePolling } from './usePolling';

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      writable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls callback at the specified interval', () => {
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 5000));

    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('uses default 60s interval when not specified', () => {
    const callback = vi.fn();
    renderHook(() => usePolling(callback));

    vi.advanceTimersByTime(59_999);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not call callback when disabled', () => {
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 5000, false));

    vi.advanceTimersByTime(10000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('stops polling when page becomes hidden', () => {
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 5000));

    // Simulate page hidden
    Object.defineProperty(document, 'visibilityState', { value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(10000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('resumes and fetches immediately when page becomes visible', () => {
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 5000));

    // Hide
    Object.defineProperty(document, 'visibilityState', { value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));

    // Show again
    Object.defineProperty(document, 'visibilityState', { value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));

    // Should have called immediately on visibility change
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('cleans up on unmount', () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => usePolling(callback, 5000));

    unmount();

    vi.advanceTimersByTime(10000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('does not start interval when page is initially hidden', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden' });

    const callback = vi.fn();
    renderHook(() => usePolling(callback, 5000));

    vi.advanceTimersByTime(10000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('uses latest callback reference', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const { rerender } = renderHook(
      ({ cb }) => usePolling(cb, 5000),
      { initialProps: { cb: callback1 } },
    );

    rerender({ cb: callback2 });

    vi.advanceTimersByTime(5000);
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
  });
});
