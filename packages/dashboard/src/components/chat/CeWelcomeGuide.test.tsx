// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CeWelcomeGuide,
  isGuideDismissed,
  markGuideDismissed,
} from "./CeWelcomeGuide";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "ceGuide.title": "Welcome to ServerPilot",
        "ceGuide.subtitle":
          "Install the agent on this machine to start managing it with AI.",
        "ceGuide.step1Title": "Install the Agent",
        "ceGuide.step1Desc":
          "Run the following command on your server to install the ServerPilot agent:",
        "ceGuide.step2Title": "Wait for Connection",
        "ceGuide.step2Desc":
          "The agent will automatically connect to this dashboard once installed.",
        "ceGuide.step3Title": "Start Chatting",
        "ceGuide.step3Desc":
          "Ask the AI assistant to install software, configure services, or troubleshoot issues.",
        "ceGuide.checkConnection": "Check Connection",
        "ceGuide.dismiss": "Dismiss",
        "ceGuide.retry": "Retry Connection",
        "ceGuide.offlineTitle": "Agent Offline",
        "ceGuide.offlineDesc":
          "The ServerPilot agent on your server appears to be disconnected.",
      };
      return translations[key] ?? key;
    },
  }),
}));

describe("CeWelcomeGuide", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("no-server variant", () => {
    it("renders welcome guide with install command", () => {
      const onRetry = vi.fn();
      render(<CeWelcomeGuide variant="no-server" onRetry={onRetry} />);

      expect(screen.getByTestId("ce-welcome-guide")).toBeInTheDocument();
      expect(screen.getByText("Welcome to ServerPilot")).toBeInTheDocument();
      expect(screen.getByText("Install the Agent")).toBeInTheDocument();
      expect(screen.getByText("Wait for Connection")).toBeInTheDocument();
      expect(screen.getByText("Start Chatting")).toBeInTheDocument();
    });

    it("shows install command text", () => {
      const onRetry = vi.fn();
      render(<CeWelcomeGuide variant="no-server" onRetry={onRetry} />);

      const commandEl = screen.getByTestId("install-command");
      expect(commandEl.textContent).toContain(
        "curl -fsSL https://get.serverpilot.io | bash",
      );
    });

    it("copies install command on button click", async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        writable: true,
        configurable: true,
      });

      render(<CeWelcomeGuide variant="no-server" onRetry={vi.fn()} />);
      await user.click(screen.getByTestId("copy-install-command"));

      expect(writeText).toHaveBeenCalledWith(
        "curl -fsSL https://get.serverpilot.io | bash",
      );
    });

    it("calls onRetry when check connection button is clicked", async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      render(<CeWelcomeGuide variant="no-server" onRetry={onRetry} />);

      await user.click(screen.getByTestId("ce-check-connection"));
      expect(onRetry).toHaveBeenCalledOnce();
    });

    it("calls onDismiss when dismiss button is clicked", async () => {
      const user = userEvent.setup();
      const onDismiss = vi.fn();
      render(
        <CeWelcomeGuide
          variant="no-server"
          onRetry={vi.fn()}
          onDismiss={onDismiss}
        />,
      );

      await user.click(screen.getByTestId("ce-dismiss-guide"));
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it("does not show dismiss button when onDismiss is not provided", () => {
      render(<CeWelcomeGuide variant="no-server" onRetry={vi.fn()} />);
      expect(screen.queryByTestId("ce-dismiss-guide")).not.toBeInTheDocument();
    });

    it("shows three numbered steps", () => {
      render(<CeWelcomeGuide variant="no-server" onRetry={vi.fn()} />);
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  describe("offline variant", () => {
    it("renders offline prompt", () => {
      const onRetry = vi.fn();
      render(<CeWelcomeGuide variant="offline" onRetry={onRetry} />);

      expect(screen.getByTestId("ce-agent-offline")).toBeInTheDocument();
      expect(screen.getByText("Agent Offline")).toBeInTheDocument();
    });

    it("calls onRetry when retry button is clicked", async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      render(<CeWelcomeGuide variant="offline" onRetry={onRetry} />);

      await user.click(screen.getByTestId("ce-retry-connection"));
      expect(onRetry).toHaveBeenCalledOnce();
    });

    it("does not show install command in offline variant", () => {
      render(<CeWelcomeGuide variant="offline" onRetry={vi.fn()} />);
      expect(screen.queryByTestId("install-command")).not.toBeInTheDocument();
    });
  });

  describe("localStorage helpers", () => {
    afterEach(() => {
      localStorage.clear();
    });

    it("isGuideDismissed returns false when not set", () => {
      expect(isGuideDismissed()).toBe(false);
    });

    it("markGuideDismissed sets the localStorage flag", () => {
      markGuideDismissed();
      expect(isGuideDismissed()).toBe(true);
    });

    it("isGuideDismissed returns true after markGuideDismissed", () => {
      markGuideDismissed();
      expect(isGuideDismissed()).toBe(true);
      expect(localStorage.getItem("ce_welcome_guide_dismissed")).toBe("true");
    });
  });
});
