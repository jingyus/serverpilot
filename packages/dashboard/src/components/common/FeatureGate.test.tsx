// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FeatureGate } from "./FeatureGate";
import { useSystemStore } from "@/stores/system";
import type { FeatureFlags } from "@aiinstaller/shared";

// Mock the API client (required by system store)
vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  apiRequest: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FeatureGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSystemStore.setState({
      edition: null,
      features: {},
      version: null,
      isLoading: false,
      error: null,
    });
  });

  describe("when feature is enabled (EE mode)", () => {
    beforeEach(() => setEdition("ee"));

    it("renders children for multiServer", () => {
      render(
        <FeatureGate feature="multiServer">
          <div data-testid="child">Servers Page</div>
        </FeatureGate>,
      );

      expect(screen.getByTestId("child")).toBeInTheDocument();
      expect(
        screen.queryByTestId("feature-gate-upgrade"),
      ).not.toBeInTheDocument();
    });

    it("renders children for teamCollaboration", () => {
      render(
        <FeatureGate feature="teamCollaboration">
          <div data-testid="child">Team Page</div>
        </FeatureGate>,
      );

      expect(screen.getByTestId("child")).toBeInTheDocument();
    });

    it("renders children for alerts", () => {
      render(
        <FeatureGate feature="alerts">
          <div data-testid="child">Alerts Page</div>
        </FeatureGate>,
      );

      expect(screen.getByTestId("child")).toBeInTheDocument();
    });

    it("renders children for webhooks", () => {
      render(
        <FeatureGate feature="webhooks">
          <div data-testid="child">Webhooks Page</div>
        </FeatureGate>,
      );

      expect(screen.getByTestId("child")).toBeInTheDocument();
    });

    it("renders children for auditExport", () => {
      render(
        <FeatureGate feature="auditExport">
          <div data-testid="child">Audit Log Page</div>
        </FeatureGate>,
      );

      expect(screen.getByTestId("child")).toBeInTheDocument();
    });
  });

  describe("when feature is disabled (CE mode)", () => {
    beforeEach(() => setEdition("ce"));

    it("shows upgrade card for multiServer", () => {
      render(
        <FeatureGate feature="multiServer">
          <div data-testid="child">Servers Page</div>
        </FeatureGate>,
      );

      expect(screen.queryByTestId("child")).not.toBeInTheDocument();
      expect(screen.getByTestId("feature-gate-upgrade")).toBeInTheDocument();
    });

    it("shows feature name in upgrade card", () => {
      render(
        <FeatureGate feature="multiServer">
          <div>Child</div>
        </FeatureGate>,
      );

      expect(screen.getByText("Multi-Server Management")).toBeInTheDocument();
    });

    it("shows feature description in upgrade card", () => {
      render(
        <FeatureGate feature="multiServer">
          <div>Child</div>
        </FeatureGate>,
      );

      expect(
        screen.getByText(/Manage multiple servers from a single dashboard/),
      ).toBeInTheDocument();
    });

    it("shows enterprise badge", () => {
      render(
        <FeatureGate feature="teamCollaboration">
          <div>Child</div>
        </FeatureGate>,
      );

      expect(screen.getByText("Enterprise Edition")).toBeInTheDocument();
    });

    it("shows upgrade link pointing to serverpilot.io", () => {
      render(
        <FeatureGate feature="alerts">
          <div>Child</div>
        </FeatureGate>,
      );

      const link = screen.getByTestId("feature-gate-upgrade-link");
      expect(link).toHaveAttribute("href", "https://serverpilot.io");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("shows correct content for teamCollaboration", () => {
      render(
        <FeatureGate feature="teamCollaboration">
          <div>Child</div>
        </FeatureGate>,
      );

      expect(screen.getByText("Team Collaboration")).toBeInTheDocument();
      expect(
        screen.getByText(/Invite team members, assign roles/),
      ).toBeInTheDocument();
    });

    it("shows correct content for webhooks", () => {
      render(
        <FeatureGate feature="webhooks">
          <div>Child</div>
        </FeatureGate>,
      );

      expect(screen.getByText("Webhook Notifications")).toBeInTheDocument();
    });

    it("shows correct content for auditExport", () => {
      render(
        <FeatureGate feature="auditExport">
          <div>Child</div>
        </FeatureGate>,
      );

      expect(screen.getByText("Audit Log Export")).toBeInTheDocument();
    });

    it("shows correct content for alerts", () => {
      render(
        <FeatureGate feature="alerts">
          <div>Child</div>
        </FeatureGate>,
      );

      expect(screen.getByText("Alert System")).toBeInTheDocument();
    });
  });

  describe("highlights list", () => {
    beforeEach(() => setEdition("ce"));

    it("shows highlights section for multiServer", () => {
      render(
        <FeatureGate feature="multiServer">
          <div>Child</div>
        </FeatureGate>,
      );

      const highlights = screen.getByTestId("feature-gate-highlights");
      expect(highlights).toBeInTheDocument();
      expect(screen.getByText("What you get")).toBeInTheDocument();
    });

    it("renders all highlight items for multiServer", () => {
      render(
        <FeatureGate feature="multiServer">
          <div>Child</div>
        </FeatureGate>,
      );

      const highlights = screen.getByTestId("feature-gate-highlights");
      const items = within(highlights).getAllByRole("listitem");
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent(
        "Centralized dashboard for all servers",
      );
      expect(items[1]).toHaveTextContent("Batch operations across servers");
      expect(items[2]).toHaveTextContent(
        "Server groups and tags for organization",
      );
    });

    it("renders highlights for teamCollaboration", () => {
      render(
        <FeatureGate feature="teamCollaboration">
          <div>Child</div>
        </FeatureGate>,
      );

      expect(screen.getByText("Invite members via email")).toBeInTheDocument();
      expect(screen.getByText(/Role-based access control/)).toBeInTheDocument();
      expect(screen.getByText("Team activity audit trail")).toBeInTheDocument();
    });

    it("renders highlights for alerts", () => {
      render(
        <FeatureGate feature="alerts">
          <div>Child</div>
        </FeatureGate>,
      );

      expect(
        screen.getByText("Custom alert rules per metric"),
      ).toBeInTheDocument();
    });

    it("renders highlights for webhooks", () => {
      render(
        <FeatureGate feature="webhooks">
          <div>Child</div>
        </FeatureGate>,
      );

      expect(screen.getByText("Custom webhook endpoints")).toBeInTheDocument();
    });

    it("does not show highlights section when feature is enabled", () => {
      setEdition("ee");
      render(
        <FeatureGate feature="multiServer">
          <div data-testid="child">Servers Page</div>
        </FeatureGate>,
      );

      expect(
        screen.queryByTestId("feature-gate-highlights"),
      ).not.toBeInTheDocument();
    });
  });

  describe("custom fallback", () => {
    beforeEach(() => setEdition("ce"));

    it("renders custom fallback instead of default upgrade card", () => {
      render(
        <FeatureGate
          feature="multiServer"
          fallback={<div data-testid="custom-fallback">Custom message</div>}
        >
          <div data-testid="child">Servers Page</div>
        </FeatureGate>,
      );

      expect(screen.queryByTestId("child")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("feature-gate-upgrade"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
    });

    it("ignores fallback when feature is enabled", () => {
      setEdition("ee");

      render(
        <FeatureGate
          feature="multiServer"
          fallback={<div data-testid="custom-fallback">Custom</div>}
        >
          <div data-testid="child">Servers Page</div>
        </FeatureGate>,
      );

      expect(screen.getByTestId("child")).toBeInTheDocument();
      expect(screen.queryByTestId("custom-fallback")).not.toBeInTheDocument();
    });
  });

  describe("before edition is fetched (all features false)", () => {
    it("shows upgrade card when features default to false", () => {
      // Edition not yet fetched — store is in initial state
      render(
        <FeatureGate feature="multiServer">
          <div data-testid="child">Servers Page</div>
        </FeatureGate>,
      );

      expect(screen.queryByTestId("child")).not.toBeInTheDocument();
      expect(screen.getByTestId("feature-gate-upgrade")).toBeInTheDocument();
    });
  });

  describe("CE core features (always enabled)", () => {
    beforeEach(() => setEdition("ce"));

    it("renders children for chat feature in CE mode", () => {
      render(
        <FeatureGate feature="chat">
          <div data-testid="child">Chat Page</div>
        </FeatureGate>,
      );

      expect(screen.getByTestId("child")).toBeInTheDocument();
    });

    it("renders children for knowledgeBase feature in CE mode", () => {
      render(
        <FeatureGate feature="knowledgeBase">
          <div data-testid="child">Knowledge Base</div>
        </FeatureGate>,
      );

      expect(screen.getByTestId("child")).toBeInTheDocument();
    });
  });
});
