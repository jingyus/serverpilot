// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Accessibility (a11y) tests — WCAG 2.1 AA compliance verification.
 *
 * Validates ARIA labels, roles, and semantic HTML across core components.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sidebar } from "./layout/Sidebar";
import { Header } from "./layout/Header";
import { ConnectionStatus } from "./common/ConnectionStatus";
import { SkillCard } from "./skill/SkillCard";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { useWebSocketStore } from "@/stores/websocket";
import { useAlertsStore } from "@/stores/alerts";
import { useWebhooksStore } from "@/stores/webhooks";
import type { InstalledSkill } from "@/types/skill";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

function mockDesktop() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query === "(min-width: 1024px)",
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function mockMobile() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe("Accessibility (a11y)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDesktop();
    useAuthStore.setState({
      user: { id: "1", email: "test@example.com", name: "Test User" },
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
    useUiStore.setState({ sidebarCollapsed: false, mobileSidebarOpen: false });
    useWebSocketStore.setState({ status: "connected" });
    useAlertsStore.setState({ unresolvedCount: 0 });
  });

  describe("Sidebar", () => {
    it('has role="navigation" on the aside element', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>,
      );
      const aside = screen.getByTestId("sidebar");
      expect(aside).toHaveAttribute("role", "navigation");
    });

    it("has aria-label on the aside element", () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>,
      );
      const aside = screen.getByTestId("sidebar");
      expect(aside).toHaveAttribute("aria-label", "Main navigation");
    });

    it("has aria-label on nav links when sidebar is collapsed", () => {
      useUiStore.setState({ sidebarCollapsed: true });
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>,
      );
      const links = screen.getAllByRole("link");
      for (const link of links) {
        expect(link).toHaveAttribute("aria-label");
      }
    });

    it("logout button has aria-label", () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>,
      );
      const logoutBtn = screen.getByRole("button", { name: "Logout" });
      expect(logoutBtn).toHaveAttribute("aria-label", "Logout");
    });

    it("collapse button has descriptive aria-label", () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>,
      );
      const collapseBtn = screen.getByRole("button", {
        name: "Collapse sidebar",
      });
      expect(collapseBtn).toBeInTheDocument();
    });

    it("expand button has descriptive aria-label when collapsed", () => {
      useUiStore.setState({ sidebarCollapsed: true });
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>,
      );
      const expandBtn = screen.getByRole("button", {
        name: "Expand sidebar",
      });
      expect(expandBtn).toBeInTheDocument();
    });

    it("mobile close button has aria-label", () => {
      mockMobile();
      useUiStore.setState({ mobileSidebarOpen: true });
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>,
      );
      const closeBtn = screen.getByRole("button", {
        name: "Close sidebar",
      });
      expect(closeBtn).toBeInTheDocument();
    });
  });

  describe("Header", () => {
    it('has role="banner" on the header element', () => {
      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>,
      );
      const header = screen.getByTestId("header");
      expect(header).toHaveAttribute("role", "banner");
    });

    it("user dropdown trigger is accessible", () => {
      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>,
      );
      // User avatar is now in a dropdown trigger button
      const userButton =
        screen.getByRole("button", { name: /Test User/i }) ||
        screen.getByText("Test User");
      expect(userButton).toBeInTheDocument();
    });

    it("alert badge has aria-label with count when alerts exist", () => {
      useAlertsStore.setState({ unresolvedCount: 5 });
      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>,
      );
      const badge = screen.getByTestId("alert-count-badge");
      expect(badge).toHaveAttribute("aria-label", "5 unresolved alerts");
    });

    it("notifications button has aria-label", () => {
      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>,
      );
      const btn = screen.getByRole("button", { name: "Notifications" });
      expect(btn).toBeInTheDocument();
    });

    it("theme toggle button has aria-label", () => {
      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>,
      );
      const btn = screen.getByTestId("theme-toggle");
      expect(btn).toHaveAttribute("aria-label");
    });

    it("mobile sidebar toggle has aria-label", () => {
      mockMobile();
      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>,
      );
      const btn = screen.getByRole("button", { name: "Toggle sidebar" });
      expect(btn).toBeInTheDocument();
    });

    it("all icon-only buttons in header have aria-label", () => {
      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>,
      );
      const buttons = screen.getAllByRole("button");
      for (const button of buttons) {
        // Buttons with visible text don't need aria-label (like user dropdown trigger)
        const hasVisibleText =
          button.textContent && button.textContent.trim().length > 0;
        if (!hasVisibleText) {
          expect(button).toHaveAttribute("aria-label");
        }
      }
    });
  });

  describe("ConnectionStatus", () => {
    it('has role="status" for live region', () => {
      render(<ConnectionStatus />);
      const container = screen.getByRole("status");
      expect(container).toBeInTheDocument();
    });

    it('indicator dot has aria-hidden="true"', () => {
      render(<ConnectionStatus />);
      const dot = screen.getByTestId("connection-indicator");
      expect(dot).toHaveAttribute("aria-hidden", "true");
    });

    it("has descriptive aria-label on status container", () => {
      useWebSocketStore.setState({ status: "connected" });
      render(<ConnectionStatus />);
      const container = screen.getByRole("status");
      expect(container).toHaveAttribute("aria-label", "WebSocket: Connected");
    });
  });

  describe("SkillCard", () => {
    const baseSkill: InstalledSkill = {
      id: "skill-1",
      userId: "user-1",
      tenantId: null,
      name: "test-skill",
      displayName: "Test Skill",
      version: "1.0.0",
      status: "enabled",
      source: "official",
      skillPath: "/skills/test-skill",
      config: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it("all icon-only buttons have aria-label instead of just title", () => {
      render(
        <SkillCard
          skill={baseSkill}
          onToggle={vi.fn()}
          onConfigure={vi.fn()}
          onExecute={vi.fn()}
          onUninstall={vi.fn()}
        />,
      );

      // Execute, Toggle, Configure, Uninstall buttons should all have aria-label
      const buttons = screen.getAllByRole("button");
      for (const button of buttons) {
        expect(button).toHaveAttribute("aria-label");
      }
    });

    it("toggle button reflects enabled/paused state in aria-label", () => {
      render(
        <SkillCard
          skill={baseSkill}
          onToggle={vi.fn()}
          onConfigure={vi.fn()}
          onExecute={vi.fn()}
          onUninstall={vi.fn()}
        />,
      );
      // When enabled, the toggle should say "Pause"
      expect(
        screen.getByRole("button", { name: /pause/i }),
      ).toBeInTheDocument();
    });
  });

  describe("WebhookCard", () => {
    const enabledWebhook = {
      id: "wh-1",
      name: "Test Hook",
      url: "https://example.com/hook",
      events: ["task.completed" as const],
      enabled: true,
      secret: "***",
      userId: "user-1",
      tenantId: null,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    beforeEach(() => {
      // Set fetchWebhooks to a no-op so useEffect doesn't trigger API calls
      useWebhooksStore.setState({
        webhooks: [enabledWebhook],
        isLoading: false,
        error: null,
        fetchWebhooks: vi.fn() as unknown as () => Promise<void>,
      });
    });

    // Lazy-import Webhooks to avoid module-level store access issues
    async function renderWebhooks() {
      const { Webhooks } = await import("@/pages/Webhooks");
      return render(
        <MemoryRouter>
          <Webhooks />
        </MemoryRouter>,
      );
    }

    it("all webhook card icon-only buttons have aria-label", async () => {
      await renderWebhooks();
      // The 4 action buttons in the webhook card: test, toggle, edit, delete
      expect(
        screen.getByRole("button", { name: /send test event/i }),
      ).toHaveAttribute("aria-label");
      expect(
        screen.getByRole("button", { name: /disable webhook/i }),
      ).toHaveAttribute("aria-label");
      expect(
        screen.getByRole("button", { name: /edit webhook/i }),
      ).toHaveAttribute("aria-label");
      expect(
        screen.getByRole("button", { name: /delete webhook/i }),
      ).toHaveAttribute("aria-label");
    });

    it("toggle button says Disable when webhook is enabled", async () => {
      await renderWebhooks();
      const disableBtn = screen.getByRole("button", {
        name: /disable webhook/i,
      });
      expect(disableBtn).toBeInTheDocument();
    });

    it("toggle button says Enable when webhook is disabled", async () => {
      useWebhooksStore.setState({
        webhooks: [{ ...enabledWebhook, id: "wh-2", enabled: false }],
        isLoading: false,
        error: null,
        fetchWebhooks: vi.fn() as unknown as () => Promise<void>,
      });
      await renderWebhooks();
      const enableBtn = screen.getByRole("button", {
        name: /enable webhook/i,
      });
      expect(enableBtn).toBeInTheDocument();
    });

    it("send test, edit, delete buttons have descriptive labels", async () => {
      await renderWebhooks();
      expect(
        screen.getByRole("button", { name: /send test event/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /edit webhook/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /delete webhook/i }),
      ).toBeInTheDocument();
    });
  });
});
