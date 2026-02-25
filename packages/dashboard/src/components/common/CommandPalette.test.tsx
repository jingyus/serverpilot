// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandPalette } from "./CommandPalette";
import { useUiStore } from "@/stores/ui";
import { useSystemStore } from "@/stores/system";
import type { FeatureFlags } from "@aiinstaller/shared";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => mockNavigate };
});

const CE_FEATURES: FeatureFlags = {
  chat: true,
  commandExecution: true,
  knowledgeBase: true,
  multiServer: false,
  multiSession: false,
  teamCollaboration: false,
  webhooks: false,
  alerts: false,
  metricsMonitoring: false,
  auditExport: false,
  oauthLogin: false,
  rateLimiting: false,
  multiTenant: false,
  billing: false,
};

const EE_FEATURES: FeatureFlags = {
  chat: true,
  commandExecution: true,
  knowledgeBase: true,
  multiServer: true,
  multiSession: true,
  teamCollaboration: true,
  webhooks: true,
  alerts: true,
  metricsMonitoring: true,
  auditExport: true,
  oauthLogin: true,
  rateLimiting: true,
  multiTenant: false,
  billing: false,
};

function setEdition(edition: "ce" | "ee") {
  useSystemStore.setState({
    edition,
    features: edition === "ce" ? CE_FEATURES : EE_FEATURES,
    isLoading: false,
    error: null,
  });
}

