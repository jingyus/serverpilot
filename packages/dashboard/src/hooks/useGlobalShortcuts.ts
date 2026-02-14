// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useUiStore } from "@/stores/ui";
import { useChatStore } from "@/stores/chat";

/** Elements where keyboard shortcuts should not fire */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export interface ShortcutDefinition {
  /** Human-readable key combo, e.g. "Cmd+K" */
  keys: string;
  /** Description shown in settings */
  description: string;
}

/** All registered shortcuts for display in Settings */
export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { keys: "⌘/Ctrl + K", description: "Open command palette" },
  { keys: "⌘/Ctrl + N", description: "New chat session" },
  { keys: "Escape", description: "Close dialog / panel" },
];

/**
 * Global keyboard shortcut handler. Mount once in MainLayout.
 *
 * - Cmd/Ctrl+K: toggle command palette
 * - Cmd/Ctrl+N: new chat session (navigate to /chat)
 * - Escape: close command palette, mobile sidebar, or active modal
 */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // --- Cmd/Ctrl + K: Command Palette (always, even in inputs) ---
      if (meta && e.key === "k") {
        e.preventDefault();
        useUiStore.getState().toggleCommandPalette();
        return;
      }

      // --- Escape: close overlays ---
      if (e.key === "Escape") {
        const ui = useUiStore.getState();
        if (ui.commandPaletteOpen) {
          e.preventDefault();
          ui.setCommandPaletteOpen(false);
          return;
        }
        if (ui.mobileSidebarOpen) {
          e.preventDefault();
          ui.setMobileSidebarOpen(false);
          return;
        }
        if (ui.activeModal) {
          e.preventDefault();
          ui.closeModal();
          return;
        }
        return;
      }

      // Skip remaining shortcuts when inside editable elements
      if (isEditableTarget(e.target)) return;

      // --- Cmd/Ctrl + N: New Chat ---
      if (meta && e.key === "n") {
        e.preventDefault();
        useChatStore.getState().newSession();
        if (!pathname.startsWith("/chat")) {
          navigate("/chat");
        }
        return;
      }
    },
    [navigate, pathname],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
