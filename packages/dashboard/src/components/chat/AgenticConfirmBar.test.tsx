// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgenticConfirmBar } from "./AgenticConfirmBar";
import type { AgenticConfirm } from "@/stores/chat";

function makeConfirm(overrides: Partial<AgenticConfirm> = {}): AgenticConfirm {
  return {
    confirmId: "session:abc-123",
    command: "apt install nginx",
    description: "Install nginx web server",
    riskLevel: "yellow",
    ...overrides,
  };
}

describe("AgenticConfirmBar", () => {
  const defaultProps = {
    confirm: makeConfirm(),
    onApprove: vi.fn(),
    onReject: vi.fn(),
  };

  it("renders with agentic-confirm-bar testid", () => {
    render(<AgenticConfirmBar {...defaultProps} />);

    expect(screen.getByTestId("agentic-confirm-bar")).toBeInTheDocument();
  });

  it("renders command, description, and risk label from RISK_CONFIG", () => {
    render(<AgenticConfirmBar {...defaultProps} />);

    expect(screen.getByText("Install nginx web server")).toBeInTheDocument();
    expect(screen.getByText("$ apt install nginx")).toBeInTheDocument();
    expect(screen.getByText("Caution")).toBeInTheDocument();
  });

  it("renders Allow button enabled when confirmId is present (non-critical)", () => {
    render(<AgenticConfirmBar {...defaultProps} />);

    const allowBtn = screen.getByTestId("agentic-allow-btn");
    expect(allowBtn).toBeEnabled();
    expect(allowBtn).toHaveTextContent("Allow");
  });

  it("renders Reject button with testid", () => {
    render(<AgenticConfirmBar {...defaultProps} />);

    const rejectBtn = screen.getByTestId("agentic-reject-btn");
    expect(rejectBtn).toBeEnabled();
    expect(rejectBtn).toHaveTextContent("Reject");
  });

  it("calls onApprove when Allow is clicked (non-critical)", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<AgenticConfirmBar {...defaultProps} onApprove={onApprove} />);

    await user.click(screen.getByTestId("agentic-allow-btn"));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("calls onReject when Reject is clicked", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn();
    render(<AgenticConfirmBar {...defaultProps} onReject={onReject} />);

    await user.click(screen.getByTestId("agentic-reject-btn"));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('disables Allow button and shows "Waiting..." when confirmId is empty', () => {
    render(
      <AgenticConfirmBar
        {...defaultProps}
        confirm={makeConfirm({ confirmId: "" })}
      />,
    );

    const allowBtn = screen.getByTestId("agentic-allow-btn");
    expect(allowBtn).toBeDisabled();
    expect(allowBtn).toHaveTextContent("Waiting...");
  });

  it("does not call onApprove when clicking disabled Waiting button", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(
      <AgenticConfirmBar
        confirm={makeConfirm({ confirmId: "" })}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("agentic-allow-btn"));
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("Reject button is always enabled even without confirmId", () => {
    render(
      <AgenticConfirmBar
        {...defaultProps}
        confirm={makeConfirm({ confirmId: "" })}
      />,
    );

    expect(screen.getByTestId("agentic-reject-btn")).toBeEnabled();
  });

  it("shows timeout error after 5 seconds when confirmId stays empty", () => {
    vi.useFakeTimers();
    render(
      <AgenticConfirmBar
        {...defaultProps}
        confirm={makeConfirm({ confirmId: "" })}
      />,
    );

    expect(
      screen.queryByTestId("agentic-confirm-timeout-error"),
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(
      screen.getByTestId("agentic-confirm-timeout-error"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("agentic-confirm-timeout-error").textContent,
    ).toContain("Unable to receive confirmation ID");

    vi.useRealTimers();
  });

  it("does not show timeout error when confirmId is present", () => {
    vi.useFakeTimers();
    render(<AgenticConfirmBar {...defaultProps} />);

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(
      screen.queryByTestId("agentic-confirm-timeout-error"),
    ).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders "Dangerous" label for red risk level', () => {
    render(
      <AgenticConfirmBar
        {...defaultProps}
        confirm={makeConfirm({ riskLevel: "red" })}
      />,
    );

    expect(screen.getByText("Dangerous")).toBeInTheDocument();
  });

  it('renders "Critical" label for critical risk level', () => {
    render(
      <AgenticConfirmBar
        {...defaultProps}
        confirm={makeConfirm({ riskLevel: "critical" })}
      />,
    );

    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  it("falls back to yellow config for unknown risk level", () => {
    render(
      <AgenticConfirmBar
        {...defaultProps}
        confirm={makeConfirm({ riskLevel: "unknown-level" })}
      />,
    );

    expect(screen.getByText("Caution")).toBeInTheDocument();
  });

  describe("critical risk math verification", () => {
    it("shows math verification input for critical commands", () => {
      render(
        <AgenticConfirmBar
          {...defaultProps}
          confirm={makeConfirm({ riskLevel: "critical" })}
        />,
      );

      expect(screen.getByTestId("math-verification-input")).toBeInTheDocument();
      expect(
        screen.getByText(/Critical Command - Math Verification Required/),
      ).toBeInTheDocument();
    });

    it("disables Allow button until math answer is correct", async () => {
      const user = userEvent.setup();
      render(
        <AgenticConfirmBar
          {...defaultProps}
          confirm={makeConfirm({ riskLevel: "critical" })}
        />,
      );

      const allowBtn = screen.getByTestId("agentic-allow-btn");
      const mathInput = screen.getByTestId("math-verification-input");

      // Button should be disabled initially
      expect(allowBtn).toBeDisabled();
      expect(allowBtn).toHaveTextContent("Answer Required");

      // Extract the math question and calculate the answer
      const questionText = screen.getByText(/What is/i).textContent || "";
      const match = questionText.match(/(\d+)\s*([\+\-])\s*(\d+)/);
      if (match) {
        const [, a, op, b] = match;
        const answer =
          op === "+" ? parseInt(a) + parseInt(b) : parseInt(a) - parseInt(b);

        // Enter correct answer
        await user.type(mathInput, answer.toString());

        // Button should now be enabled
        expect(allowBtn).not.toBeDisabled();
        expect(allowBtn).toHaveTextContent("Allow");
      }
    });

    it("calls onApprove when Allow is clicked after correct math answer", async () => {
      const user = userEvent.setup();
      const onApprove = vi.fn();
      render(
        <AgenticConfirmBar
          {...defaultProps}
          confirm={makeConfirm({ riskLevel: "critical" })}
          onApprove={onApprove}
        />,
      );

      // Extract and answer the math question
      const questionText = screen.getByText(/What is/i).textContent || "";
      const match = questionText.match(/(\d+)\s*([\+\-])\s*(\d+)/);
      if (match) {
        const [, a, op, b] = match;
        const answer =
          op === "+" ? parseInt(a) + parseInt(b) : parseInt(a) - parseInt(b);

        const mathInput = screen.getByTestId("math-verification-input");
        await user.type(mathInput, answer.toString());

        // Click Allow button
        await user.click(screen.getByTestId("agentic-allow-btn"));
        expect(onApprove).toHaveBeenCalledOnce();
      }
    });

    it("does not call onApprove when math answer is incorrect", async () => {
      const user = userEvent.setup();
      const onApprove = vi.fn();
      render(
        <AgenticConfirmBar
          {...defaultProps}
          confirm={makeConfirm({ riskLevel: "critical" })}
          onApprove={onApprove}
        />,
      );

      const mathInput = screen.getByTestId("math-verification-input");
      await user.type(mathInput, "999");

      const allowBtn = screen.getByTestId("agentic-allow-btn");
      expect(allowBtn).toBeDisabled();

      // Attempt to click (should not work because button is disabled)
      await user.click(allowBtn);
      expect(onApprove).not.toHaveBeenCalled();
    });
  });
});
