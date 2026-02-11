// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { resolveThemeClass, useThemeEffect } from './useThemeEffect';
import { useUiStore } from '@/stores/ui';

describe('resolveThemeClass', () => {
  it('returns "dark" for dark theme', () => {
    expect(resolveThemeClass('dark')).toBe('dark');
  });

  it('returns "light" for light theme', () => {
    expect(resolveThemeClass('light')).toBe('light');
  });

  it('returns "dark" for system when OS prefers dark', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', matchMedia);
    expect(resolveThemeClass('system')).toBe('dark');
    vi.unstubAllGlobals();
  });

  it('returns "light" for system when OS prefers light', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal('matchMedia', matchMedia);
    expect(resolveThemeClass('system')).toBe('light');
    vi.unstubAllGlobals();
  });
});

describe('useThemeEffect', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    document.documentElement.classList.remove('dark');
    useUiStore.setState({ theme: 'system' });
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
    Object.defineProperty(window, 'matchMedia', { value: originalMatchMedia, writable: true });
  });

  it('applies dark class when theme is dark', () => {
    useUiStore.setState({ theme: 'dark' });
    renderHook(() => useThemeEffect());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes dark class when theme is light', () => {
    document.documentElement.classList.add('dark');
    useUiStore.setState({ theme: 'light' });
    renderHook(() => useThemeEffect());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('applies dark class for system theme when OS prefers dark', () => {
    const listeners: Array<() => void> = [];
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: (_: string, cb: () => void) => listeners.push(cb),
        removeEventListener: vi.fn(),
      }),
      writable: true,
    });

    useUiStore.setState({ theme: 'system' });
    renderHook(() => useThemeEffect());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes dark class for system theme when OS prefers light', () => {
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
      writable: true,
    });

    useUiStore.setState({ theme: 'system' });
    renderHook(() => useThemeEffect());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('reacts to theme changes in store', () => {
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
      writable: true,
    });

    useUiStore.setState({ theme: 'light' });
    renderHook(() => useThemeEffect());
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => {
      useUiStore.setState({ theme: 'dark' });
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('listens for OS preference changes when theme is system', () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: addListener,
        removeEventListener: removeListener,
      }),
      writable: true,
    });

    useUiStore.setState({ theme: 'system' });
    const { unmount } = renderHook(() => useThemeEffect());

    expect(addListener).toHaveBeenCalledWith('change', expect.any(Function));

    unmount();
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('does not listen for OS changes when theme is not system', () => {
    const addListener = vi.fn();
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: addListener,
        removeEventListener: vi.fn(),
      }),
      writable: true,
    });

    useUiStore.setState({ theme: 'dark' });
    renderHook(() => useThemeEffect());

    expect(addListener).not.toHaveBeenCalled();
  });
});
