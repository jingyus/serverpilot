// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Server,
  MessageCircle,
  ListChecks,
  History,
  Bell,
  Inbox,
  Shield,
  Settings,
  BookOpen,
  Webhook,
  Puzzle,
  Users,
  Search,
  Plus,
  BarChart3,
  CreditCard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useUiStore } from "@/stores/ui";
import { useChatStore } from "@/stores/chat";
import { useFeatures } from "@/hooks/useFeatures";
import type { FeatureKey } from "@/hooks/useFeatures";
import { cn } from "@/lib/utils";

interface CommandItem {
  id: string;
  label: string;
  icon: LucideIcon;
  action: () => void;
  /** Searchable keywords (beyond label) */
  keywords?: string[];
  /** When set, the item is only shown if this feature flag is enabled. */
  featureKey?: FeatureKey;
}

function useCommandItems(): CommandItem[] {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const close = useUiStore((s) => s.setCommandPaletteOpen);
  const { features } = useFeatures();

  return useMemo(() => {
    const go = (path: string) => () => {
      close(false);
      navigate(path);
    };

    const items: CommandItem[] = [
      {
        id: "new-chat",
        label: t("commandPalette.newChat", "New Chat"),
        icon: Plus,
        action: () => {
          close(false);
          useChatStore.getState().newSession();
          navigate("/chat");
        },
        keywords: ["create", "session"],
      },
      {
        id: "nav-dashboard",
        label: t("nav.dashboard", "Dashboard"),
        icon: LayoutDashboard,
        action: go("/dashboard"),
        keywords: ["home", "overview"],
        featureKey: "multiServer",
      },
      {
        id: "nav-servers",
        label: t("nav.servers", "Servers"),
        icon: Server,
        action: go("/servers"),
        keywords: ["host", "machine"],
        featureKey: "multiServer",
      },
      {
        id: "nav-chat",
        label: t("nav.aiChat", "AI Chat"),
        icon: MessageCircle,
        action: go("/chat"),
        keywords: ["conversation", "ai"],
      },
      {
        id: "nav-search",
        label: t("nav.knowledge", "Knowledge"),
        icon: BookOpen,
        action: go("/search"),
        keywords: ["docs", "documentation"],
      },
      {
        id: "nav-tasks",
        label: t("nav.tasks", "Tasks"),
        icon: ListChecks,
        action: go("/tasks"),
        keywords: ["jobs", "queue"],
      },
      {
        id: "nav-operations",
        label: t("nav.operations", "Operations"),
        icon: History,
        action: go("/operations"),
        keywords: ["history", "log"],
      },
      {
        id: "nav-alerts",
        label: t("nav.alerts", "Alerts"),
        icon: Bell,
        action: go("/alerts"),
        keywords: ["warning", "monitor"],
        featureKey: "alerts",
      },
      {
        id: "nav-notifications",
        label: t("nav.notifications", "Notifications"),
        icon: Inbox,
        action: go("/notifications"),
        keywords: ["messages", "inbox"],
      },
      {
        id: "nav-audit-log",
        label: t("nav.auditLog", "Audit Log"),
        icon: Shield,
        action: go("/audit-log"),
        keywords: ["security", "audit"],
        featureKey: "auditExport",
      },
      {
        id: "nav-webhooks",
        label: t("nav.webhooks", "Webhooks"),
        icon: Webhook,
        action: go("/webhooks"),
        keywords: ["hooks", "events"],
        featureKey: "webhooks",
      },
      {
        id: "nav-skills",
        label: t("nav.skills", "Skills"),
        icon: Puzzle,
        action: go("/skills"),
        keywords: ["plugins", "extensions"],
      },
      {
        id: "nav-team",
        label: t("nav.team", "Team"),
        icon: Users,
        action: go("/team"),
        keywords: ["members", "invitation"],
        featureKey: "teamCollaboration",
      },
      {
        id: "nav-usage",
        label: t("nav.usage", "使用量"),
        icon: BarChart3,
        action: go("/usage"),
        keywords: ["usage", "quota", "AI"],
      },
      {
        id: "nav-billing",
        label: t("nav.billing", "计费"),
        icon: CreditCard,
        action: go("/billing"),
        keywords: ["billing", "subscription", "plan"],
      },
      {
        id: "nav-settings",
        label: t("nav.settings", "Settings"),
        icon: Settings,
        action: go("/settings"),
        keywords: ["preferences", "config"],
      },
    ];
    return items.filter(
      (item) => !item.featureKey || features[item.featureKey],
    );
  }, [navigate, close, t, features]);
}

function filterItems(items: CommandItem[], query: string): CommandItem[] {
  if (!query.trim()) return items;
  const lower = query.toLowerCase();
  return items.filter((item) => {
    if (item.label.toLowerCase().includes(lower)) return true;
    return item.keywords?.some((kw) => kw.includes(lower)) ?? false;
  });
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allItems = useCommandItems();
  const filtered = useMemo(
    () => filterItems(allItems, query),
    [allItems, query],
  );

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Focus input on next frame (after render)
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep selectedIndex in bounds
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % Math.max(filtered.length, 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex(
            (i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1),
          );
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[selectedIndex]) {
            filtered[selectedIndex].action();
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [filtered, selectedIndex, setOpen],
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/50"
        onClick={() => setOpen(false)}
        data-testid="command-palette-backdrop"
        aria-hidden="true"
      />

      {/* Palette */}
      <div
        className="fixed left-1/2 top-[20%] z-[61] w-full max-w-lg -translate-x-1/2 rounded-lg border bg-background shadow-2xl"
        role="dialog"
        aria-label="Command palette"
        data-testid="command-palette"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            data-testid="command-palette-input"
            aria-label="Search commands"
          />
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[300px] overflow-y-auto p-2"
          role="listbox"
          data-testid="command-palette-list"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No results found.
            </div>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon;
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-selected={isSelected}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent/50",
                  )}
                  data-testid={`command-item-${item.id}`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{item.label}</span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t px-4 py-2 text-[10px] text-muted-foreground">
          <span>
            Navigate with <kbd className="rounded border bg-muted px-1">↑↓</kbd>
          </span>
          <span>
            Select with <kbd className="rounded border bg-muted px-1">↵</kbd>
          </span>
        </div>
      </div>
    </>
  );
}
