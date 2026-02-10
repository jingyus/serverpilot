import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMediaQuery, useIsMobile } from './useMediaQuery';

function createMockMatchMedia(defaultMatches: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];

  const mql = {
    matches: defaultMatches,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
      listeners.push(handler);
    },
    removeEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
      const idx = listeners.indexOf(handler);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    dispatchEvent: () => false,
  };

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => {
      mql.media = query;
      return mql;
    },
  });

  return {
    setMatches: (matches: boolean) => {
      mql.matches = matches;
      for (const listener of listeners) {
        listener({ matches, media: mql.media } as MediaQueryListEvent);
      }
    },
  };
}

describe('useMediaQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns initial match state', () => {
    createMockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(true);
  });

  it('returns false when query does not match', () => {
    createMockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(false);
  });

  it('updates when media query changes', () => {
    const mock = createMockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));

    expect(result.current).toBe(false);

    act(() => {
      mock.setMatches(true);
    });

    expect(result.current).toBe(true);
  });

  it('cleans up listener on unmount', () => {
    const removeSpy = vi.fn();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: removeSpy,
        dispatchEvent: () => false,
      }),
    });

    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });
});

describe('useIsMobile', () => {
  it('returns true when screen is smaller than 1024px', () => {
    createMockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns false when screen is 1024px or wider', () => {
    createMockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});