function renderPalette() {
  return render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );
}

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ commandPaletteOpen: false });
    // Default to EE mode so existing tests keep working
    setEdition("ee");
  });

  it("renders nothing when closed", () => {
    renderPalette();
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
  });

  it("renders palette when open", () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderPalette();
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
    expect(screen.getByTestId("command-palette-input")).toBeInTheDocument();
  });

  it("shows all navigation items when no query", () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderPalette();
    const list = screen.getByTestId("command-palette-list");
    // At least the nav items + new chat
    const buttons = within(list).getAllByRole("option");
    expect(buttons.length).toBeGreaterThanOrEqual(14);
  });

  it("filters items by query", async () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderPalette();
    const user = userEvent.setup();

    const input = screen.getByTestId("command-palette-input");
    await user.type(input, "dash");

    const list = screen.getByTestId("command-palette-list");
    const items = within(list).getAllByRole("option");
    expect(items.length).toBe(1);
    expect(items[0]).toHaveTextContent("Dashboard");
  });

  it("filters by keywords", async () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderPalette();
    const user = userEvent.setup();

    const input = screen.getByTestId("command-palette-input");
    await user.type(input, "host");

    const list = screen.getByTestId("command-palette-list");
    const items = within(list).getAllByRole("option");
    expect(items.length).toBe(1);
    expect(items[0]).toHaveTextContent("Servers");
  });

  it('shows "No results" for unmatched query', async () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderPalette();
    const user = userEvent.setup();

    const input = screen.getByTestId("command-palette-input");
    await user.type(input, "zzzzzzzzzzz");

    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  it("closes on backdrop click", async () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderPalette();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("command-palette-backdrop"));
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });

  it("closes on Escape key", async () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderPalette();
    const user = userEvent.setup();

    const input = screen.getByTestId("command-palette-input");
    await user.type(input, "{Escape}");

    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });

  it("navigates on Enter", async () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderPalette();
    const user = userEvent.setup();

    // Type to filter to a single item
    const input = screen.getByTestId("command-palette-input");
    await user.type(input, "dash");

    // Press Enter
    await user.keyboard("{Enter}");

    expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });

  it("navigates items with arrow keys", async () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderPalette();
    const user = userEvent.setup();

    const input = screen.getByTestId("command-palette-input");
    // First item should be selected by default
    const list = screen.getByTestId("command-palette-list");
    const firstItem = within(list).getAllByRole("option")[0];
    expect(firstItem).toHaveAttribute("data-selected", "true");

    // Arrow down
    await user.type(input, "{ArrowDown}");
    const secondItem = within(list).getAllByRole("option")[1];
    expect(secondItem).toHaveAttribute("data-selected", "true");

    // Arrow up back to first
    await user.type(input, "{ArrowUp}");
    expect(within(list).getAllByRole("option")[0]).toHaveAttribute(
      "data-selected",
      "true",
    );
  });

  it("selects item on click", async () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderPalette();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("command-item-nav-settings"));

    expect(mockNavigate).toHaveBeenCalledWith("/settings");
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });

  it("highlights item on mouse hover", async () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderPalette();
    const user = userEvent.setup();

    const settingsItem = screen.getByTestId("command-item-nav-settings");
    await user.hover(settingsItem);

    expect(settingsItem).toHaveAttribute("data-selected", "true");
  });

  it("New Chat item calls newSession and navigates", async () => {
    useUiStore.setState({ commandPaletteOpen: true });
    renderPalette();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("command-item-new-chat"));

    expect(mockNavigate).toHaveBeenCalledWith("/chat");
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });

  describe("Edition-aware filtering", () => {
    const EE_ONLY_IDS = [
      "command-item-nav-dashboard",
      "command-item-nav-servers",
      "command-item-nav-alerts",
      "command-item-nav-audit-log",
      "command-item-nav-webhooks",
      "command-item-nav-team",
    ];

    const CE_VISIBLE_IDS = [
      "command-item-new-chat",
      "command-item-nav-chat",
      "command-item-nav-search",
      "command-item-nav-tasks",
      "command-item-nav-operations",
      "command-item-nav-notifications",
      "command-item-nav-skills",
      "command-item-nav-settings",
    ];

    it("CE mode hides EE-only commands", () => {
      setEdition("ce");
      useUiStore.setState({ commandPaletteOpen: true });
      renderPalette();

      for (const id of EE_ONLY_IDS) {
        expect(screen.queryByTestId(id)).not.toBeInTheDocument();
      }
    });

    it("CE mode shows CE commands", () => {
      setEdition("ce");
      useUiStore.setState({ commandPaletteOpen: true });
      renderPalette();

      for (const id of CE_VISIBLE_IDS) {
        expect(screen.getByTestId(id)).toBeInTheDocument();
      }
    });

    it("CE mode shows exactly 10 items", () => {
      setEdition("ce");
      useUiStore.setState({ commandPaletteOpen: true });
      renderPalette();

      const list = screen.getByTestId("command-palette-list");
      const items = within(list).getAllByRole("option");
      expect(items).toHaveLength(10);
    });

    it("EE mode shows all 16 items", () => {
      setEdition("ee");
      useUiStore.setState({ commandPaletteOpen: true });
      renderPalette();

      const list = screen.getByTestId("command-palette-list");
      const items = within(list).getAllByRole("option");
      expect(items).toHaveLength(16);
    });

    it("EE mode shows EE-only commands", () => {
      setEdition("ee");
      useUiStore.setState({ commandPaletteOpen: true });
      renderPalette();

      for (const id of EE_ONLY_IDS) {
        expect(screen.getByTestId(id)).toBeInTheDocument();
      }
    });

    it("CE mode search does not find hidden EE commands", async () => {
      setEdition("ce");
      useUiStore.setState({ commandPaletteOpen: true });
      renderPalette();
      const user = userEvent.setup();

      const input = screen.getByTestId("command-palette-input");
      await user.type(input, "team");

      expect(screen.getByText("No results found.")).toBeInTheDocument();
    });

    it("CE mode search for 'host' keyword returns no results (Servers hidden)", async () => {
      setEdition("ce");
      useUiStore.setState({ commandPaletteOpen: true });
      renderPalette();
      const user = userEvent.setup();

      const input = screen.getByTestId("command-palette-input");
      await user.type(input, "host");

      expect(screen.getByText("No results found.")).toBeInTheDocument();
    });
  });
});
