// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useGlobalShortcuts, SHORTCUT_DEFINITIONS } from "./useGlobalShortcuts";
import { useUiStore } from "@/stores/ui";
import { useChatStore } from "@/stores/chat";

const mockNavigate = vi.fn();
let mockPathname = "/dashboard";

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname }),
}));

function fireKey(key: string, opts: Partial<KeyboardEvent> = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  document.dispatchEvent(event);
  return event;
}

describe("useGlobalShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = "/dashboard";
    useUiStore.setState({
      commandPaletteOpen: false,
      mobileSidebarOpen: false,
      activeModal: null,
    });
  });

  it("opens command palette on Cmd+K", () => {
    renderHook(() => useGlobalShortcuts());

    act(() => {
      fireKey("k", { metaKey: true });
    });

    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
  });

  it("opens command palette on Ctrl+K", () => {
    renderHook(() => useGlobalShortcuts());

    act(() => {
      fireKey("k", { ctrlKey: true });
    });

    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
  });

  it("toggles command palette on repeated Cmd+K", () => {
    renderHook(() => useGlobalShortcuts());

    act(() => fireKey("k", { metaKey: true }));
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);

    act(() => fireKey("k", { metaKey: true }));
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });

  it("closes command palette on Escape", () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderHook(() => useGlobalShortcuts());

    act(() => {
      fireKey("Escape");
    });

    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });

  it("closes mobile sidebar on Escape", () => {
    useUiStore.setState({ mobileSidebarOpen: true });
    renderHook(() => useGlobalShortcuts());

    act(() => {
      fireKey("Escape");
    });

    expect(useUiStore.getState().mobileSidebarOpen).toBe(false);
  });

  it("closes active modal on Escape", () => {
    useUiStore.setState({ activeModal: "test-modal" });
    renderHook(() => useGlobalShortcuts());

    act(() => {
      fireKey("Escape");
    });

    expect(useUiStore.getState().activeModal).toBe(null);
  });

  it("prioritises command palette close over mobile sidebar", () => {
    useUiStore.setState({ commandPaletteOpen: true, mobileSidebarOpen: true });
    renderHook(() => useGlobalShortcuts());

    act(() => {
      fireKey("Escape");
    });

    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
    expect(useUiStore.getState().mobileSidebarOpen).toBe(true);
  });

  it("creates new chat on Cmd+N and navigates to /chat", () => {
    const newSession = vi.fn();
    useChatStore.setState({ newSession } as never);
    renderHook(() => useGlobalShortcuts());

    act(() => {
      fireKey("n", { metaKey: true });
    });

    expect(newSession).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/chat");
  });

  it("creates new chat on Cmd+N without navigating if already on /chat", () => {
    mockPathname = "/chat/server-1";
    const newSession = vi.fn();
    useChatStore.setState({ newSession } as never);
    renderHook(() => useGlobalShortcuts());

    act(() => {
      fireKey("n", { metaKey: true });
    });

    expect(newSession).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not trigger Cmd+N when input is focused", () => {
    const newSession = vi.fn();
    useChatStore.setState({ newSession } as never);
    renderHook(() => useGlobalShortcuts());

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    // Simulate keydown on the focused input
    const event = new KeyboardEvent("keydown", {
      key: "n",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(newSession).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("still triggers Cmd+K even when input is focused", () => {
    renderHook(() => useGlobalShortcuts());

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    // Dispatch on document (event bubbles up)
    document.dispatchEvent(event);

    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
    document.body.removeChild(input);
  });

  it("does not trigger on plain K/N without modifier", () => {
    renderHook(() => useGlobalShortcuts());

    act(() => {
      fireKey("k");
      fireKey("n");
    });

    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("cleans up event listener on unmount", () => {
    const spy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useGlobalShortcuts());

    unmount();

    expect(spy).toHaveBeenCalledWith("keydown", expect.any(Function));
    spy.mockRestore();
  });
});

describe("SHORTCUT_DEFINITIONS", () => {
  it("exports 3 shortcut definitions", () => {
    expect(SHORTCUT_DEFINITIONS).toHaveLength(3);
  });

  it("each has keys and description", () => {
    for (const def of SHORTCUT_DEFINITIONS) {
      expect(def.keys).toBeTruthy();
      expect(def.description).toBeTruthy();
    }
  });
});
