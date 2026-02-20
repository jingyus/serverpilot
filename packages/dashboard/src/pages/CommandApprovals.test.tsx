// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandApprovals } from "./CommandApprovals";
import { useCommandApprovalsStore } from "@/stores/command-approvals";
import type { CommandApproval } from "@/types/command-approval";

const mockApprovals: CommandApproval[] = [
  {
    id: "approval-1",
    userId: "user-1",
    serverId: "server-1",
    command: "rm -rf /tmp/old_*",
    riskLevel: "red",
    status: "pending",
    reason: "Recursive file deletion in /tmp",
    warnings: ["Recursive deletion", "Directory operation"],
    requestedAt: "2026-02-20T10:00:00Z",
    expiresAt: "2026-02-20T10:05:00Z",
    decidedAt: null,
    decidedBy: null,
    executionContext: { sessionId: "session-1" },
  },
  {
    id: "approval-2",
    userId: "user-1",
    serverId: "server-2",
    command: "dd if=/dev/zero of=/dev/sda",
    riskLevel: "critical",
    status: "approved",
    reason: "Disk write operation",
    warnings: ["Overwrites disk data"],
    requestedAt: "2026-02-20T09:00:00Z",
    expiresAt: "2026-02-20T09:05:00Z",
    decidedAt: "2026-02-20T09:02:00Z",
    decidedBy: "user-1",
    executionContext: { taskId: "task-1" },
  },
];

function renderCommandApprovals() {
  return render(
    <MemoryRouter>
      <CommandApprovals />
    </MemoryRouter>,
  );
}

function setupStore(
  overrides: Partial<ReturnType<typeof useCommandApprovalsStore.getState>> = {},
) {
  useCommandApprovalsStore.setState({
    approvals: mockApprovals,
    isLoading: false,
    error: null,
    sseConnection: null,
    fetchApprovals: vi.fn().mockResolvedValue(undefined),
    approveCommand: vi.fn().mockResolvedValue(undefined),
    rejectCommand: vi.fn().mockResolvedValue(undefined),
    startSSE: vi.fn(),
    stopSSE: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  });
}

describe("CommandApprovals Page", () => {
  beforeEach(() => {
    setupStore();
  });

  it("should render the page title", () => {
    renderCommandApprovals();
    expect(screen.getByText(/Command Approvals/i)).toBeInTheDocument();
  });

  it("should call fetchApprovals on mount", () => {
    const fetchApprovals = vi.fn().mockResolvedValue(undefined);
    setupStore({ fetchApprovals });

    renderCommandApprovals();

    expect(fetchApprovals).toHaveBeenCalled();
  });

  it("should start SSE on mount and stop on unmount", () => {
    const startSSE = vi.fn();
    const stopSSE = vi.fn();
    setupStore({ startSSE, stopSSE });

    const { unmount } = renderCommandApprovals();

    expect(startSSE).toHaveBeenCalled();

    unmount();

    expect(stopSSE).toHaveBeenCalled();
  });

  it("should render pending approvals section", () => {
    renderCommandApprovals();
    expect(screen.getByText(/Pending Approvals/i)).toBeInTheDocument();
  });

  it("should render pending approval card with command", () => {
    renderCommandApprovals();
    expect(screen.getByText("rm -rf /tmp/old_*")).toBeInTheDocument();
  });

  it("should render risk level badge", () => {
    renderCommandApprovals();
    expect(screen.getByText("High Risk")).toBeInTheDocument();
  });

  it("should render history section", () => {
    renderCommandApprovals();
    expect(screen.getByText(/History/i)).toBeInTheDocument();
  });

  it("should render approved command in history", () => {
    renderCommandApprovals();
    expect(screen.getByText("dd if=/dev/zero of=/dev/sda")).toBeInTheDocument();
  });

  it("should show loading spinner when loading", () => {
    setupStore({ isLoading: true });
    renderCommandApprovals();
    const loader = document.querySelector(".animate-spin");
    expect(loader).toBeInTheDocument();
  });

  it("should show error message when error exists", () => {
    const error = "Failed to load approvals";
    setupStore({ error });
    renderCommandApprovals();
    expect(screen.getByText(error)).toBeInTheDocument();
  });

  it("should clear error when dismiss button clicked", async () => {
    const user = userEvent.setup();
    const clearError = vi.fn();
    setupStore({ error: "Some error", clearError });

    renderCommandApprovals();

    const dismissButton = screen.getByText(/Dismiss/i);
    await user.click(dismissButton);

    expect(clearError).toHaveBeenCalled();
  });

  it("should show empty state when no pending approvals", () => {
    setupStore({ approvals: [] });
    renderCommandApprovals();
    expect(screen.getByText(/No pending approvals/i)).toBeInTheDocument();
  });

  it("should call approveCommand when approve button clicked", async () => {
    const user = userEvent.setup();
    const approveCommand = vi.fn().mockResolvedValue(undefined);
    setupStore({ approveCommand });

    renderCommandApprovals();

    const approveButtons = screen.getAllByRole("button", { name: /Approve/i });
    await user.click(approveButtons[0]);

    expect(approveCommand).toHaveBeenCalledWith("approval-1");
  });

  it("should call rejectCommand when reject button clicked", async () => {
    const user = userEvent.setup();
    const rejectCommand = vi.fn().mockResolvedValue(undefined);
    setupStore({ rejectCommand });

    renderCommandApprovals();

    const rejectButtons = screen.getAllByRole("button", { name: /Reject/i });
    await user.click(rejectButtons[0]);

    expect(rejectCommand).toHaveBeenCalledWith("approval-1");
  });

  it("should open details dialog when view button clicked", async () => {
    const user = userEvent.setup();
    renderCommandApprovals();

    const viewButtons = screen.getAllByRole("button", { name: /View/i });
    await user.click(viewButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Command Approval Details/i)).toBeInTheDocument();
    });
  });

  it("should close details dialog when cancel button clicked", async () => {
    const user = userEvent.setup();
    renderCommandApprovals();

    // Open dialog
    const viewButtons = screen.getAllByRole("button", { name: /View/i });
    await user.click(viewButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Command Approval Details/i)).toBeInTheDocument();
    });

    // Close dialog
    const cancelButton = screen.getByRole("button", { name: /Cancel/i });
    await user.click(cancelButton);

    await waitFor(() => {
      expect(
        screen.queryByText(/Command Approval Details/i),
      ).not.toBeInTheDocument();
    });
  });

  it("should show warnings in approval card", () => {
    renderCommandApprovals();
    expect(screen.getByText("Recursive deletion")).toBeInTheDocument();
    expect(screen.getByText("Directory operation")).toBeInTheDocument();
  });

  it("should show reason in approval card", () => {
    renderCommandApprovals();
    expect(
      screen.getByText("Recursive file deletion in /tmp"),
    ).toBeInTheDocument();
  });

  it("should disable approve/reject buttons while deciding", async () => {
    const user = userEvent.setup();
    let resolveApprove: ((v: void) => void) | undefined;
    const approveCommand = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveApprove = resolve;
        }),
    );
    setupStore({ approveCommand });

    renderCommandApprovals();

    const buttons = screen.getAllByRole("button", { name: /Approve/i });
    const firstApproveButton = buttons[0];
    await user.click(firstApproveButton);

    // Button should be disabled while deciding
    await waitFor(() => {
      expect(firstApproveButton).toBeDisabled();
    });

    // Resolve the promise
    if (resolveApprove) resolveApprove();
  });
});
