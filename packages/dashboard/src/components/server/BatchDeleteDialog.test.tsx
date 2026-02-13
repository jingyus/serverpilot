// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { BatchDeleteDialog } from "./BatchDeleteDialog";

describe("BatchDeleteDialog", () => {
  const defaultProps = {
    open: true,
    count: 3,
    isDeleting: false,
    progress: { done: 0, total: 3 },
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders dialog with server count in title", () => {
    render(<BatchDeleteDialog {...defaultProps} />);
    expect(screen.getByText(/Delete 3 Servers/)).toBeInTheDocument();
  });

  it("renders confirmation message with count", () => {
    render(<BatchDeleteDialog {...defaultProps} />);
    expect(
      screen.getByText(/Are you sure you want to delete 3 server/),
    ).toBeInTheDocument();
  });

  it("calls onConfirm when delete is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<BatchDeleteDialog {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: /Delete/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<BatchDeleteDialog {...defaultProps} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows progress text when deleting", () => {
    render(
      <BatchDeleteDialog
        {...defaultProps}
        isDeleting={true}
        progress={{ done: 1, total: 3 }}
      />,
    );
    // Progress text appears in both description and button
    const matches = screen.getAllByText(/Deleting\.\.\. \(1\/3\)/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("disables buttons when deleting", () => {
    render(
      <BatchDeleteDialog
        {...defaultProps}
        isDeleting={true}
        progress={{ done: 1, total: 3 }}
      />,
    );
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeDisabled();
  });

  it("does not render when closed", () => {
    render(<BatchDeleteDialog {...defaultProps} open={false} />);
    expect(screen.queryByText(/Delete 3 Servers/)).not.toBeInTheDocument();
  });
});
